import Database from "better-sqlite3";
import { injectable } from "inversify";
import { COMMAND_TYPE, type CommandRecord, type CommandType } from "@reliable-server-agent/shared";
import type { CommandRepository } from "../contracts/index.js";
import { QUERIES } from "./queries.js";
import { SCHEMA } from "./schema.js";

/**
 * SQLite database wrapper for command persistence
 * Handles schema creation and provides atomic operations
 */
@injectable()
export class CommandDatabase implements CommandRepository {
	private db: Database.Database;

	constructor(db: Database.Database) {
		this.db = db;
		this.initSchema();
	}

	private initSchema(): void {
		this.db.exec(SCHEMA);
	}

	/**
	 * Create a new command in PENDING state
	 */
	createCommand(
		id: string,
		type: CommandType,
		payload: object,
		createdAt: number,
	): CommandRecord {
		const stmt = this.db.prepare(QUERIES.INSERT_COMMAND);
		stmt.run(id, type, JSON.stringify(payload), createdAt);
		return this.getCommand(id)!;
	}

	/**
	 * Get a command by ID
	 */
	getCommand(id: string): CommandRecord | null {
		const stmt = this.db.prepare(QUERIES.SELECT_BY_ID);
		const row = stmt.get(id) as CommandRecord | undefined;
		return row ?? null;
	}

	/**
	 * Atomically claim the oldest PENDING command
	 * Returns the claimed command or null if none available
	 */
	claimCommand(
		agentId: string,
		leaseId: string,
		maxLeaseMs: number,
		now: number,
	): CommandRecord | null {
		const transaction = this.db.transaction(() => {
			// Find oldest PENDING command
			const selectStmt = this.db.prepare(QUERIES.SELECT_OLDEST_PENDING);
			const command = selectStmt.get() as CommandRecord | undefined;

			if (!command) {
				return null;
			}

			const leaseExpiresAt = now + maxLeaseMs;
			const startedAt = now;
			const newAttempt = command.attempt + 1;

			// Calculate scheduledEndAt for DELAY commands
			let scheduledEndAt: number | null = null;
			if (command.type === COMMAND_TYPE.DELAY) {
				const payload = JSON.parse(command.payloadJson) as { ms: number };
				scheduledEndAt = startedAt + payload.ms;
			}

			// Update command to RUNNING with lease
			const updateStmt = this.db.prepare(QUERIES.UPDATE_CLAIM);
			updateStmt.run(
				agentId,
				leaseId,
				leaseExpiresAt,
				startedAt,
				newAttempt,
				scheduledEndAt,
				command.id,
			);

			return this.getCommand(command.id);
		});

		return transaction();
	}

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
	): boolean {
		const stmt = this.db.prepare(QUERIES.UPDATE_HEARTBEAT);
		const result = stmt.run(now + extendMs, commandId, agentId, leaseId);
		return result.changes > 0;
	}

	/**
	 * Complete a command with result
	 * Returns true if successful, false if lease is not current
	 */
	completeCommand(
		commandId: string,
		agentId: string,
		leaseId: string,
		result: object,
	): boolean {
		const stmt = this.db.prepare(QUERIES.UPDATE_COMPLETE);
		const updateResult = stmt.run(JSON.stringify(result), commandId, agentId, leaseId);
		return updateResult.changes > 0;
	}

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
	): boolean {
		const stmt = this.db.prepare(QUERIES.UPDATE_FAIL);
		const updateResult = stmt.run(
			error,
			result ? JSON.stringify(result) : null,
			commandId,
			agentId,
			leaseId,
		);
		return updateResult.changes > 0;
	}

	/**
	 * Reset expired RUNNING commands back to PENDING
	 * Returns number of commands reset
	 */
	resetExpiredLeases(now: number): number {
		const stmt = this.db.prepare(QUERIES.RESET_EXPIRED_LEASES);
		const result = stmt.run(now);
		return result.changes;
	}

	/**
	 * Close database connection
	 */
	close(): void {
		this.db.close();
	}
}

/**
 * Factory function to create a CommandDatabase with a new SQLite connection
 * Configures WAL mode for better concurrent performance
 */
export function createCommandDatabase(dbPath: string = ":memory:"): CommandDatabase {
	const db = new Database(dbPath);
	db.pragma("journal_mode = WAL");
	return new CommandDatabase(db);
}
