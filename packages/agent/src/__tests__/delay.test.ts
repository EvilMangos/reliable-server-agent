/**
 * Tests for DELAY executor
 *
 * Covers:
 * - Wait until scheduledEndAt (not full ms duration)
 * - Return correct result structure { ok: true, tookMs }
 * - Resume with remaining time on recovery
 * - Cancellable on lease expiry
 * - Journal stage updates
 * - Random failure injection
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DelayPayload } from "@reliable-server-agent/shared";
import { createDelayExecutorContext, createTestJournal, withMockedRandom } from "./test-utils";
import { executeDelay } from "../executors/delay.js";

// Alias for clarity in delay tests - creates a DELAY-type journal
const createDelayJournal = createTestJournal;

describe("DELAY Executor", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("executeDelay", () => {
		describe("normal execution", () => {
			it("waits until scheduledEndAt, not full ms duration", async () => {
				const now = Date.now();
				const journal = createDelayJournal({
					startedAt: now,
					scheduledEndAt: now + 5000,
				});
				const context = createDelayExecutorContext(journal);

				const payload: DelayPayload = { ms: 5000 };
				const resultPromise = executeDelay(payload, context);

				// Should not resolve immediately
				await vi.advanceTimersByTimeAsync(4999);
				expect(vi.getTimerCount()).toBeGreaterThan(0);

				// Should resolve after reaching scheduledEndAt
				await vi.advanceTimersByTimeAsync(1);
				const result = await resultPromise;

				expect(result.ok).toBe(true);
				expect(result.tookMs).toBe(5000);
			});

			it("returns correct result structure with ok and tookMs", async () => {
				const now = Date.now();
				const journal = createDelayJournal({
					startedAt: now,
					scheduledEndAt: now + 1000,
				});
				const context = createDelayExecutorContext(journal);

				const payload: DelayPayload = { ms: 1000 };
				const resultPromise = executeDelay(payload, context);
				await vi.advanceTimersByTimeAsync(1000);
				const result = await resultPromise;

				expect(result).toEqual({
					ok: true,
					tookMs: 1000,
				});
			});

			it("calculates tookMs as now minus startedAt", async () => {
				const startedAt = Date.now();
				const journal = createDelayJournal({
					startedAt,
					scheduledEndAt: startedAt + 3000,
				});
				const context = createDelayExecutorContext(journal);

				const payload: DelayPayload = { ms: 3000 };
				const resultPromise = executeDelay(payload, context);
				await vi.advanceTimersByTimeAsync(3000);
				const result = await resultPromise;

				expect(result.tookMs).toBe(3000);
			});
		});

		describe("recovery behavior", () => {
			it("resumes with remaining time only when scheduledEndAt is in the future", async () => {
				const now = Date.now();
				const startedAt = now - 3000; // Started 3 seconds ago
				const scheduledEndAt = now + 2000; // Should end in 2 more seconds

				const journal = createDelayJournal({
					startedAt,
					scheduledEndAt,
					stage: "IN_PROGRESS", // Resuming after crash
				});
				const context = createDelayExecutorContext(journal);

				const payload: DelayPayload = { ms: 5000 }; // Original was 5 seconds
				const resultPromise = executeDelay(payload, context);

				// Should wait only 2 more seconds (not full 5)
				await vi.advanceTimersByTimeAsync(2000);
				const result = await resultPromise;

				expect(result.ok).toBe(true);
				expect(result.tookMs).toBe(5000); // Total from original startedAt
			});

			it("completes immediately if scheduledEndAt is in the past", async () => {
				const now = Date.now();
				const startedAt = now - 6000; // Started 6 seconds ago
				const scheduledEndAt = now - 1000; // Already past

				const journal = createDelayJournal({
					startedAt,
					scheduledEndAt,
					stage: "IN_PROGRESS",
				});
				const context = createDelayExecutorContext(journal);

				const payload: DelayPayload = { ms: 5000 };
				const resultPromise = executeDelay(payload, context);

				// Should complete without any timer advancement
				await vi.advanceTimersByTimeAsync(0);
				const result = await resultPromise;

				expect(result.ok).toBe(true);
				expect(result.tookMs).toBeGreaterThanOrEqual(5000);
			});
		});

		describe("lease expiry handling", () => {
			it("is cancellable when lease becomes invalid", async () => {
				const now = Date.now();
				const journal = createDelayJournal({
					startedAt: now,
					scheduledEndAt: now + 10000,
				});

				let leaseValid = true;
				const context = createDelayExecutorContext(journal, {
					checkLeaseValid: () => leaseValid,
				});

				const payload: DelayPayload = { ms: 10000 };
				const resultPromise = executeDelay(payload, context);

				// Set up rejection expectation BEFORE advancing timers to avoid unhandled rejection
				const rejectionPromise = expect(resultPromise).rejects.toThrow(/lease/i);

				// Advance some time
				await vi.advanceTimersByTimeAsync(2000);

				// Invalidate the lease
				leaseValid = false;

				// Advance more time - should trigger cancellation check
				await vi.advanceTimersByTimeAsync(1000);

				// Wait for the rejection to complete
				await rejectionPromise;
			});

			it("checks lease validity periodically during wait", async () => {
				const now = Date.now();
				const journal = createDelayJournal({
					startedAt: now,
					scheduledEndAt: now + 30000, // Long delay
				});

				const checkLeaseValid = vi.fn(() => true);
				const context = createDelayExecutorContext(journal, { checkLeaseValid });

				const payload: DelayPayload = { ms: 30000 };
				const resultPromise = executeDelay(payload, context);

				// Advance 10 seconds
				await vi.advanceTimersByTimeAsync(10000);

				// checkLeaseValid should have been called multiple times
				expect(checkLeaseValid).toHaveBeenCalled();

				// Complete the delay
				await vi.advanceTimersByTimeAsync(20000);
				await resultPromise;

				// Should have been called periodically
				expect(checkLeaseValid.mock.calls.length).toBeGreaterThan(1);
			});
		});

		describe("journal updates", () => {
			it("updates journal stage to IN_PROGRESS before waiting", async () => {
				const now = Date.now();
				const journal = createDelayJournal({
					startedAt: now,
					scheduledEndAt: now + 1000,
					stage: "CLAIMED",
				});
				const context = createDelayExecutorContext(journal);

				const payload: DelayPayload = { ms: 1000 };
				const resultPromise = executeDelay(payload, context);

				// Before advancing time, journal should be updated
				expect(context.journalManager.updateStage).toHaveBeenCalledWith(journal, "IN_PROGRESS");

				await vi.advanceTimersByTimeAsync(1000);
				await resultPromise;
			});

			it("does not update stage if already IN_PROGRESS (recovery case)", async () => {
				const now = Date.now();
				const journal = createDelayJournal({
					startedAt: now - 500,
					scheduledEndAt: now + 500,
					stage: "IN_PROGRESS", // Already in progress
				});
				const context = createDelayExecutorContext(journal);

				const payload: DelayPayload = { ms: 1000 };
				const resultPromise = executeDelay(payload, context);
				await vi.advanceTimersByTimeAsync(500);
				await resultPromise;

				// Should NOT call updateStage again if already IN_PROGRESS
				expect(context.journalManager.updateStage).not.toHaveBeenCalled();
			});
		});

		describe("random failure injection", () => {
			it("supports onRandomFailure callback injection", async () => {
				const now = Date.now();
				const journal = createDelayJournal({
					startedAt: now,
					scheduledEndAt: now + 2000,
				});

				const onRandomFailure = vi.fn();
				const context = createDelayExecutorContext(journal, { onRandomFailure });

				const payload: DelayPayload = { ms: 2000 };

				await withMockedRandom(0.05, async () => {
					const resultPromise = executeDelay(payload, context);

					// Set up rejection handler BEFORE advancing timers to avoid unhandled rejection
					const rejectionPromise = expect(resultPromise).rejects.toThrow("Simulated random failure");

					await vi.advanceTimersByTimeAsync(1000);

					// Wait for the rejection to complete
					await rejectionPromise;

					// Random failure callback should have been called
					expect(onRandomFailure).toHaveBeenCalled();
				});
			});

			it("throws or exits when random failure is triggered", async () => {
				const now = Date.now();
				const journal = createDelayJournal({
					startedAt: now,
					scheduledEndAt: now + 5000,
				});

				const onRandomFailure = vi.fn(() => {
					throw new Error("Simulated random failure");
				});
				const context = createDelayExecutorContext(journal, { onRandomFailure });

				const payload: DelayPayload = { ms: 5000 };

				await withMockedRandom(0.01, async () => {
					const resultPromise = executeDelay(payload, context);

					// Set up rejection handler BEFORE advancing timers to avoid unhandled rejection
					const rejectionPromise = expect(resultPromise).rejects.toThrow("Simulated random failure");

					await vi.advanceTimersByTimeAsync(1000);

					await rejectionPromise;
				});
			});
		});

		describe("edge cases", () => {
			it("handles zero ms delay", async () => {
				const now = Date.now();
				const journal = createDelayJournal({
					startedAt: now,
					scheduledEndAt: now, // Zero delay
				});
				const context = createDelayExecutorContext(journal);

				const payload: DelayPayload = { ms: 0 };
				const result = await executeDelay(payload, context);

				expect(result.ok).toBe(true);
				expect(result.tookMs).toBe(0);
			});

			it("handles very long delays correctly", async () => {
				const now = Date.now();
				const longDelay = 3600000; // 1 hour
				const journal = createDelayJournal({
					startedAt: now,
					scheduledEndAt: now + longDelay,
				});
				const context = createDelayExecutorContext(journal);

				const payload: DelayPayload = { ms: longDelay };
				const resultPromise = executeDelay(payload, context);
				await vi.advanceTimersByTimeAsync(longDelay);
				const result = await resultPromise;

				expect(result.ok).toBe(true);
				expect(result.tookMs).toBe(longDelay);
			});

			it("handles null scheduledEndAt by computing from startedAt + ms", async () => {
				const now = Date.now();
				const journal = createDelayJournal({
					startedAt: now,
					scheduledEndAt: null, // Not set by server (edge case)
				});
				const context = createDelayExecutorContext(journal);

				const payload: DelayPayload = { ms: 2000 };
				const resultPromise = executeDelay(payload, context);
				await vi.advanceTimersByTimeAsync(2000);
				const result = await resultPromise;

				expect(result.ok).toBe(true);
				expect(result.tookMs).toBeGreaterThanOrEqual(2000);
			});
		});
	});
});
