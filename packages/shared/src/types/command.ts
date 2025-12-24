export type CommandStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
export type CommandType = "DELAY" | "HTTP_GET_JSON";

// Payloads
export interface DelayPayload {
	ms: number;
}

export interface HttpGetJsonPayload {
	url: string;
}

export type CommandPayload = DelayPayload | HttpGetJsonPayload;

// Results
export interface DelayResult {
	ok: boolean;
	tookMs: number;
}

export interface HttpGetJsonResult {
	status: number;
	body: object | string | null;
	truncated: boolean;
	bytesReturned: number;
	error: string | null;
}

export type CommandResult = DelayResult | HttpGetJsonResult;

/**
 * Server-side command record (SQLite)
 * All timestamps are unix ms
 */
export interface CommandRecord {
	id: string;
	type: CommandType;
	payloadJson: string;
	status: CommandStatus;
	resultJson: string | null;
	error: string | null;
	agentId: string | null;
	leaseId: string | null;
	leaseExpiresAt: number | null; // unix ms
	createdAt: number; // unix ms
	startedAt: number | null; // unix ms
	attempt: number;
	scheduledEndAt: number | null; // unix ms, used only for DELAY
}
