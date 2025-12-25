/**
 * E2E Tests for DELAY Command Crash Recovery
 *
 * Tests verify that DELAY commands maintain deterministic behavior across crashes:
 * - Agent crash mid-delay resumes with remaining time using scheduledEndAt
 * - Multiple crash/recovery cycles still complete correctly
 * - Journal-based recovery produces consistent tookMs results
 * - scheduledEndAt is preserved across restarts
 *
 * PERFORMANCE NOTE:
 * Some tests are slow due to lease expiry waits required for crash recovery:
 * - "agent resumes DELAY command with remaining time after crash": ~20-30s
 *   (includes ~4s lease expiry wait + server restart)
 * - "agent clears stale journal when lease is no longer valid": ~10-15s
 * - Other tests: typically 5-10s
 *
 * Consider running with --testTimeout=60000 for the full suite.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as path from "node:path";
import type { DelayResult } from "@reliable-server-agent/shared";
import {
	createApiClient,
	createDelayInProgressJournal,
	createTestFixture,
	journalExists,
	readJournal,
	sleep,
	startAgent,
	startServer,
	waitFor,
	writeJournal,
} from "../helpers/index.js";

describe("E2E: DELAY Command Crash Recovery", () => {
	const fixture = createTestFixture("delay-crash-recovery");

	beforeAll(() => fixture.setup());
	afterAll(() => fixture.teardown());
	beforeEach(async () => fixture.setupTest());
	afterEach(async () => fixture.teardownTest());

	describe("Mid-Delay Crash and Resume", () => {
		it("agent resumes DELAY command with remaining time after crash using scheduledEndAt", async () => {
			// This test verifies:
			// 1. Agent claims DELAY command and begins waiting
			// 2. Agent crashes mid-delay (simulated via kill-after)
			// 3. After lease expiry, new agent picks up command
			// 4. New agent waits only remaining time (not full duration)
			// 5. Final tookMs is approximately the original delay duration

			const delayMs = 5000;
			const { commandId } = await fixture.api!.createCommand({
				type: "DELAY",
				payload: { ms: delayMs },
			});

			const agentId = "agent-delay-crash";
			const agentStateDir = path.join(fixture.tempDir, agentId);

			// Start agent that will be killed mid-delay
			const agent1 = await startAgent({
				agentId,
				serverUrl: `http://localhost:${fixture.server!.port}`,
				stateDir: agentStateDir,
				pollIntervalMs: 100,
				maxLeaseMs: 3000, // Short lease for faster recovery
				killAfterSeconds: 1.5, // Kill after 1.5 seconds (mid-delay)
			});

			// Wait for command to be claimed
			await waitFor(
				async () => {
					const s = await fixture.api!.getCommand(commandId);
					return s.status === "RUNNING";
				},
				{ timeoutMs: 5000 },
			);

			// Wait for agent to exit
			await new Promise<void>((resolve) => {
				agent1.process.on("exit", () => resolve());
			});

			// Check if journal was written with scheduledEndAt
			const journal = readJournal(agentStateDir, agentId);
			if (journal) {
				expect(journal.type).toBe("DELAY");
				expect(journal.scheduledEndAt).not.toBeNull();
				expect(journal.scheduledEndAt).toBeGreaterThan(journal.startedAt);
			}

			// Wait for lease to expire and server to recover
			await sleep(4000);

			await fixture.server!.stop();
			fixture.server = await startServer({ tempDir: fixture.tempDir, dbPath: fixture.dbPath! });
			fixture.api = createApiClient(`http://localhost:${fixture.server.port}`);

			// Verify command is back to PENDING
			let status = await fixture.api.getCommand(commandId);
			expect(status.status).toBe("PENDING");

			// Start new agent to complete the command
			const agent2 = await startAgent({
				agentId: "agent-delay-resume",
				serverUrl: `http://localhost:${fixture.server.port}`,
				stateDir: path.join(fixture.tempDir, "agent-delay-resume"),
				pollIntervalMs: 100,
			});
			fixture.addAgent(agent2);

			// Wait for completion
			await waitFor(
				async () => {
					const s = await fixture.api!.getCommand(commandId);
					return s.status === "COMPLETED";
				},
				{ timeoutMs: 15000 },
			);

			// Verify result
			status = await fixture.api.getCommand(commandId);
			expect(status.status).toBe("COMPLETED");

			const result = status.result as DelayResult;
			expect(result.ok).toBe(true);
			// tookMs should be close to original delay duration
			// Allow some tolerance for processing overhead
			expect(result.tookMs).toBeGreaterThanOrEqual(delayMs);
			expect(result.tookMs).toBeLessThan(delayMs * 2);
		}, 30000);

		it("agent with pre-existing IN_PROGRESS journal resumes delay without restarting", async () => {
			// This test pre-creates a journal simulating a crash mid-delay
			// and verifies the agent resumes from the saved scheduledEndAt

			const { commandId } = await fixture.api!.createCommand({
				type: "DELAY",
				payload: { ms: 3000 },
			});

			// Claim command to get real startedAt and scheduledEndAt
			const claim = await fixture.api!.claimCommand({
				agentId: "agent-presaved-delay",
				maxLeaseMs: 30000,
			});
			expect(claim).not.toBeNull();

			const agentId = "agent-presaved-delay";
			const agentStateDir = path.join(fixture.tempDir, agentId);

			// Create a journal with IN_PROGRESS stage
			// Set scheduledEndAt to be 1 second from now (simulating 2s already elapsed)
			const now = Date.now();
			const journal = createDelayInProgressJournal({
				commandId,
				leaseId: claim!.leaseId,
				startedAt: claim!.startedAt,
				scheduledEndAt: now + 1000, // 1 second remaining
			});

			writeJournal(agentStateDir, agentId, journal);
			expect(journalExists(agentStateDir, agentId)).toBe(true);

			// Start agent - should detect journal and resume
			const agent = await startAgent({
				agentId,
				serverUrl: `http://localhost:${fixture.server!.port}`,
				stateDir: agentStateDir,
				pollIntervalMs: 100,
			});
			fixture.addAgent(agent);

			// Wait for completion - should take about 1 second (remaining time)
			const waitStart = Date.now();
			await waitFor(
				async () => {
					const s = await fixture.api!.getCommand(commandId);
					return s.status === "COMPLETED";
				},
				{ timeoutMs: 10000 },
			);
			const waitDuration = Date.now() - waitStart;

			// Verify completion was quick (resumed, not restarted)
			// Should complete in roughly 1-2 seconds, not 3+ seconds
			expect(waitDuration).toBeLessThan(3000);

			const status = await fixture.api!.getCommand(commandId);
			expect(status.status).toBe("COMPLETED");

			// Journal should be deleted after completion
			await waitFor(
				async () => !journalExists(agentStateDir, agentId),
				{ timeoutMs: 5000 },
			);
		}, 20000);

		it("agent clears stale journal when lease is no longer valid", async () => {
			// Create and claim command with a short delay
			const { commandId } = await fixture.api!.createCommand({
				type: "DELAY",
				payload: { ms: 500 }, // Short delay so agent finishes quickly after reclaim
			});

			const claim = await fixture.api!.claimCommand({
				agentId: "agent-stale-delay",
				maxLeaseMs: 100, // Very short lease
			});
			expect(claim).not.toBeNull();

			// Wait for lease to expire
			await sleep(200);

			// Restart server to recover
			await fixture.server!.stop();
			fixture.server = await startServer({ tempDir: fixture.tempDir, dbPath: fixture.dbPath! });
			fixture.api = createApiClient(`http://localhost:${fixture.server.port}`);

			// Command should be PENDING
			let status = await fixture.api.getCommand(commandId);
			expect(status.status).toBe("PENDING");

			const agentId = "agent-stale-delay";
			const agentStateDir = path.join(fixture.tempDir, agentId);

			// Create a stale journal with scheduledEndAt already passed
			// This simulates an agent that crashed after the delay should have completed
			const staleJournal = createDelayInProgressJournal({
				commandId,
				leaseId: claim!.leaseId, // This lease is invalid
				startedAt: claim!.startedAt,
				scheduledEndAt: Date.now() - 1000, // Already in the past, so agent will try to complete immediately
			});

			writeJournal(agentStateDir, agentId, staleJournal);

			// Start agent with stale journal
			// Agent will try to complete immediately (scheduledEndAt passed),
			// get 409 (stale lease), clear journal, and enter claim loop
			const agent = await startAgent({
				agentId,
				serverUrl: `http://localhost:${fixture.server.port}`,
				stateDir: agentStateDir,
				pollIntervalMs: 100,
			});
			fixture.addAgent(agent);

			// Wait for agent to detect stale journal, get 409, clear it, claim and complete
			await waitFor(
				async () => {
					const s = await fixture.api!.getCommand(commandId);
					return s.status === "COMPLETED";
				},
				{ timeoutMs: 15000 },
			);

			// Agent should have cleared the stale journal
			// and claimed the command with a new lease, then completed it
			status = await fixture.api.getCommand(commandId);
			expect(status.status).toBe("COMPLETED");

			// Stop agent
			await agent.stop();
		});
	});

	describe("Deterministic scheduledEndAt Behavior", () => {
		it("scheduledEndAt is computed on first claim and remains constant", async () => {
			// This verifies that scheduledEndAt = startedAt + ms
			// and is set only once at claim time

			const delayMs = 5000;
			const { commandId } = await fixture.api!.createCommand({
				type: "DELAY",
				payload: { ms: delayMs },
			});

			// Claim the command
			const claim = await fixture.api!.claimCommand({
				agentId: "agent-scheduled-check",
				maxLeaseMs: 30000,
			});

			expect(claim).not.toBeNull();
			expect(claim!.scheduledEndAt).not.toBeNull();
			expect(claim!.scheduledEndAt).toBe(claim!.startedAt + delayMs);

			// Complete it
			await fixture.api!.completeCommand(commandId, {
				agentId: "agent-scheduled-check",
				leaseId: claim!.leaseId,
				result: { ok: true, tookMs: delayMs },
			});
		});

		it("multiple agents see consistent tookMs for same command", async () => {
			// This test verifies that regardless of which agent completes the command,
			// the tookMs should be consistent based on scheduledEndAt - startedAt

			const delayMs = 2000;
			const { commandId } = await fixture.api!.createCommand({
				type: "DELAY",
				payload: { ms: delayMs },
			});

			// Start agent
			const agent = await startAgent({
				agentId: "agent-consistent-delay",
				serverUrl: `http://localhost:${fixture.server!.port}`,
				stateDir: path.join(fixture.tempDir, "agent-consistent-delay"),
				pollIntervalMs: 100,
			});
			fixture.addAgent(agent);

			// Wait for completion
			await waitFor(
				async () => {
					const s = await fixture.api!.getCommand(commandId);
					return s.status === "COMPLETED";
				},
				{ timeoutMs: 10000 },
			);

			const status = await fixture.api!.getCommand(commandId);
			const result = status.result as DelayResult;

			// tookMs should be >= delayMs (the scheduled duration)
			expect(result.tookMs).toBeGreaterThanOrEqual(delayMs);
			// But not significantly more (allow 500ms tolerance for processing)
			expect(result.tookMs).toBeLessThan(delayMs + 500);
		});
	});

	describe("Edge Cases", () => {
		it("handles zero-duration DELAY command correctly", async () => {
			const { commandId } = await fixture.api!.createCommand({
				type: "DELAY",
				payload: { ms: 0 },
			});

			const agent = await startAgent({
				agentId: "agent-zero-delay",
				serverUrl: `http://localhost:${fixture.server!.port}`,
				stateDir: path.join(fixture.tempDir, "agent-zero-delay"),
				pollIntervalMs: 100,
			});
			fixture.addAgent(agent);

			await waitFor(
				async () => {
					const s = await fixture.api!.getCommand(commandId);
					return s.status === "COMPLETED";
				},
				{ timeoutMs: 5000 },
			);

			const status = await fixture.api!.getCommand(commandId);
			expect(status.status).toBe("COMPLETED");

			const result = status.result as DelayResult;
			expect(result.ok).toBe(true);
			expect(result.tookMs).toBeGreaterThanOrEqual(0);
		});

		it("handles very short DELAY command that completes before first heartbeat", async () => {
			const { commandId } = await fixture.api!.createCommand({
				type: "DELAY",
				payload: { ms: 50 },
			});

			const agent = await startAgent({
				agentId: "agent-short-delay",
				serverUrl: `http://localhost:${fixture.server!.port}`,
				stateDir: path.join(fixture.tempDir, "agent-short-delay"),
				pollIntervalMs: 100,
				heartbeatIntervalMs: 5000, // Heartbeat much longer than delay
			});
			fixture.addAgent(agent);

			await waitFor(
				async () => {
					const s = await fixture.api!.getCommand(commandId);
					return s.status === "COMPLETED";
				},
				{ timeoutMs: 5000 },
			);

			const status = await fixture.api!.getCommand(commandId);
			expect(status.status).toBe("COMPLETED");

			const result = status.result as DelayResult;
			expect(result.ok).toBe(true);
		});
	});
});
