import type { CommandPayload, CommandType } from "@reliable-server-agent/shared";

/**
 * Response structure for claimNextCommand
 */
export interface ClaimCommandServiceResponse {
	commandId: string;
	type: CommandType;
	payload: CommandPayload;
	leaseId: string;
	leaseExpiresAt: number;
	startedAt: number;
	scheduledEndAt: number | null;
}
