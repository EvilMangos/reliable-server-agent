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
import {
	createTestDelayExecutor,
	createTestJournal,
	setupFakeTimers,
	teardownFakeTimers,
	withMockedRandom,
} from "./test-utils.js";

describe("DELAY Executor", () => {
	beforeEach(() => {
		setupFakeTimers();
	});

	afterEach(() => {
		teardownFakeTimers();
	});

	describe("DelayExecutor.execute", () => {
		describe("normal execution", () => {
			it("waits until scheduledEndAt, not full ms duration", async () => {
				const now = Date.now();
				const journal = createTestJournal({
					startedAt: now,
					scheduledEndAt: now + 5000,
				});
				const { executor } = createTestDelayExecutor(journal);

				const payload: DelayPayload = { ms: 5000 };
				const resultPromise = executor.execute(payload, { journal, checkLeaseValid: () => true });

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
				const journal = createTestJournal({
					startedAt: now,
					scheduledEndAt: now + 1000,
				});
				const { executor } = createTestDelayExecutor(journal);

				const payload: DelayPayload = { ms: 1000 };
				const resultPromise = executor.execute(payload, { journal, checkLeaseValid: () => true });
				await vi.advanceTimersByTimeAsync(1000);
				const result = await resultPromise;

				expect(result).toEqual({
					ok: true,
					tookMs: 1000,
				});
			});

			it("calculates tookMs as now minus startedAt", async () => {
				const startedAt = Date.now();
				const journal = createTestJournal({
					startedAt,
					scheduledEndAt: startedAt + 3000,
				});
				const { executor } = createTestDelayExecutor(journal);

				const payload: DelayPayload = { ms: 3000 };
				const resultPromise = executor.execute(payload, { journal, checkLeaseValid: () => true });
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

				const journal = createTestJournal({
					startedAt,
					scheduledEndAt,
					stage: "IN_PROGRESS", // Resuming after crash
				});
				const { executor } = createTestDelayExecutor(journal);

				const payload: DelayPayload = { ms: 5000 }; // Original was 5 seconds
				const resultPromise = executor.execute(payload, { journal, checkLeaseValid: () => true });

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

				const journal = createTestJournal({
					startedAt,
					scheduledEndAt,
					stage: "IN_PROGRESS",
				});
				const { executor } = createTestDelayExecutor(journal);

				const payload: DelayPayload = { ms: 5000 };
				const resultPromise = executor.execute(payload, { journal, checkLeaseValid: () => true });

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
				const journal = createTestJournal({
					startedAt: now,
					scheduledEndAt: now + 10000,
				});
				const { executor } = createTestDelayExecutor(journal);

				let leaseValid = true;
				const payload: DelayPayload = { ms: 10000 };
				const resultPromise = executor.execute(payload, { journal, checkLeaseValid: () => leaseValid });

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
				const journal = createTestJournal({
					startedAt: now,
					scheduledEndAt: now + 30000, // Long delay
				});
				const { executor } = createTestDelayExecutor(journal);

				const checkLeaseValid = vi.fn(() => true);
				const payload: DelayPayload = { ms: 30000 };
				const resultPromise = executor.execute(payload, { journal, checkLeaseValid });

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
				const journal = createTestJournal({
					startedAt: now,
					scheduledEndAt: now + 1000,
					stage: "CLAIMED",
				});
				const { executor, journalManager } = createTestDelayExecutor(journal);

				const payload: DelayPayload = { ms: 1000 };
				const resultPromise = executor.execute(payload, { journal, checkLeaseValid: () => true });

				// Before advancing time, journal should be updated
				expect(journalManager.updateStage).toHaveBeenCalledWith(journal, "IN_PROGRESS");

				await vi.advanceTimersByTimeAsync(1000);
				await resultPromise;
			});

			it("does not update stage if already IN_PROGRESS (recovery case)", async () => {
				const now = Date.now();
				const journal = createTestJournal({
					startedAt: now - 500,
					scheduledEndAt: now + 500,
					stage: "IN_PROGRESS", // Already in progress
				});
				const { executor, journalManager } = createTestDelayExecutor(journal);

				const payload: DelayPayload = { ms: 1000 };
				const resultPromise = executor.execute(payload, { journal, checkLeaseValid: () => true });
				await vi.advanceTimersByTimeAsync(500);
				await resultPromise;

				// Should NOT call updateStage again if already IN_PROGRESS
				expect(journalManager.updateStage).not.toHaveBeenCalled();
			});
		});

		describe("random failure injection", () => {
			it("supports onRandomFailure callback injection", async () => {
				const now = Date.now();
				const journal = createTestJournal({
					startedAt: now,
					scheduledEndAt: now + 2000,
				});

				const onRandomFailure = vi.fn();
				const { executor } = createTestDelayExecutor(journal, { onRandomFailure });

				const payload: DelayPayload = { ms: 2000 };

				await withMockedRandom(0.05, async () => {
					const resultPromise = executor.execute(payload, { journal, checkLeaseValid: () => true });

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
				const journal = createTestJournal({
					startedAt: now,
					scheduledEndAt: now + 5000,
				});

				const onRandomFailure = vi.fn(() => {
					throw new Error("Simulated random failure");
				});
				const { executor } = createTestDelayExecutor(journal, { onRandomFailure });

				const payload: DelayPayload = { ms: 5000 };

				await withMockedRandom(0.01, async () => {
					const resultPromise = executor.execute(payload, { journal, checkLeaseValid: () => true });

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
				const journal = createTestJournal({
					startedAt: now,
					scheduledEndAt: now, // Zero delay
				});
				const { executor } = createTestDelayExecutor(journal);

				const payload: DelayPayload = { ms: 0 };
				const result = await executor.execute(payload, { journal, checkLeaseValid: () => true });

				expect(result.ok).toBe(true);
				expect(result.tookMs).toBe(0);
			});

			it("handles very long delays correctly", async () => {
				const now = Date.now();
				const longDelay = 3600000; // 1 hour
				const journal = createTestJournal({
					startedAt: now,
					scheduledEndAt: now + longDelay,
				});
				const { executor } = createTestDelayExecutor(journal);

				const payload: DelayPayload = { ms: longDelay };
				const resultPromise = executor.execute(payload, { journal, checkLeaseValid: () => true });
				await vi.advanceTimersByTimeAsync(longDelay);
				const result = await resultPromise;

				expect(result.ok).toBe(true);
				expect(result.tookMs).toBe(longDelay);
			});

			it("handles null scheduledEndAt by computing from startedAt + ms", async () => {
				const now = Date.now();
				const journal = createTestJournal({
					startedAt: now,
					scheduledEndAt: null, // Not set by server (edge case)
				});
				const { executor } = createTestDelayExecutor(journal);

				const payload: DelayPayload = { ms: 2000 };
				const resultPromise = executor.execute(payload, { journal, checkLeaseValid: () => true });
				await vi.advanceTimersByTimeAsync(2000);
				const result = await resultPromise;

				expect(result.ok).toBe(true);
				expect(result.tookMs).toBeGreaterThanOrEqual(2000);
			});

			it("handles negative ms value by completing immediately", async () => {
				const now = Date.now();
				const journal = createTestJournal({
					startedAt: now,
					scheduledEndAt: now - 1000, // Negative delay results in past scheduledEndAt
				});
				const { executor } = createTestDelayExecutor(journal);

				const payload: DelayPayload = { ms: -1000 };
				const result = await executor.execute(payload, { journal, checkLeaseValid: () => true });

				// When scheduledEndAt is in the past, it completes immediately
				expect(result.ok).toBe(true);
				// tookMs is scheduledEndAt - startedAt which equals -1000, but the implementation
				// returns the actual computed value based on the journal
				expect(result.tookMs).toBe(-1000);
			});

			it("handles non-integer ms value by using it directly", async () => {
				const now = Date.now();
				const msValue = 5.5;
				const journal = createTestJournal({
					startedAt: now,
					scheduledEndAt: now + msValue,
				});
				const { executor } = createTestDelayExecutor(journal);

				const payload: DelayPayload = { ms: msValue };
				const resultPromise = executor.execute(payload, { journal, checkLeaseValid: () => true });

				// Advance by 6ms to cover the fractional value
				await vi.advanceTimersByTimeAsync(6);
				const result = await resultPromise;

				expect(result.ok).toBe(true);
				expect(result.tookMs).toBe(msValue);
			});

			it("handles very small positive ms value (1ms)", async () => {
				const now = Date.now();
				const journal = createTestJournal({
					startedAt: now,
					scheduledEndAt: now + 1,
				});
				const { executor } = createTestDelayExecutor(journal);

				const payload: DelayPayload = { ms: 1 };
				const resultPromise = executor.execute(payload, { journal, checkLeaseValid: () => true });
				await vi.advanceTimersByTimeAsync(1);
				const result = await resultPromise;

				expect(result.ok).toBe(true);
				expect(result.tookMs).toBe(1);
			});
		});
	});
});
