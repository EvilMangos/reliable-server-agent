import type { CommandPayload, CommandResult, CommandStatus, CommandType } from "./command.js";

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

// Agent endpoints
export interface FetchCommandResponse {
	commandId: string;
	type: CommandType;
	payload: CommandPayload;
}

export interface SubmitResultRequest {
	agentId: string;
	result: CommandResult;
}

export interface SubmitResultResponse {
	ok: boolean;
}
