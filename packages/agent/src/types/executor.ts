import type { AgentJournal, CommandPayload, CommandResult } from "@reliable-server-agent/shared";

/**
 * Context provided to executors during command execution.
 */
export interface ExecutorContext {
	/** The journal entry for the current command. */
	journal: AgentJournal;
	/** Optional function to check if the lease is still valid. */
	checkLeaseValid?: () => boolean;
}

/**
 * Interface for command executors.
 * Each command type (DELAY, HTTP_GET_JSON) has its own executor implementation.
 */
export interface Executor<
	TPayload extends CommandPayload = CommandPayload,
	TResult extends CommandResult = CommandResult,
> {
	/**
	 * Execute the command with the given payload and context.
	 * @param payload - The command-specific payload.
	 * @param context - The execution context including journal and lease validation.
	 * @returns The command result.
	 */
	execute(payload: TPayload, context: ExecutorContext): Promise<TResult>;
}
