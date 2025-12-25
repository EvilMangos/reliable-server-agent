import type { CommandResult, CommandStatus } from "@reliable-server-agent/shared";

/**
 * Response structure for getCommand
 */
export interface GetCommandServiceResponse {
	status: CommandStatus;
	result?: CommandResult;
	agentId?: string;
}
