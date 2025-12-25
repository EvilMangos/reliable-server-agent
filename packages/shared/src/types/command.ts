// =============================================================================
// Semantic Type Aliases
// =============================================================================

/** Unix timestamp in milliseconds */
export type UnixMs = number;

// =============================================================================
// Status and Type Constants
// =============================================================================

/**
 * Command lifecycle status values as a const object.
 * Use these constants instead of string literals for type safety.
 */
export const COMMAND_STATUS = {
	PENDING: "PENDING",
	RUNNING: "RUNNING",
	COMPLETED: "COMPLETED",
	FAILED: "FAILED",
} as const;

/**
 * Command type values as a const object.
 * Use these constants instead of string literals for type safety.
 */
export const COMMAND_TYPE = {
	DELAY: "DELAY",
	HTTP_GET_JSON: "HTTP_GET_JSON",
} as const;

/**
 * Lifecycle status of a command.
 * - PENDING: Waiting to be claimed by an agent
 * - RUNNING: Currently leased to an agent
 * - COMPLETED: Successfully completed
 * - FAILED: Execution failed
 */
export type CommandStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

/**
 * Type of command to execute.
 * - DELAY: Wait for a specified duration
 * - HTTP_GET_JSON: Fetch JSON from a URL
 */
export type CommandType = "DELAY" | "HTTP_GET_JSON";

// =============================================================================
// Command Payloads
// =============================================================================

/**
 * Payload for DELAY command type.
 * Instructs the agent to wait for a specified duration.
 */
export interface DelayPayload {
	/** Duration to wait in milliseconds */
	ms: number;
}

/**
 * Payload for HTTP_GET_JSON command type.
 * Instructs the agent to fetch JSON from a URL.
 */
export interface HttpGetJsonPayload {
	/** URL to fetch JSON from */
	url: string;
}

/**
 * Union of all command payload types.
 * Use type guards isDelayPayload() or isHttpGetJsonPayload() to discriminate.
 */
export type CommandPayload = DelayPayload | HttpGetJsonPayload;

// =============================================================================
// Command Results
// =============================================================================

/**
 * Result of a DELAY command execution.
 */
export interface DelayResult {
	/** Whether the delay completed successfully */
	ok: boolean;
	/** Actual time elapsed in milliseconds */
	tookMs: number;
}

/**
 * Result of an HTTP_GET_JSON command execution.
 */
export interface HttpGetJsonResult {
	/** HTTP status code from the response */
	status: number;
	/** Response body (parsed JSON object, raw string, or null) */
	body: object | string | null;
	/** Whether the body was truncated due to size limits */
	truncated: boolean;
	/** Number of bytes returned before truncation */
	bytesReturned: number;
	/** Error message if the request failed, null otherwise */
	error: string | null;
}

/**
 * Union of all command result types.
 * Use type guards isDelayResult() or isHttpGetJsonResult() to discriminate.
 */
export type CommandResult = DelayResult | HttpGetJsonResult;

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard to check if a payload is a DelayPayload
 */
export function isDelayPayload(payload: CommandPayload): payload is DelayPayload {
	return "ms" in payload;
}

/**
 * Type guard to check if a payload is an HttpGetJsonPayload
 */
export function isHttpGetJsonPayload(payload: CommandPayload): payload is HttpGetJsonPayload {
	return "url" in payload;
}

/**
 * Type guard to check if a result is a DelayResult
 */
export function isDelayResult(result: CommandResult): result is DelayResult {
	return "tookMs" in result;
}

/**
 * Type guard to check if a result is an HttpGetJsonResult
 */
export function isHttpGetJsonResult(result: CommandResult): result is HttpGetJsonResult {
	return "status" in result && "body" in result;
}

/**
 * Server-side command record stored in SQLite.
 * Represents the full lifecycle state of a command including lease information.
 */
export interface CommandRecord {
	/** Unique identifier for the command */
	id: string;
	/** Type of command (DELAY or HTTP_GET_JSON) */
	type: CommandType;
	/** JSON-serialized command payload */
	payloadJson: string;
	/** Current lifecycle status of the command */
	status: CommandStatus;
	/** JSON-serialized execution result, null if not completed */
	resultJson: string | null;
	/** Error message if command failed, null otherwise */
	error: string | null;
	/** ID of the agent currently processing this command, null if not claimed */
	agentId: string | null;
	/** Current lease ID for idempotent completion, null if not claimed */
	leaseId: string | null;
	/** When current lease expires, null if not claimed */
	leaseExpiresAt: UnixMs | null;
	/** When command was created */
	createdAt: UnixMs;
	/** When command execution started, null if not started */
	startedAt: UnixMs | null;
	/** Number of execution attempts (starts at 0) */
	attempt: number;
	/** When DELAY should end, null for non-DELAY commands */
	scheduledEndAt: UnixMs | null;
}
