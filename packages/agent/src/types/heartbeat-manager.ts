/**
 * Manager for sending periodic heartbeats to maintain command lease.
 */
export interface HeartbeatManager {
	start(commandId: string, leaseId: string): void;
	stop(): void;
	isLeaseValid(): boolean;
}
