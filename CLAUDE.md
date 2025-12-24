# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This repository is for "reliable-server-agent" - Here is what our final goal should achieve.

```
# Skipr – Backend Engineer Test Task
## Fault-Tolerant Single-Agent Command Execution System
**Tech:** Node.js + TypeScript  
**Extras:** Docker, persistence (required)  

# 🎯 Goal
Implement a simple **fault-tolerant system** with:

- one **Control Server**
- one **Agent**
- two command types
- ability to survive crashes & restarts
- correct state restoration
- idempotent execution (no duplicates)
- AI use is permitted and encouraged 

# 🧩 System Overview

## 1. Control Server
A Node.js/TypeScript service that:

- accepts commands  
- persists their state  
- exposes command status  
- assigns one command at a time to the Agent (additional questions: what happens when multiple agents exist? agent restarts quickly? agent requests next command while one is running?)  
- recovers state on restart / failure 
- handles unfinished commands safely

### Required Endpoints

#### **POST /commands**
Request:
```json
{ "type": "DELAY" | "HTTP_GET_JSON", "payload": {} }
```
Response:
```json
{ "commandId": "string" }
```

#### **GET /commands/:id**
Response:
```json
{
  "status": "PENDING" | "RUNNING" | "COMPLETED" | "FAILED",
  "result": {},
  "agentId": "string"
}
```

### Server Requirements
Server must:

- maintain command lifecycle states
- ensure no command runs twice (idempotency)
- persist state across server restart
- detect leftover RUNNING commands on startup
- handle them deterministically (mark FAILED or return to PENDING — document your choice)

Persistence can be:
- JSON file
- SQLite
- LevelDB
- anything deterministic



## 2. Agent
A Node.js/TS service that:

- starts
- fetches commands from server
- executes them
- sends results back
- can crash at random
- after restart, must sync correctly with server

### Required Agent Behaviors

- Poll for work
- Execute DELAY and HTTP_GET_JSON
- Return results to server
- Detect unfinished command after crash
- Prevent double execution

### Failure Simulation Flags

#### `--kill-after=N`
Crash after N seconds or N polling cycles.

#### `--random-failures`
Random crashes during command execution.



# 🔧 Supported Command Types

## 1. DELAY
Execute delay command and return result of the execution to server.

Input:
```json
{ "ms": number }
```
Output example:
```json
{ "ok": true, "tookMs": 5034 }
```

Edge cases:
- crash mid-delay
- crash after completing delay but before reporting result



## 2. HTTP_GET_JSON
Agent fetches JSON from URL and returns status + a body snippet.

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



# 🐳 Docker (Optional)
Recommended but optional.

Provide:
- Server Dockerfile
- Agent Dockerfile
- docker-compose.yml to run both

If you skip Docker:  
**Provide clear local run instructions.**



# 🧪 Testing Requirements
You must test and verify:

- Server restarts
- Agent crash scenarios
- Edge cases during execution
- Idempotency



# 📦 What To Deliver
1. Source code (link to your repo)
2. (Optional) Docker setup
3. README with:
    - how to run
    - architecture overview
    - persistence approach
    - crash recovery explanation
    - trade-offs & decisions
4. Meaningful commit history
5. Reflection:
    - how you used AI
    - where AI was wrong
    - what required manual debugging
```

## Build Commands

- `pnpm install` - Install all dependencies
- `pnpm build` - Build all packages
- `pnpm start:server` - Start the control server
- `pnpm start:agent` - Start the agent
- `pnpm dev:server` - Run server in development mode (with watch)
- `pnpm dev:agent` - Run agent in development mode (with watch)
- `pnpm test` - Run tests across all packages
- `pnpm clean` - Clean build artifacts

## Architecture

This is a **monorepo** using pnpm workspaces with the following packages:

```
packages/
├── server/   # Control Server - Express-based HTTP API
├── agent/    # Agent - Polls server and executes commands
└── shared/   # Shared types and utilities
```

### Environment Variables

See `.env.example` for all configuration options:
- `SERVER_PORT` / `SERVER_HOST` - Server binding
- `AGENT_ID` - Unique agent identifier
- `SERVER_URL` - URL the agent uses to connect to server
- `POLL_INTERVAL_MS` - Agent polling interval
- `DATA_DIR` - Directory for persistence (default: `./data`)

### Tech Stack
- Node.js 18+ with TypeScript (ES2022, NodeNext modules)
- Express for the Control Server HTTP API
- JSON file or equivalent for persistence
