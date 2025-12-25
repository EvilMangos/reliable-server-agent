# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## Project Overview

Repository: **reliable-server-agent**

Goal: implement a fault-tolerant **Control Server** + **multiple Agents** executing two command types:

- `DELAY`
- `HTTP_GET_JSON`

Key requirements:

- persistence across restarts (server + agent)
- survive crashes & restarts deterministically
- **idempotent execution** (no duplicate command *execution*)
- multiple agents supported (server assigns **at most one agent per command** at a time)

We intentionally use a **pull-based queue** implemented by the server:
- agents **poll/claim** work via HTTP
- no message broker (no RabbitMQ)

## Architecture

Monorepo with pnpm workspaces:

```
packages/
├── agent/    # Agent - Pulls work, executes, heartbeats, reports results
├── e2e/      # End-to-end tests - Black-box integration tests for crash recovery
├── server/   # Control Server - Express-based HTTP API + SQLite persistence
└── shared/   # Shared types, DTOs, constants
```

### High-Level Flow

1. Client creates commands via `POST /commands`.
2. Agents repeatedly call `POST /commands/claim`.
3. Server atomically assigns a command by issuing a **lease**:
   - marks command `RUNNING`
   - sets `agentId`, `leaseId`, `leaseExpiresAt`
   - (for DELAY) persists deterministic `scheduledEndAt`
4. Agent executes while periodically calling `POST /commands/:id/heartbeat` to extend lease.
5. Agent reports completion via `POST /commands/:id/complete` (or `/fail`) with `leaseId`.
6. Server accepts results **only** for the current active lease.

## Persistence

### Server store: SQLite (required)

Use SQLite as the single source of truth for command lifecycle state.

**Command record (conceptual fields):**
- `id` (string)
- `type` (`DELAY | HTTP_GET_JSON`)
- `payloadJson` (string)
- `status` (`PENDING | RUNNING | COMPLETED | FAILED`)
- `resultJson` (string | null)
- `error` (string | null)
- `agentId` (string | null)
- `leaseId` (string | null)
- `leaseExpiresAt` (unix ms | null)
- `createdAt` (unix ms)
- `startedAt` (unix ms | null)
- `attempt` (int, starts at 0)
- `scheduledEndAt` (unix ms | null)  // used only for DELAY

**Atomic claim rule (server invariant):**
- at most **one active lease** per command at any time
- only the holder of `(commandId, leaseId)` may complete/fail/heartbeat

### Agent local journal (required for idempotent report)

Agent persists a small journal on disk to avoid duplicate *execution* and to ensure it can re-report a finished result after crashes.

Minimal journal file per agent:
- path: `./.agent-state/<agentId>.json` (or configurable)
- contents:
  - `commandId`
  - `leaseId`
  - `type`
  - `startedAt`
  - `scheduledEndAt` (for DELAY)
  - `httpSnapshot` (for HTTP_GET_JSON) optional
  - `stage`: `CLAIMED | IN_PROGRESS | RESULT_SAVED`

Rules:
- journal is written with **atomic write** (temp file + rename)
- journal is deleted only after server confirms completion/failure

## API

### Required endpoints (task)

#### POST /commands
Request:
```json
{ "type": "DELAY" | "HTTP_GET_JSON", "payload": {} }
````

Response:

```json
{ "commandId": "string" }
```

#### GET /commands/:id

Response:

```json
{
  "status": "PENDING" | "RUNNING" | "COMPLETED" | "FAILED",
  "result": {},
  "agentId": "string"
}
```

### Internal endpoints (allowed / used by agents)

#### POST /commands/claim

Request:

```json
{ "agentId": "string", "maxLeaseMs": 30000 }
```

Response (200):

```json
{
  "commandId": "string",
  "type": "DELAY" | "HTTP_GET_JSON",
  "payload": {},
  "leaseId": "string",
  "leaseExpiresAt": 0,
  "startedAt": 0,
  "scheduledEndAt": 0
}
```

Response (204): no work available.

Notes:

* server picks the oldest `PENDING` command
* server increments `attempt`
* server sets `startedAt` only on the first transition to RUNNING for that attempt

#### POST /commands/:id/heartbeat

Request:

```json
{ "agentId": "string", "leaseId": "string", "extendMs": 30000 }
```

Response: 204 on success, 409 if lease is not current.

#### POST /commands/:id/complete

Request:

```json
{ "agentId": "string", "leaseId": "string", "result": {} }
```

Response: 204 on success, 409 if lease is not current.

#### POST /commands/:id/fail

Request:

```json
{ "agentId": "string", "leaseId": "string", "error": "string", "result": {} }
```

Response: 204 on success, 409 if lease is not current.

## Command Semantics

### 1) DELAY

Input:

```json
{ "ms": 5000 }
```

Output example:

```json
{ "ok": true, "tookMs": 5034 }
```

**Idempotency strategy (no duplicate waiting):**

* Server persists `scheduledEndAt = startedAt + ms` *at claim time*.
* Agent does not "sleep ms"; it waits until `scheduledEndAt`.
* If it restarts mid-delay, it resumes by waiting only remaining time.

`tookMs` should be computed as `now - startedAt` (or `scheduledEndAt - startedAt`; pick one and keep consistent).

Edge cases:

* crash mid-delay → new agent can claim later and finish without restarting the full delay
* crash after delay completed but before reporting result → agent journal ensures it can re-report without re-waiting

### 2) HTTP_GET_JSON

Input:

```json
{ "url": "string" }
```

Output:

```json
{
  "status": number,
  "body": object | string | null,
  "truncated": boolean,
  "bytesReturned": number,
  "error": string | null
}
```

Handling rules:

* redirects: do not follow; return `error: "Redirects not followed"`
* timeout: 30s; return `error: "Request timeout"`
* non-JSON: return raw string body
* truncate body to 10_240 chars; set `truncated`

**Idempotency strategy (avoid duplicate fetch after “done but not reported”):**

* After a successful fetch, agent writes `httpSnapshot` to journal (`stage = RESULT_SAVED`) **before** calling `/complete`.
* On restart, if journal contains `httpSnapshot`, agent must **replay completion** without refetching.

Note: if the agent crashes mid-request (before result exists), the command may be retried later; this is acceptable because the prior attempt did not complete.

## Lifecycle & Deterministic Crash Recovery

### Server is authoritative

Server owns the lifecycle state machine and enforces idempotency via leases.

**States:**

* `PENDING`: waiting to be claimed
* `RUNNING`: leased to an agent
* `COMPLETED`: final success
* `FAILED`: final failure

### Lease behavior

* A command in RUNNING must have a non-expired `leaseExpiresAt`.
* Heartbeats extend lease.
* Only the current lease holder may complete/fail.

### Server startup recovery (deterministic)

On server startup:

* find commands with `status = RUNNING`
* if `leaseExpiresAt <= now`: set them to `PENDING` (retry)
* else keep them RUNNING

This satisfies the requirement to detect leftover RUNNING and handle deterministically.

### Agent startup behavior (idempotent)

Agent startup must **NOT** mark commands FAILED based on local state.

Instead:

1. If agent journal exists:

    * If `stage = RESULT_SAVED`: attempt `/complete` (or `/fail`) with saved `leaseId` and saved result.

        * If server returns 204 → delete journal.
        * If server returns 409 → delete journal (lease is no longer valid; server has moved on deterministically).
    * If `type = DELAY` and `scheduledEndAt` exists: resume waiting until `scheduledEndAt` and then `/complete` using current lease (if still valid).

        * If lease expired, stop and go back to claim loop.
    * Otherwise: drop into claim loop (safe fallback).
2. Normal loop: claim → execute → report → delete journal.

## Multiple Agents

* Supported by design.
* Each agent operates independently and may process one command at a time.
* Server guarantees:

    * no two agents execute the same command concurrently
    * no duplicate completions (lease-gated)

## Failure Simulation Flags (Agent CLI)

* `--kill-after=N`
  Kill the agent after N seconds (or N polling cycles; choose one and document in README).
* `--random-failures`
  Randomly crash during execution / between stages (claim, in-progress, result-saved, report).

Implement failures to exercise:

* crash mid-delay
* crash after delay done but before reporting
* crash after HTTP fetch but before reporting
* crash during polling/idle

## Testing Requirements

Add integration tests covering:

* Server restart restores state from SQLite
* Agent crash mid-delay → command completes once with deterministic scheduledEndAt
* Agent crash after HTTP fetch before reporting → replays completion from journal; verify only one completion and (optionally) single fetch against a local mock server counter
* Lease expiry → RUNNING becomes PENDING deterministically and is retried
* Idempotency: server rejects stale `/complete` (409) and does not change final states

Prefer black-box tests:

* spin up server + one or more agents (child processes)
* use a local HTTP stub server for `HTTP_GET_JSON`

## Implementation Notes / Priorities

* Use SQLite transactions for claim/heartbeat/complete to avoid race conditions.
* Use atomic file writes for agent journal.
* Keep shared DTOs in `packages/shared`.
* Keep logs clear: include `agentId`, `commandId`, `leaseId`, `attempt`, state transitions.

## TODO Plan (high-level)

1. Shared: types for DTOs, command/result shapes, status enum
2. Server: SQLite schema + store (atomic claim + lease updates)
3. Server: HTTP routes (required + internal agent endpoints)
4. Server: startup recovery for expired leases
5. Agent: claim loop + heartbeat loop
6. Agent: journal persistence + replay on restart
7. Agent: DELAY executor using `scheduledEndAt`
8. Agent: HTTP_GET_JSON executor + journaling of snapshot before reporting
9. Agent: failure simulation flags
10. Tests: integration tests for restarts/crashes/idempotency
11. (Optional) Docker: server/agent Dockerfiles + compose
12. Docs: README (run, architecture, persistence, recovery, trade-offs, AI reflection)
