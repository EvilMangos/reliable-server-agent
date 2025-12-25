import type { AgentJournal, CommandType, HttpGetJsonResult, JournalStage } from "@reliable-server-agent/shared";

/**
 * Manager for agent journal persistence.
 * Handles atomic writes and recovery from saved state.
 */
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
