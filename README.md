# Reliable Server Agent

A fault-tolerant command execution system consisting of a **Control Server** and **multiple Agents**. Commands are executed reliably with persistence across restarts, crash recovery, and idempotent execution guarantees.

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Installation](#installation)
- [Running the System](#running-the-system)
- [API Reference](#api-reference)
- [Command Types](#command-types)
- [Persistence and Recovery](#persistence-and-recovery)
- [Agent CLI Options](#agent-cli-options)
- [Testing](#testing)
- [Trade-offs and Design Decisions](#trade-offs-and-design-decisions)

## Overview

This system implements a distributed command execution architecture where:

- A **Control Server** receives commands, manages their lifecycle, and coordinates work distribution
- One or more **Agents** poll the server for work, execute commands, and report results
- Commands survive server/agent crashes and restarts with deterministic recovery

The system uses a **pull-based queue** model where agents claim work via HTTP polling. There is no external message broker (e.g., RabbitMQ); the server itself acts as the work queue.

## Features

- **Persistence**: Both server (SQLite) and agents (local journal) persist state to disk
- **Crash Recovery**: Deterministic recovery on startup for both server and agents
- **Idempotent Execution**: No duplicate command execution even after crashes
- **Lease-based Concurrency**: At most one agent executes a command at any time
- **Multiple Agents**: Horizontal scaling by running multiple agent instances
- **Heartbeat Mechanism**: Agents extend their leases to prevent premature reclaim

## Architecture

### Monorepo Structure

```
packages/
  server/   # Control Server - Express + SQLite
  agent/    # Agent - Claims work, executes, reports
  shared/   # Shared types, DTOs, constants
```

### High-Level Flow

```
1. Client creates command via POST /commands
2. Agent polls POST /commands/claim
3. Server atomically assigns command (PENDING -> RUNNING)
   - Issues lease with expiration time
   - For DELAY: computes scheduledEndAt
4. Agent executes command
   - Periodically sends heartbeats to extend lease
5. Agent reports result via POST /commands/:id/complete
6. Server accepts result only if lease is still valid
```

### Command Lifecycle States

| State | Description |
|-------|-------------|
| `PENDING` | Waiting to be claimed by an agent |
| `RUNNING` | Claimed and being executed by an agent |
| `COMPLETED` | Successfully completed |
| `FAILED` | Execution failed |

## Installation

### Prerequisites

- Node.js >= 18.0.0
- pnpm (recommended) or npm

### Setup

```bash
# Clone the repository
git clone <repository-url>
cd reliable-server-agent

# Install dependencies
pnpm install

# Build all packages
pnpm build
```

## Running the System

### Start the Server

```bash
# Using built files
pnpm start:server

# Or in development mode (with hot reload)
pnpm dev:server
```

#### Server Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port to listen on |
| `DATABASE_PATH` | `./data/commands.db` | Path to SQLite database file |

### Start an Agent

```bash
# Using built files
pnpm start:agent

# Or in development mode
pnpm dev:agent
```

#### Agent CLI Arguments

```bash
# With custom configuration
node packages/agent/dist/index.js \
  --agent-id=agent-01 \
  --server-url=http://localhost:3000 \
  --state-dir=.agent-state
```

See [Agent CLI Options](#agent-cli-options) for the full list.

### Running Multiple Agents

Each agent should have a unique agent ID. You can run multiple instances:

```bash
# Terminal 1
node packages/agent/dist/index.js --agent-id=agent-01

# Terminal 2
node packages/agent/dist/index.js --agent-id=agent-02

# Terminal 3
node packages/agent/dist/index.js --agent-id=agent-03
```

## API Reference

### Public Endpoints

#### Create Command

```
POST /commands
```

Request:
```json
{
  "type": "DELAY" | "HTTP_GET_JSON",
  "payload": { ... }
}
```

Response (201):
```json
{
  "commandId": "uuid-string"
}
```

#### Get Command Status

```
GET /commands/:id
```

Response (200):
```json
{
  "status": "PENDING" | "RUNNING" | "COMPLETED" | "FAILED",
  "result": { ... },
  "agentId": "agent-id"
}
```

### Internal Agent Endpoints

#### Claim Command

```
POST /commands/claim
```

Request:
```json
{
  "agentId": "string",
  "maxLeaseMs": 30000
}
```

Response (200):
```json
{
  "commandId": "string",
  "type": "DELAY" | "HTTP_GET_JSON",
  "payload": { ... },
  "leaseId": "string",
  "leaseExpiresAt": 1234567890123,
  "startedAt": 1234567890000,
  "scheduledEndAt": 1234567895000
}
```

Response (204): No work available.

#### Heartbeat

```
POST /commands/:id/heartbeat
```

Request:
```json
{
  "agentId": "string",
  "leaseId": "string",
  "extendMs": 30000
}
```

Response: 204 (success), 409 (lease not current)

#### Complete Command

```
POST /commands/:id/complete
```

Request:
```json
{
  "agentId": "string",
  "leaseId": "string",
  "result": { ... }
}
```

Response: 204 (success), 409 (lease not current)

#### Fail Command

```
POST /commands/:id/fail
```

Request:
```json
{
  "agentId": "string",
  "leaseId": "string",
  "error": "string",
  "result": { ... }
}
```

Response: 204 (success), 409 (lease not current)

## Command Types

### DELAY

Waits for a specified duration.

**Input:**
```json
{
  "ms": 5000
}
```

**Output:**
```json
{
  "ok": true,
  "tookMs": 5034
}
```

**Idempotency:** The server computes `scheduledEndAt = startedAt + ms` at claim time. If an agent crashes and restarts, it resumes waiting for the remaining time rather than restarting the full delay.

### HTTP_GET_JSON

Fetches a URL and returns the response.

**Input:**
```json
{
  "url": "https://api.example.com/data"
}
```

**Output:**
```json
{
  "status": 200,
  "body": { ... },
  "truncated": false,
  "bytesReturned": 1234,
  "error": null
}
```

**Handling Rules:**

| Scenario | Behavior |
|----------|----------|
| Redirects | Not followed; returns `error: "Redirects not followed"` |
| Timeout | 30 seconds; returns `error: "Request timeout"` |
| Non-JSON response | Returns raw string body |
| Large response | Truncated to 10,240 characters; sets `truncated: true` |

**Idempotency:** After fetching, the agent saves the result to its journal before reporting to the server. On crash recovery, the saved result is replayed without re-fetching.

## Persistence and Recovery

### Server Persistence (SQLite)

The server stores all command state in SQLite with WAL mode enabled for durability.

**On Startup:**
1. Find all commands with `status = RUNNING`
2. For each: if `leaseExpiresAt <= now`, reset to `PENDING`
3. Commands with valid (non-expired) leases remain `RUNNING`

### Agent Persistence (Journal)

Each agent maintains a journal file at `.agent-state/<agentId>.json`.

**Journal Stages:**
- `CLAIMED`: Command claimed, execution not started
- `IN_PROGRESS`: Execution in progress
- `RESULT_SAVED`: Execution complete, result saved (before reporting)

**On Startup:**
1. If journal exists with `RESULT_SAVED`: attempt to report saved result
   - 204 response: delete journal
   - 409 response: delete journal (lease is stale)
2. If journal has `DELAY` with `scheduledEndAt`: resume waiting
3. Otherwise: enter normal claim loop

**Atomic Writes:** Journal updates use temp file + rename to ensure atomicity.

## Agent CLI Options

| Option | Environment Variable | Default | Description |
|--------|---------------------|---------|-------------|
| `--agent-id=<id>` | `AGENT_ID` | Random | Unique agent identifier |
| `--server-url=<url>` | `SERVER_URL` | `http://localhost:3000` | Server base URL |
| `--state-dir=<path>` | `AGENT_STATE_DIR` | `.agent-state` | Journal directory |
| `--max-lease-ms=<ms>` | `MAX_LEASE_MS` | `30000` | Maximum lease duration |
| `--heartbeat-interval-ms=<ms>` | `HEARTBEAT_INTERVAL_MS` | `10000` | Heartbeat frequency |
| `--poll-interval-ms=<ms>` | `POLL_INTERVAL_MS` | `1000` | Polling frequency |
| `--kill-after=<seconds>` | - | - | Kill agent after N seconds |
| `--random-failures` | - | `false` | Simulate random crashes |

### Failure Simulation

For testing crash recovery:

```bash
# Kill agent after 30 seconds
node packages/agent/dist/index.js --kill-after=30

# Enable random crashes during execution
node packages/agent/dist/index.js --random-failures
```

Random failures occur with 10% probability at various stages:
- During DELAY waiting
- After HTTP fetch, before saving result

## Testing

```bash
# Run all tests
pnpm test

# Run tests with watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage
```

### Test Coverage

The test suite covers:

- **Server Tests:**
  - Express app configuration and JSON parsing
  - SQLite initialization with WAL mode
  - Startup recovery for expired leases
  - Command routes (create, get, claim, heartbeat, complete, fail)
  - Graceful shutdown on SIGINT/SIGTERM

- **Agent Tests:**
  - Journal recovery on startup
  - Claim-execute-report cycle
  - Heartbeat management
  - Handling 409 responses (stale lease)
  - Command routing to correct executor
  - Server unavailability handling
  - Lease validity during execution

## Trade-offs and Design Decisions

### Pull-based Queue vs Message Broker

**Decision:** Implement the queue in the server using SQLite.

**Trade-offs:**
- (+) Simpler deployment (no external dependencies)
- (+) Single source of truth for command state
- (-) Polling overhead vs push-based notification
- (-) Horizontal server scaling requires shared database

### Lease-based Concurrency

**Decision:** Use time-limited leases with heartbeat extension.

**Trade-offs:**
- (+) No coordination needed between agents
- (+) Automatic recovery when agents crash
- (-) Potential for duplicate execution during network partitions
- (-) Heartbeat overhead

### Agent Local Journal

**Decision:** Persist execution state locally on each agent.

**Trade-offs:**
- (+) Enables idempotent execution after crash
- (+) Avoids duplicate HTTP requests
- (-) Requires careful file handling (atomic writes)
- (-) Journal state may become stale if agent ID reused

### SQLite WAL Mode

**Decision:** Use Write-Ahead Logging for the database.

**Trade-offs:**
- (+) Better concurrent read performance
- (+) Improved crash recovery
- (-) Additional files (.db-wal, .db-shm) to manage
- (-) Slightly more complex backup procedures

### No Automatic Retries on Failure

**Decision:** Failed commands remain in `FAILED` state.

**Trade-offs:**
- (+) Clear semantics (each command executed at most once successfully)
- (+) Client can inspect failure and decide retry strategy
- (-) No built-in retry with backoff
- (-) Requires external orchestration for automatic retries

## License

This project is private and not licensed for external use.