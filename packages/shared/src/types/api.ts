import type { CommandPayload, CommandResult, CommandStatus, CommandType, UnixMs } from "./command.js";

// =============================================================================
// Public API DTOs
// =============================================================================

/**
 * Request body for POST /commands.
 * Used by clients to create a new command for execution.
 */
export interface CreateCommandRequest {
	/** Type of command to create (DELAY or HTTP_GET_JSON) */
	type: CommandType;
	/** Command-specific payload with execution parameters */
	payload: CommandPayload;
}

/**
 * Response body for POST /commands.
 * Returns the ID of the newly created command.
 */
export interface CreateCommandResponse {
	/** Unique identifier of the created command */
	commandId: string;
}

/**
 * Response body for GET /commands/:id.
 * Returns the current state of a command.
 */
export interface GetCommandResponse {
	/** Current lifecycle status of the command */
	status: CommandStatus;
	/** Execution result if command is completed, undefined otherwise */
	result?: CommandResult;
	/** ID of the agent that processed this command, undefined if not claimed */
	agentId?: string;
}

// =============================================================================
// Internal Agent API DTOs
// =============================================================================

/**
 * Request body for POST /commands/claim.
 * Used by agents to request work from the server.
 */
export interface ClaimCommandRequest {
	/** Unique identifier of the claiming agent */
	agentId: string;
	/** Maximum lease duration in milliseconds */
	maxLeaseMs: number;
}

/**
 * Response body for POST /commands/claim (200 OK).
 * Contains all information needed for the agent to execute the command.
 * Returns 204 No Content if no work is available.
 */
export interface ClaimCommandResponse {
	/** ID of the claimed command */
	commandId: string;
	/** Type of command to execute */
	type: CommandType;
	/** Command-specific execution parameters */
	payload: CommandPayload;
	/** Lease ID for idempotent completion/heartbeat calls */
	leaseId: string;
	/** When the lease expires */
	leaseExpiresAt: UnixMs;
	/** When command execution started */
	startedAt: UnixMs;
	/** When DELAY should end, null for non-DELAY commands */
	scheduledEndAt: UnixMs | null;
}

/**
 * Request body for POST /commands/:id/heartbeat.
 * Used by agents to extend their lease while executing a command.
 */
export interface HeartbeatRequest {
	/** ID of the agent holding the lease */
	agentId: string;
	/** Current lease ID (must match server state) */
	leaseId: string;
	/** Duration in milliseconds to extend the lease */
	extendMs: number;
}

/**
 * Request body for POST /commands/:id/complete.
 * Used by agents to report successful command execution.
 */
export interface CompleteRequest {
	/** ID of the agent completing the command */
	agentId: string;
	/** Current lease ID (must match server state) */
	leaseId: string;
	/** Execution result to store */
	result: CommandResult;
}

/**
 * Request body for POST /commands/:id/fail.
 * Used by agents to report failed command execution.
 */
export interface FailRequest {
	/** ID of the agent reporting the failure */
	agentId: string;
	/** Current lease ID (must match server state) */
	leaseId: string;
	/** Error message describing the failure */
	error: string;
	/** Partial result if any work was completed before failure */
	result?: CommandResult;
}
