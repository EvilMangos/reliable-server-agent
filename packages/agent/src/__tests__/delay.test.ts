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
import type { AgentJournal, DelayPayload } from "@reliable-server-agent/shared";
import type { JournalManager } from "../journal.js";

// Mock JournalManager for testing
function createMockJournalManager(journal: AgentJournal): JournalManager {
	return {
		getJournalPath: vi.fn(() => "/mock/path/agent.json"),
		load: vi.fn(() => journal),
		save: vi.fn(),
		delete: vi.fn(),
		createClaimed: vi.fn(() => journal),
		updateStage: vi.fn((j: AgentJournal, stage: string) => {
			j.stage = stage as AgentJournal["stage"];
		}),
		updateHttpSnapshot: vi.fn(),
	};
}

// Create a basic journal for DELAY commands
function createDelayJournal(overrides: Partial<AgentJournal> = {}): AgentJournal {
	return {
		commandId: "cmd-123",
		leaseId: "lease-456",
		type: "DELAY",
		startedAt: Date.now(),
		scheduledEndAt: Date.now() + 5000,
		httpSnapshot: null,
		stage: "CLAIMED",
		...overrides,
	};
}

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
				const { executeDelay } = await import("../executors/delay.js");

				const now = Date.now();
				const journal = createDelayJournal({
					startedAt: now,
					scheduledEndAt: now + 5000,
				});
				const journalManager = createMockJournalManager(journal);

				const payload: DelayPayload = { ms: 5000 };
				const context = {
					journal,
					journalManager,
					checkLeaseValid: () => true,
				};

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
				const { executeDelay } = await import("../executors/delay.js");

				const now = Date.now();
				const journal = createDelayJournal({
					startedAt: now,
					scheduledEndAt: now + 1000,
				});
				const journalManager = createMockJournalManager(journal);

				const payload: DelayPayload = { ms: 1000 };
				const context = {
					journal,
					journalManager,
					checkLeaseValid: () => true,
				};

				const resultPromise = executeDelay(payload, context);
				await vi.advanceTimersByTimeAsync(1000);
				const result = await resultPromise;

				expect(result).toEqual({
					ok: true,
					tookMs: 1000,
				});
			});

			it("calculates tookMs as now minus startedAt", async () => {
				const { executeDelay } = await import("../executors/delay.js");

				const startedAt = Date.now();
				const journal = createDelayJournal({
					startedAt,
					scheduledEndAt: startedAt + 3000,
				});
				const journalManager = createMockJournalManager(journal);

				const payload: DelayPayload = { ms: 3000 };
				const context = {
					journal,
					journalManager,
					checkLeaseValid: () => true,
				};

				const resultPromise = executeDelay(payload, context);
				await vi.advanceTimersByTimeAsync(3000);
				const result = await resultPromise;

				expect(result.tookMs).toBe(3000);
			});
		});

		describe("recovery behavior", () => {
			it("resumes with remaining time only when scheduledEndAt is in the future", async () => {
				const { executeDelay } = await import("../executors/delay.js");

				const now = Date.now();
				const startedAt = now - 3000; // Started 3 seconds ago
				const scheduledEndAt = now + 2000; // Should end in 2 more seconds

				const journal = createDelayJournal({
					startedAt,
					scheduledEndAt,
					stage: "IN_PROGRESS", // Resuming after crash
				});
				const journalManager = createMockJournalManager(journal);

				const payload: DelayPayload = { ms: 5000 }; // Original was 5 seconds
				const context = {
					journal,
					journalManager,
					checkLeaseValid: () => true,
				};

				const resultPromise = executeDelay(payload, context);

				// Should wait only 2 more seconds (not full 5)
				await vi.advanceTimersByTimeAsync(2000);
				const result = await resultPromise;

				expect(result.ok).toBe(true);
				expect(result.tookMs).toBe(5000); // Total from original startedAt
			});

			it("completes immediately if scheduledEndAt is in the past", async () => {
				const { executeDelay } = await import("../executors/delay.js");

				const now = Date.now();
				const startedAt = now - 6000; // Started 6 seconds ago
				const scheduledEndAt = now - 1000; // Already past

				const journal = createDelayJournal({
					startedAt,
					scheduledEndAt,
					stage: "IN_PROGRESS",
				});
				const journalManager = createMockJournalManager(journal);

				const payload: DelayPayload = { ms: 5000 };
				const context = {
					journal,
					journalManager,
					checkLeaseValid: () => true,
				};

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
				const { executeDelay } = await import("../executors/delay.js");

				const now = Date.now();
				const journal = createDelayJournal({
					startedAt: now,
					scheduledEndAt: now + 10000,
				});
				const journalManager = createMockJournalManager(journal);

				let leaseValid = true;
				const payload: DelayPayload = { ms: 10000 };
				const context = {
					journal,
					journalManager,
					checkLeaseValid: () => leaseValid,
				};

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
				const { executeDelay } = await import("../executors/delay.js");

				const now = Date.now();
				const journal = createDelayJournal({
					startedAt: now,
					scheduledEndAt: now + 30000, // Long delay
				});
				const journalManager = createMockJournalManager(journal);

				const checkLeaseValid = vi.fn(() => true);
				const payload: DelayPayload = { ms: 30000 };
				const context = {
					journal,
					journalManager,
					checkLeaseValid,
				};

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
				const { executeDelay } = await import("../executors/delay.js");

				const now = Date.now();
				const journal = createDelayJournal({
					startedAt: now,
					scheduledEndAt: now + 1000,
					stage: "CLAIMED",
				});
				const journalManager = createMockJournalManager(journal);

				const payload: DelayPayload = { ms: 1000 };
				const context = {
					journal,
					journalManager,
					checkLeaseValid: () => true,
				};

				const resultPromise = executeDelay(payload, context);

				// Before advancing time, journal should be updated
				expect(journalManager.updateStage).toHaveBeenCalledWith(journal, "IN_PROGRESS");

				await vi.advanceTimersByTimeAsync(1000);
				await resultPromise;
			});

			it("does not update stage if already IN_PROGRESS (recovery case)", async () => {
				const { executeDelay } = await import("../executors/delay.js");

				const now = Date.now();
				const journal = createDelayJournal({
					startedAt: now - 500,
					scheduledEndAt: now + 500,
					stage: "IN_PROGRESS", // Already in progress
				});
				const journalManager = createMockJournalManager(journal);

				const payload: DelayPayload = { ms: 1000 };
				const context = {
					journal,
					journalManager,
					checkLeaseValid: () => true,
				};

				const resultPromise = executeDelay(payload, context);
				await vi.advanceTimersByTimeAsync(500);
				await resultPromise;

				// Should NOT call updateStage again if already IN_PROGRESS
				expect(journalManager.updateStage).not.toHaveBeenCalled();
			});
		});

		describe("random failure injection", () => {
			it("supports onRandomFailure callback injection", async () => {
				const { executeDelay } = await import("../executors/delay.js");

				const now = Date.now();
				const journal = createDelayJournal({
					startedAt: now,
					scheduledEndAt: now + 2000,
				});
				const journalManager = createMockJournalManager(journal);

				const onRandomFailure = vi.fn();
				const payload: DelayPayload = { ms: 2000 };
				const context = {
					journal,
					journalManager,
					checkLeaseValid: () => true,
					onRandomFailure,
				};

				// Mock Math.random to trigger failure
				const originalRandom = Math.random;
				Math.random = () => 0.05; // Low value to trigger failure (< 0.1)

				try {
					const resultPromise = executeDelay(payload, context);

					// Set up rejection handler BEFORE advancing timers to avoid unhandled rejection
					const rejectionPromise = expect(resultPromise).rejects.toThrow("Simulated random failure");

					await vi.advanceTimersByTimeAsync(1000);

					// Wait for the rejection to complete
					await rejectionPromise;

					// Random failure callback should have been called
					expect(onRandomFailure).toHaveBeenCalled();
				} finally {
					Math.random = originalRandom;
				}
			});

			it("throws or exits when random failure is triggered", async () => {
				const { executeDelay } = await import("../executors/delay.js");

				const now = Date.now();
				const journal = createDelayJournal({
					startedAt: now,
					scheduledEndAt: now + 5000,
				});
				const journalManager = createMockJournalManager(journal);

				const onRandomFailure = vi.fn(() => {
					throw new Error("Simulated random failure");
				});
				const payload: DelayPayload = { ms: 5000 };
				const context = {
					journal,
					journalManager,
					checkLeaseValid: () => true,
					onRandomFailure,
				};

				// Mock Math.random to always trigger failure
				const originalRandom = Math.random;
				Math.random = () => 0.01;

				try {
					const resultPromise = executeDelay(payload, context);

					// Set up rejection handler BEFORE advancing timers to avoid unhandled rejection
					const rejectionPromise = expect(resultPromise).rejects.toThrow("Simulated random failure");

					await vi.advanceTimersByTimeAsync(1000);

					await rejectionPromise;
				} finally {
					Math.random = originalRandom;
				}
			});
		});

		describe("edge cases", () => {
			it("handles zero ms delay", async () => {
				const { executeDelay } = await import("../executors/delay.js");

				const now = Date.now();
				const journal = createDelayJournal({
					startedAt: now,
					scheduledEndAt: now, // Zero delay
				});
				const journalManager = createMockJournalManager(journal);

				const payload: DelayPayload = { ms: 0 };
				const context = {
					journal,
					journalManager,
					checkLeaseValid: () => true,
				};

				const result = await executeDelay(payload, context);

				expect(result.ok).toBe(true);
				expect(result.tookMs).toBe(0);
			});

			it("handles very long delays correctly", async () => {
				const { executeDelay } = await import("../executors/delay.js");

				const now = Date.now();
				const longDelay = 3600000; // 1 hour
				const journal = createDelayJournal({
					startedAt: now,
					scheduledEndAt: now + longDelay,
				});
				const journalManager = createMockJournalManager(journal);

				const payload: DelayPayload = { ms: longDelay };
				const context = {
					journal,
					journalManager,
					checkLeaseValid: () => true,
				};

				const resultPromise = executeDelay(payload, context);
				await vi.advanceTimersByTimeAsync(longDelay);
				const result = await resultPromise;

				expect(result.ok).toBe(true);
				expect(result.tookMs).toBe(longDelay);
			});

			it("handles null scheduledEndAt by computing from startedAt + ms", async () => {
				const { executeDelay } = await import("../executors/delay.js");

				const now = Date.now();
				const journal = createDelayJournal({
					startedAt: now,
					scheduledEndAt: null, // Not set by server (edge case)
				});
				const journalManager = createMockJournalManager(journal);

				const payload: DelayPayload = { ms: 2000 };
				const context = {
					journal,
					journalManager,
					checkLeaseValid: () => true,
				};

				const resultPromise = executeDelay(payload, context);
				await vi.advanceTimersByTimeAsync(2000);
				const result = await resultPromise;

				expect(result.ok).toBe(true);
				expect(result.tookMs).toBeGreaterThanOrEqual(2000);
			});
		});
	});
});
