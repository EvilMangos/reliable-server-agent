import type { AgentJournal } from "@reliable-server-agent/shared";
import type { JournalManager } from "./journal-manager";

/**
 * Execution context for the DELAY command executor.
 */
export interface DelayExecutionContext {
	journal: AgentJournal;
	journalManager: JournalManager;
	checkLeaseValid: () => boolean;
	onRandomFailure?: () => void;
}

/**
 * Execution context for the HTTP_GET_JSON command executor.
 */
export interface HttpGetJsonExecutionContext {
	journal: AgentJournal;
	journalManager: JournalManager;
	onRandomFailure?: () => void;
}
