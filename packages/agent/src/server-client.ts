import type {
	ClaimCommandRequest,
	ClaimCommandResponse,
	CommandResult,
	CompleteRequest,
	FailRequest,
	HeartbeatRequest,
} from "@reliable-server-agent/shared";
import type { AgentConfig } from "./config.js";
import { createLogger } from "./logger.js";

const logger = createLogger("server-client");

/**
 * Multiplier for heartbeat interval to compute lease extension.
 * Using 3x gives headroom for network delays and processing time.
 */
const LEASE_EXTENSION_MULTIPLIER = 3;

export interface ServerClient {
	claim(): Promise<ClaimCommandResponse | null>;
	heartbeat(commandId: string, leaseId: string): Promise<boolean>;
	complete(commandId: string, leaseId: string, result: CommandResult): Promise<boolean>;
	fail(commandId: string, leaseId: string, error: string, result?: CommandResult): Promise<boolean>;
}

export function createServerClient(config: AgentConfig): ServerClient {
	const { agentId, serverUrl, maxLeaseMs, heartbeatIntervalMs } = config;

	async function claim(): Promise<ClaimCommandResponse | null> {
		const url = `${serverUrl}/commands/claim`;
		const body: ClaimCommandRequest = {
			agentId,
			maxLeaseMs,
		};

		try {
			const response = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});

			if (response.status === 204) {
				logger.debug("No work available");
				return null;
			}

			if (!response.ok) {
				logger.error(`Claim failed with status ${response.status}`);
				return null;
			}

			const data = (await response.json()) as ClaimCommandResponse;
			logger.info(`Claimed command ${data.commandId} (type=${data.type}, leaseId=${data.leaseId})`);
			return data;
		} catch (err) {
			logger.error(`Claim request failed: ${err instanceof Error ? err.message : String(err)}`);
			return null;
		}
	}

	async function heartbeat(commandId: string, leaseId: string): Promise<boolean> {
		const url = `${serverUrl}/commands/${commandId}/heartbeat`;
		const body: HeartbeatRequest = {
			agentId,
			leaseId,
			extendMs: heartbeatIntervalMs * LEASE_EXTENSION_MULTIPLIER,
		};

		try {
			const response = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});

			if (response.status === 204) {
				logger.debug(`Heartbeat accepted for command ${commandId}`);
				return true;
			}

			if (response.status === 409) {
				logger.warn(`Lease expired or replaced for command ${commandId}`);
				return false;
			}

			logger.error(`Heartbeat failed with status ${response.status}`);
			return false;
		} catch (err) {
			logger.error(`Heartbeat request failed: ${err instanceof Error ? err.message : String(err)}`);
			return false;
		}
	}

	async function complete(commandId: string, leaseId: string, result: CommandResult): Promise<boolean> {
		const url = `${serverUrl}/commands/${commandId}/complete`;
		const body: CompleteRequest = {
			agentId,
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
				logger.info(`Completed command ${commandId}`);
				return true;
			}

			if (response.status === 409) {
				logger.warn(`Cannot complete command ${commandId}: lease is stale or already completed`);
				return false;
			}

			logger.error(`Complete failed with status ${response.status}`);
			return false;
		} catch (err) {
			logger.error(`Complete request failed: ${err instanceof Error ? err.message : String(err)}`);
			return false;
		}
	}

	async function fail(commandId: string, leaseId: string, error: string, result?: CommandResult): Promise<boolean> {
		const url = `${serverUrl}/commands/${commandId}/fail`;
		const body: FailRequest = {
			agentId,
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
				logger.info(`Failed command ${commandId}: ${error}`);
				return true;
			}

			if (response.status === 409) {
				logger.warn(`Cannot fail command ${commandId}: lease is stale`);
				return false;
			}

			logger.error(`Fail request failed with status ${response.status}`);
			return false;
		} catch (err) {
			logger.error(`Fail request failed: ${err instanceof Error ? err.message : String(err)}`);
			return false;
		}
	}

	return {
		claim,
		heartbeat,
		complete,
		fail,
	};
}
