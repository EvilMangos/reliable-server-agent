import type {
	ClaimCommandRequest,
	ClaimCommandResponse,
	CommandResult,
	CompleteRequest,
	FailRequest,
	HeartbeatRequest,
} from "@reliable-server-agent/shared";
import type { AgentConfig } from "./types";
import type { ServerClient } from "./types";
import type { Logger } from "./types";
import { LoggerImpl } from "./logger";
import { formatError } from "./utils";

/**
 * Multiplier applied to heartbeat interval to compute lease extension.
 * Using 3x gives headroom for network delays and processing time.
 */
const HEARTBEAT_TO_LEASE_MULTIPLIER = 3;

/**
 * Server client implementation for communicating with the control server.
 * Handles claim, heartbeat, complete, and fail operations.
 */
export class ServerClientImpl implements ServerClient {
	private readonly agentId: string;
	private readonly serverUrl: string;
	private readonly maxLeaseMs: number;
	private readonly heartbeatIntervalMs: number;
	private readonly logger: Logger;

	constructor(config: AgentConfig, logger?: Logger) {
		this.agentId = config.agentId;
		this.serverUrl = config.serverUrl;
		this.maxLeaseMs = config.maxLeaseMs;
		this.heartbeatIntervalMs = config.heartbeatIntervalMs;
		this.logger = logger ?? new LoggerImpl("server-client");
	}

	async claim(): Promise<ClaimCommandResponse | null> {
		const url = `${this.serverUrl}/commands/claim`;
		const body: ClaimCommandRequest = {
			agentId: this.agentId,
			maxLeaseMs: this.maxLeaseMs,
		};

		try {
			const response = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});

			if (response.status === 204) {
				this.logger.debug("No work available");
				return null;
			}

			if (!response.ok) {
				this.logger.error(`Claim failed with status ${response.status}`);
				return null;
			}

			const data = (await response.json()) as ClaimCommandResponse;
			this.logger.info(`Claimed command ${data.commandId} (type=${data.type}, leaseId=${data.leaseId})`);
			return data;
		} catch (err) {
			this.logger.error(`Claim request failed: ${formatError(err)}`);
			return null;
		}
	}

	async heartbeat(commandId: string, leaseId: string): Promise<boolean> {
		const url = `${this.serverUrl}/commands/${commandId}/heartbeat`;
		const body: HeartbeatRequest = {
			agentId: this.agentId,
			leaseId,
			extendMs: this.heartbeatIntervalMs * HEARTBEAT_TO_LEASE_MULTIPLIER,
		};

		try {
			const response = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});

			if (response.status === 204) {
				this.logger.debug(`Heartbeat accepted for command ${commandId}`);
				return true;
			}

			if (response.status === 409) {
				this.logger.warn(`Lease expired or replaced for command ${commandId}`);
				return false;
			}

			this.logger.error(`Heartbeat failed with status ${response.status}`);
			return false;
		} catch (err) {
			this.logger.error(`Heartbeat request failed: ${formatError(err)}`);
			return false;
		}
	}

	async complete(commandId: string, leaseId: string, result: CommandResult): Promise<boolean> {
		const url = `${this.serverUrl}/commands/${commandId}/complete`;
		const body: CompleteRequest = {
			agentId: this.agentId,
			leaseId,
			result,
		};

		try {
			const response = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});

			if (response.status === 204) {
				this.logger.info(`Completed command ${commandId}`);
				return true;
			}

			if (response.status === 409) {
				this.logger.warn(`Cannot complete command ${commandId}: lease is stale or already completed`);
				return false;
			}

			this.logger.error(`Complete failed with status ${response.status}`);
			return false;
		} catch (err) {
			this.logger.error(`Complete request failed: ${formatError(err)}`);
			return false;
		}
	}

	async fail(commandId: string, leaseId: string, error: string, result?: CommandResult): Promise<boolean> {
		const url = `${this.serverUrl}/commands/${commandId}/fail`;
		const body: FailRequest = {
			agentId: this.agentId,
			leaseId,
			error,
			result,
		};

		try {
			const response = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});

			if (response.status === 204) {
				this.logger.info(`Failed command ${commandId}: ${error}`);
				return true;
			}

			if (response.status === 409) {
				this.logger.warn(`Cannot fail command ${commandId}: lease is stale`);
				return false;
			}

			this.logger.error(`Fail request failed with status ${response.status}`);
			return false;
		} catch (err) {
			this.logger.error(`Fail request failed: ${formatError(err)}`);
			return false;
		}
	}
}
