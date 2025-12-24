export type CommandStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
export type CommandType = 'DELAY' | 'HTTP_GET_JSON';

export interface DelayPayload {
  ms: number;
}

export interface HttpGetJsonPayload {
  url: string;
}

export type CommandPayload = DelayPayload | HttpGetJsonPayload;

export interface DelayResult {
  ok: boolean;
  tookMs: number;
}

export interface HttpGetJsonResult {
  status: number;
  body: unknown;
  truncated: boolean;
  bytesReturned: number;
  error: string | null;
}

export type CommandResult = DelayResult | HttpGetJsonResult;

export interface Command {
  id: string;
  type: CommandType;
  payload: CommandPayload;
  status: CommandStatus;
  result?: CommandResult;
  agentId?: string;
  createdAt: string;
  updatedAt: string;
}
