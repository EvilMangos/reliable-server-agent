import type { ClaimCommandResponse, CommandResult } from "@reliable-server-agent/shared";

/**
 * Client for communicating with the control server.
 * Handles claim, heartbeat, complete, and fail operations.
 */
export interface ServerClient {
	claim(): Promise<ClaimCommandResponse | null>;
	heartbeat(commandId: string, leaseId: string): Promise<boolean>;
	complete(commandId: string, leaseId: string, result: CommandResult): Promise<boolean>;
	fail(commandId: string, leaseId: string, error: string, result?: CommandResult): Promise<boolean>;
}
