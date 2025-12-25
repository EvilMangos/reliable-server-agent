import type { CommandRecord, CommandType } from "@reliable-server-agent/shared";

/**
 * Repository interface for command persistence operations
 *
 * This abstraction allows the service layer to depend on an interface
 * rather than a concrete database implementation, following DIP.
 */
export interface CommandRepository {
	/**
	 * Create a new command in PENDING state
	 */
	createCommand(
		id: string,
		type: CommandType,
		payload: object,
		createdAt: number,
	): CommandRecord;

	/**
	 * Get a command by ID
	 */
	getCommand(id: string): CommandRecord | null;

	/**
	 * Atomically claim the oldest PENDING command
	 * Returns the claimed command or null if none available
	 */
	claimCommand(
		agentId: string,
		leaseId: string,
		maxLeaseMs: number,
		now: number,
	): CommandRecord | null;

	/**
	 * Extend lease for a command
	 * Returns true if successful, false if lease is not current
	 */
	heartbeat(
		commandId: string,
		agentId: string,
		leaseId: string,
		extendMs: number,
		now: number,
	): boolean;

	/**
	 * Complete a command with result
	 * Returns true if successful, false if lease is not current
	 */
	completeCommand(
		commandId: string,
		agentId: string,
		leaseId: string,
		result: object,
	): boolean;

	/**
	 * Fail a command with error
	 * Returns true if successful, false if lease is not current
	 */
	failCommand(
		commandId: string,
		agentId: string,
		leaseId: string,
		error: string,
		result?: object,
	): boolean;

	/**
	 * Reset expired RUNNING commands back to PENDING
	 * Returns number of commands reset
	 */
	resetExpiredLeases(now: number): number;

	/**
	 * Close the repository connection
	 */
	close(): void;
}
