import type { CommandPayload, CommandResult, CommandStatus, CommandType } from "./command.js";

// ============================================================================
// Public API
// ============================================================================

// POST /commands
export interface CreateCommandRequest {
	type: CommandType;
	payload: CommandPayload;
}

export interface CreateCommandResponse {
	commandId: string;
}

// GET /commands/:id
export interface GetCommandResponse {
	status: CommandStatus;
	result?: CommandResult;
	agentId?: string;
}

// ============================================================================
// Internal Agent API
// ============================================================================

// POST /commands/claim
export interface ClaimCommandRequest {
	agentId: string;
	maxLeaseMs: number;
}

export interface ClaimCommandResponse {
	commandId: string;
	type: CommandType;
	payload: CommandPayload;
	leaseId: string;
	leaseExpiresAt: number; // unix ms
	startedAt: number; // unix ms
	scheduledEndAt: number | null; // unix ms, only for DELAY
}

// POST /commands/:id/heartbeat
export interface HeartbeatRequest {
	agentId: string;
	leaseId: string;
	extendMs: number;
}

// POST /commands/:id/complete
export interface CompleteRequest {
	agentId: string;
	leaseId: string;
	result: CommandResult;
}

// POST /commands/:id/fail
export interface FailRequest {
	agentId: string;
	leaseId: string;
	error: string;
	result?: CommandResult;
}
