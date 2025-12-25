import type { DelayPayload, DelayResult } from "@reliable-server-agent/shared";
import type { Executor, ExecutorContext, JournalManager, Logger } from "../types/index.js";
import { RANDOM_FAILURE_PROBABILITY } from "../constants.js";

/**
 * Interval between lease validity checks during delay waiting.
 */
const LEASE_CHECK_INTERVAL_MS = 1000;

/**
 * Error thrown when lease becomes invalid during delay execution.
 */
export class LeaseExpiredError extends Error {
	constructor(message: string = "Lease expired during delay execution") {
		super(message);
		this.name = "LeaseExpiredError";
	}
}

/**
 * Executor for DELAY commands.
 * Waits until scheduledEndAt, supporting resumption after crash.
 * Checks lease validity periodically during waiting.
 */
export class DelayExecutor implements Executor<DelayPayload, DelayResult> {
	constructor(
		private readonly logger: Logger,
		private readonly journalManager: JournalManager,
		private readonly onRandomFailure?: () => void,
	) {}

	/**
	 * Execute DELAY command by waiting until scheduledEndAt.
	 */
	async execute(payload: DelayPayload, context: ExecutorContext): Promise<DelayResult> {
		const { journal, checkLeaseValid } = context;

		// Compute scheduledEndAt (use journal value or compute from startedAt + ms)
		const scheduledEndAt = journal.scheduledEndAt ?? journal.startedAt + payload.ms;

		// Update journal stage to IN_PROGRESS if not already
		if (journal.stage === "CLAIMED") {
			this.journalManager.updateStage(journal, "IN_PROGRESS");
		}

		this.logger.info(`DELAY: waiting until ${new Date(scheduledEndAt).toISOString()} (${payload.ms}ms total)`);

		// Wait until scheduledEndAt, checking lease periodically
		await this.waitUntil(scheduledEndAt, checkLeaseValid);

		// Calculate tookMs from original startedAt
		const tookMs = scheduledEndAt - journal.startedAt;

		this.logger.info(`DELAY: completed, tookMs=${tookMs}`);

		return {
			ok: true,
			tookMs,
		};
	}

	/**
	 * Wait until the target time, checking lease validity periodically.
	 * Throws LeaseExpiredError if lease becomes invalid.
	 */
	private waitUntil(targetTime: number, checkLeaseValid?: () => boolean): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			let timerId: ReturnType<typeof setTimeout> | null = null;
			let checkIntervalId: ReturnType<typeof setInterval> | null = null;

			const cleanup = (): void => {
				if (timerId !== null) {
					clearTimeout(timerId);
					timerId = null;
				}
				if (checkIntervalId !== null) {
					clearInterval(checkIntervalId);
					checkIntervalId = null;
				}
			};

			const check = (): void => {
				// Check for random failure
				if (this.onRandomFailure && Math.random() < RANDOM_FAILURE_PROBABILITY) {
					cleanup();
					this.logger.warn("Random failure triggered during DELAY wait");
					try {
						this.onRandomFailure();
					} catch (err) {
						reject(err);
						return;
					}
					reject(new Error("Simulated random failure"));
					return;
				}

				// Check lease validity
				if (checkLeaseValid && !checkLeaseValid()) {
					cleanup();
					reject(new LeaseExpiredError());
					return;
				}
			};

			const now = Date.now();
			const remainingMs = targetTime - now;

			// If target time is in the past, resolve immediately
			if (remainingMs <= 0) {
				resolve();
				return;
			}

			// Set up periodic lease check
			checkIntervalId = setInterval(check, LEASE_CHECK_INTERVAL_MS);

			// Set timer for target time
			timerId = setTimeout(() => {
				cleanup();
				resolve();
			}, remainingMs);
		});
	}
}
