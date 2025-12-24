import Database from "better-sqlite3";
import type { CommandRecord, CommandType } from "@reliable-server-agent/shared";

/**
 * SQLite database wrapper for command persistence
 * Handles schema creation and provides atomic operations
 */
export class CommandDatabase {
	private db: Database.Database;

	constructor(dbPath: string = ":memory:") {
		this.db = new Database(dbPath);
		this.db.pragma("journal_mode = WAL");
		this.initSchema();
	}

	private initSchema(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS commands (
				id TEXT PRIMARY KEY,
				type TEXT NOT NULL,
				payloadJson TEXT NOT NULL,
				status TEXT NOT NULL DEFAULT 'PENDING',
				resultJson TEXT,
				error TEXT,
				agentId TEXT,
				leaseId TEXT,
				leaseExpiresAt INTEGER,
				createdAt INTEGER NOT NULL,
				startedAt INTEGER,
				attempt INTEGER NOT NULL DEFAULT 0,
				scheduledEndAt INTEGER
			);

			CREATE INDEX IF NOT EXISTS idx_commands_status ON commands(status);
			CREATE INDEX IF NOT EXISTS idx_commands_leaseExpiresAt ON commands(leaseExpiresAt);
			CREATE INDEX IF NOT EXISTS idx_commands_createdAt ON commands(createdAt);
		`);
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
		const stmt = this.db.prepare(`
			INSERT INTO commands (id, type, payloadJson, status, createdAt, attempt)
			VALUES (?, ?, ?, 'PENDING', ?, 0)
		`);
		stmt.run(id, type, JSON.stringify(payload), createdAt);
		return this.getCommand(id)!;
	}

	/**
	 * Get a command by ID
	 */
	getCommand(id: string): CommandRecord | null {
		const stmt = this.db.prepare(`
			SELECT * FROM commands WHERE id = ?
		`);
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
			const selectStmt = this.db.prepare(`
				SELECT * FROM commands
				WHERE status = 'PENDING'
				ORDER BY createdAt ASC
				LIMIT 1
			`);
			const command = selectStmt.get() as CommandRecord | undefined;

			if (!command) {
				return null;
			}

			const leaseExpiresAt = now + maxLeaseMs;
			const startedAt = now;
			const newAttempt = command.attempt + 1;

			// Calculate scheduledEndAt for DELAY commands
			let scheduledEndAt: number | null = null;
			if (command.type === "DELAY") {
				const payload = JSON.parse(command.payloadJson) as { ms: number };
				scheduledEndAt = startedAt + payload.ms;
			}

			// Update command to RUNNING with lease
			const updateStmt = this.db.prepare(`
				UPDATE commands
				SET status = 'RUNNING',
					agentId = ?,
					leaseId = ?,
					leaseExpiresAt = ?,
					startedAt = ?,
					attempt = ?,
					scheduledEndAt = ?
				WHERE id = ?
			`);
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
		const stmt = this.db.prepare(`
			UPDATE commands
			SET leaseExpiresAt = ?
			WHERE id = ?
				AND status = 'RUNNING'
				AND agentId = ?
				AND leaseId = ?
		`);
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
		const stmt = this.db.prepare(`
			UPDATE commands
			SET status = 'COMPLETED',
				resultJson = ?,
				leaseExpiresAt = NULL
			WHERE id = ?
				AND status = 'RUNNING'
				AND agentId = ?
				AND leaseId = ?
		`);
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
		const stmt = this.db.prepare(`
			UPDATE commands
			SET status = 'FAILED',
				error = ?,
				resultJson = ?,
				leaseExpiresAt = NULL
			WHERE id = ?
				AND status = 'RUNNING'
				AND agentId = ?
				AND leaseId = ?
		`);
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
	 * Find all RUNNING commands with expired leases
	 */
	findExpiredLeases(now: number): CommandRecord[] {
		const stmt = this.db.prepare(`
			SELECT * FROM commands
			WHERE status = 'RUNNING'
				AND leaseExpiresAt IS NOT NULL
				AND leaseExpiresAt <= ?
		`);
		return stmt.all(now) as CommandRecord[];
	}

	/**
	 * Reset expired RUNNING commands back to PENDING
	 * Returns number of commands reset
	 */
	resetExpiredLeases(now: number): number {
		const stmt = this.db.prepare(`
			UPDATE commands
			SET status = 'PENDING',
				agentId = NULL,
				leaseId = NULL,
				leaseExpiresAt = NULL,
				startedAt = NULL,
				scheduledEndAt = NULL
			WHERE status = 'RUNNING'
				AND leaseExpiresAt IS NOT NULL
				AND leaseExpiresAt <= ?
		`);
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
