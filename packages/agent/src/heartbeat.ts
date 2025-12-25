import type { HeartbeatManager } from "./types";
import type { ServerClient } from "./types";
import type { Logger } from "./types";
import { LoggerImpl } from "./logger";

/**
 * Heartbeat manager implementation for maintaining command leases.
 * Sends periodic heartbeats to the server to extend the lease.
 */
export class HeartbeatManagerImpl implements HeartbeatManager {
	private timerId: ReturnType<typeof setInterval> | null = null;
	private currentCommandId: string | null = null;
	private currentLeaseId: string | null = null;
	private leaseValid = true;
	private readonly logger: Logger;

	constructor(
		private readonly serverClient: ServerClient,
		private readonly intervalMs: number,
		logger?: Logger,
	) {
		this.logger = logger ?? new LoggerImpl("heartbeat");
	}

	start(commandId: string, leaseId: string): void {
		this.stop(); // Stop any existing heartbeat

		this.currentCommandId = commandId;
		this.currentLeaseId = leaseId;
		this.leaseValid = true;

		this.logger.info(`Starting heartbeat for command ${commandId} (interval=${this.intervalMs}ms)`);

		this.timerId = setInterval(async () => {
			if (!this.currentCommandId || !this.currentLeaseId) {
				return;
			}

			const success = await this.serverClient.heartbeat(this.currentCommandId, this.currentLeaseId);
			if (!success) {
				this.leaseValid = false;
				this.logger.warn(`Lease invalidated for command ${this.currentCommandId}`);
				this.stop();
			}
		}, this.intervalMs);
	}

	stop(): void {
		if (this.timerId !== null) {
			clearInterval(this.timerId);
			this.timerId = null;
			this.logger.debug(`Stopped heartbeat for command ${this.currentCommandId}`);
		}
		this.currentCommandId = null;
		this.currentLeaseId = null;
	}

	isLeaseValid(): boolean {
		return this.leaseValid;
	}
}

/**
 * Factory function for creating heartbeat managers.
 * @deprecated Use `new HeartbeatManagerImpl(serverClient, intervalMs)` instead.
 */
export function createHeartbeatManager(
	serverClient: ServerClient,
	intervalMs: number,
): HeartbeatManager {
	return new HeartbeatManagerImpl(serverClient, intervalMs);
}
