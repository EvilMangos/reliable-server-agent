import type { ServerClient } from "./server-client.js";
import { createLogger } from "./logger.js";

const logger = createLogger("heartbeat");

export interface HeartbeatManager {
	start(commandId: string, leaseId: string): void;
	stop(): void;
	isLeaseValid(): boolean;
}

export function createHeartbeatManager(
	serverClient: ServerClient,
	intervalMs: number,
): HeartbeatManager {
	let timerId: ReturnType<typeof setInterval> | null = null;
	let currentCommandId: string | null = null;
	let currentLeaseId: string | null = null;
	let leaseValid = true;

	function start(commandId: string, leaseId: string): void {
		stop(); // Stop any existing heartbeat

		currentCommandId = commandId;
		currentLeaseId = leaseId;
		leaseValid = true;

		logger.info(`Starting heartbeat for command ${commandId} (interval=${intervalMs}ms)`);

		timerId = setInterval(async () => {
			if (!currentCommandId || !currentLeaseId) {
				return;
			}

			const success = await serverClient.heartbeat(currentCommandId, currentLeaseId);
			if (!success) {
				leaseValid = false;
				logger.warn(`Lease invalidated for command ${currentCommandId}`);
				stop();
			}
		}, intervalMs);
	}

	function stop(): void {
		if (timerId !== null) {
			clearInterval(timerId);
			timerId = null;
			logger.debug(`Stopped heartbeat for command ${currentCommandId}`);
		}
		currentCommandId = null;
		currentLeaseId = null;
	}

	function isLeaseValid(): boolean {
		return leaseValid;
	}

	return {
		start,
		stop,
		isLeaseValid,
	};
}
