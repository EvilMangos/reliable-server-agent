import type { AgentJournal, CommandType, HttpGetJsonResult, JournalStage } from "@reliable-server-agent/shared";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { createLogger } from "./logger.js";

const logger = createLogger("journal");

export interface JournalManager {
	getJournalPath(): string;
	load(): AgentJournal | null;
	save(journal: AgentJournal): void;
	delete(): void;
	createClaimed(
		commandId: string,
		leaseId: string,
		type: CommandType,
		startedAt: number,
		scheduledEndAt: number | null
	): AgentJournal;
	updateStage(journal: AgentJournal, stage: JournalStage): void;
	updateHttpSnapshot(journal: AgentJournal, snapshot: HttpGetJsonResult): void;
}

export function createJournalManager(stateDir: string, agentId: string): JournalManager {
	const journalPath = path.join(stateDir, `${agentId}.json`);

	function ensureDir(): void {
		if (!fs.existsSync(stateDir)) {
			fs.mkdirSync(stateDir, { recursive: true });
			logger.info(`Created state directory: ${stateDir}`);
		}
	}

	function getJournalPath(): string {
		return journalPath;
	}

	function load(): AgentJournal | null {
		try {
			if (!fs.existsSync(journalPath)) {
				return null;
			}
			const content = fs.readFileSync(journalPath, "utf-8");
			const journal = JSON.parse(content) as AgentJournal;
			logger.info(`Loaded journal for command ${journal.commandId} (stage=${journal.stage})`);
			return journal;
		} catch (err) {
			logger.error(`Failed to load journal: ${err instanceof Error ? err.message : String(err)}`);
			return null;
		}
	}

	function save(journal: AgentJournal): void {
		ensureDir();

		// Atomic write: write to temp file, then rename
		const tempPath = `${journalPath}.${randomUUID()}.tmp`;
		const content = JSON.stringify(journal, null, 2);

		try {
			fs.writeFileSync(tempPath, content, "utf-8");
			fs.renameSync(tempPath, journalPath);
			logger.debug(`Saved journal for command ${journal.commandId} (stage=${journal.stage})`);
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

	function deleteJournal(): void {
		try {
			if (fs.existsSync(journalPath)) {
				fs.unlinkSync(journalPath);
				logger.info("Deleted journal");
			}
		} catch (err) {
			logger.error(`Failed to delete journal: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	function createClaimed(
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
		save(journal);
		return journal;
	}

	function updateStage(journal: AgentJournal, stage: JournalStage): void {
		journal.stage = stage;
		save(journal);
	}

	function updateHttpSnapshot(journal: AgentJournal, snapshot: HttpGetJsonResult): void {
		journal.httpSnapshot = snapshot;
		journal.stage = "RESULT_SAVED";
		save(journal);
	}

	return {
		getJournalPath,
		load,
		save,
		delete: deleteJournal,
		createClaimed,
		updateStage,
		updateHttpSnapshot,
	};
}
