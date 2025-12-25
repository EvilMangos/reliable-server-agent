import type { DelayPayload, DelayResult } from "@reliable-server-agent/shared";
import type { DelayExecutionContext } from "../types";
import { LoggerImpl } from "../logger";
import { RANDOM_FAILURE_PROBABILITY } from "../constants";

const logger = new LoggerImpl("delay-executor");

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
 * Execute DELAY command by waiting until scheduledEndAt.
 * Supports resumption after crash by using journal's scheduledEndAt.
 * Checks lease validity periodically during waiting.
 */
export async function executeDelay(
	payload: DelayPayload,
	context: DelayExecutionContext,
): Promise<DelayResult> {
	const { journal, journalManager, checkLeaseValid, onRandomFailure } = context;

	// Compute scheduledEndAt (use journal value or compute from startedAt + ms)
	const scheduledEndAt = journal.scheduledEndAt ?? journal.startedAt + payload.ms;

	// Update journal stage to IN_PROGRESS if not already
	if (journal.stage === "CLAIMED") {
		journalManager.updateStage(journal, "IN_PROGRESS");
	}

	logger.info(`DELAY: waiting until ${new Date(scheduledEndAt).toISOString()} (${payload.ms}ms total)`);

	// Wait until scheduledEndAt, checking lease periodically
	await waitUntil(scheduledEndAt, checkLeaseValid, onRandomFailure);

	// Calculate tookMs from original startedAt
	const tookMs = scheduledEndAt - journal.startedAt;

	logger.info(`DELAY: completed, tookMs=${tookMs}`);

	return {
		ok: true,
		tookMs,
	};
}

/**
 * Wait until the target time, checking lease validity periodically.
 * Throws LeaseExpiredError if lease becomes invalid.
 */
async function waitUntil(
	targetTime: number,
	checkLeaseValid: () => boolean,
	onRandomFailure?: () => void,
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		let timerId: ReturnType<typeof setTimeout> | null = null;
		let checkIntervalId: ReturnType<typeof setInterval> | null = null;

		function cleanup(): void {
			if (timerId !== null) {
				clearTimeout(timerId);
				timerId = null;
			}
			if (checkIntervalId !== null) {
				clearInterval(checkIntervalId);
				checkIntervalId = null;
			}
		}

		function check(): void {
			// Check for random failure
			if (onRandomFailure && Math.random() < RANDOM_FAILURE_PROBABILITY) {
				cleanup();
				logger.warn("Random failure triggered during DELAY wait");
				try {
					onRandomFailure();
				} catch (err) {
					reject(err);
					return;
				}
				reject(new Error("Simulated random failure"));
				return;
			}

			// Check lease validity
			if (!checkLeaseValid()) {
				cleanup();
				reject(new LeaseExpiredError());
				return;
			}
		}

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
