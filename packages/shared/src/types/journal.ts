import type { CommandType, HttpGetJsonResult } from "./command.js";

/**
 * Agent journal stages for crash recovery
 */
export type JournalStage = "CLAIMED" | "IN_PROGRESS" | "RESULT_SAVED";

/**
 * Agent journal entry persisted to disk
 * Used for idempotent execution and crash recovery
 */
export interface AgentJournal {
	commandId: string;
	leaseId: string;
	type: CommandType;
	startedAt: number; // unix ms
	scheduledEndAt: number | null; // unix ms, for DELAY only
	httpSnapshot: HttpGetJsonResult | null; // for HTTP_GET_JSON, saved before reporting
	stage: JournalStage;
}
