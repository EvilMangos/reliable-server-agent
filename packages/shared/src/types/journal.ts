import type { CommandType, HttpGetJsonResult, UnixMs } from "./command.js";

/**
 * Stages in the agent journal lifecycle for crash recovery.
 * - CLAIMED: Command has been claimed but execution not started
 * - IN_PROGRESS: Command execution is in progress
 * - RESULT_SAVED: Result saved locally, ready to report to server
 */
export type JournalStage = "CLAIMED" | "IN_PROGRESS" | "RESULT_SAVED";

/**
 * Agent journal entry persisted to disk.
 * Used for idempotent execution and crash recovery.
 * The journal ensures that after a crash, the agent can:
 * - Resume waiting for DELAY commands using scheduledEndAt
 * - Re-report HTTP_GET_JSON results without refetching using httpSnapshot
 */
export interface AgentJournal {
	/** ID of the command being executed */
	commandId: string;
	/** Lease ID for verifying ownership with server */
	leaseId: string;
	/** Type of command being executed */
	type: CommandType;
	/** When execution started */
	startedAt: UnixMs;
	/** When DELAY should end, null for non-DELAY commands */
	scheduledEndAt: UnixMs | null;
	/** Saved HTTP response for replay, null for non-HTTP or before fetch completes */
	httpSnapshot: HttpGetJsonResult | null;
	/** Current stage in the execution lifecycle */
	stage: JournalStage;
}
