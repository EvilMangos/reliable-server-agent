import type { AgentJournal, CommandType, HttpGetJsonResult, JournalStage } from "@reliable-server-agent/shared";
import type { JournalManager } from "./types";
import type { Logger } from "./types";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { LoggerImpl } from "./logger";
import { formatError } from "./utils";

/**
 * Journal manager implementation for persisting agent state.
 * Uses atomic writes (temp file + rename) to ensure data integrity.
 */
export class JournalManagerImpl implements JournalManager {
	private readonly journalPath: string;
	private readonly logger: Logger;

	constructor(
		private readonly stateDir: string,
		agentId: string,
		logger?: Logger,
	) {
		this.journalPath = path.join(stateDir, `${agentId}.json`);
		this.logger = logger ?? new LoggerImpl("journal");
	}

	private ensureDir(): void {
		if (!fs.existsSync(this.stateDir)) {
			fs.mkdirSync(this.stateDir, { recursive: true });
			this.logger.info(`Created state directory: ${this.stateDir}`);
		}
	}

	getJournalPath(): string {
		return this.journalPath;
	}

	load(): AgentJournal | null {
		try {
			if (!fs.existsSync(this.journalPath)) {
				return null;
			}
			const content = fs.readFileSync(this.journalPath, "utf-8");
			const journal = JSON.parse(content) as AgentJournal;
			this.logger.info(`Loaded journal for command ${journal.commandId} (stage=${journal.stage})`);
			return journal;
		} catch (err) {
			this.logger.error(`Failed to load journal: ${formatError(err)}`);
			return null;
		}
	}

	save(journal: AgentJournal): void {
		this.ensureDir();

		// Atomic write: write to temp file, then rename
		const tempPath = `${this.journalPath}.${randomUUID()}.tmp`;
		const content = JSON.stringify(journal, null, 2);

		try {
			fs.writeFileSync(tempPath, content, "utf-8");
			fs.renameSync(tempPath, this.journalPath);
			this.logger.debug(`Saved journal for command ${journal.commandId} (stage=${journal.stage})`);
		} catch (err) {
			// Clean up temp file if it exists
			try {
				if (fs.existsSync(tempPath)) {
					fs.unlinkSync(tempPath);
				}
			} catch {
				// Ignore cleanup errors
			}
			throw err;
		}
	}

	delete(): void {
		try {
			if (fs.existsSync(this.journalPath)) {
				fs.unlinkSync(this.journalPath);
				this.logger.info("Deleted journal");
			}
		} catch (err) {
			this.logger.error(`Failed to delete journal: ${formatError(err)}`);
		}
	}

	createClaimed(
		commandId: string,
		leaseId: string,
		type: CommandType,
		startedAt: number,
		scheduledEndAt: number | null,
	): AgentJournal {
		const journal: AgentJournal = {
			commandId,
			leaseId,
			type,
			startedAt,
			scheduledEndAt,
			httpSnapshot: null,
			stage: "CLAIMED",
		};
		this.save(journal);
		return journal;
	}

	updateStage(journal: AgentJournal, stage: JournalStage): void {
		journal.stage = stage;
		this.save(journal);
	}

	updateHttpSnapshot(journal: AgentJournal, snapshot: HttpGetJsonResult): void {
		journal.httpSnapshot = snapshot;
		journal.stage = "RESULT_SAVED";
		this.save(journal);
	}
}

/**
 * Factory function for creating journal managers.
 * @deprecated Use `new JournalManagerImpl(stateDir, agentId)` instead.
 */
export function createJournalManager(stateDir: string, agentId: string): JournalManager {
	return new JournalManagerImpl(stateDir, agentId);
}
