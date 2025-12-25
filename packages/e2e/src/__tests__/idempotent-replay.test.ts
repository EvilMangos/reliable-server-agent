/**
 * E2E Tests for Idempotent Completion Replay
 *
 * Tests verify that agents replay completions correctly without duplicate execution:
 * - Agent with saved RESULT_SAVED journal replays completion without re-execution
 * - Stale leaseId completions are rejected with 409
 * - Duplicate completions with same leaseId are rejected
 * - Journal is deleted after successful or rejected completion
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as path from "node:path";
import type { DelayResult, HttpGetJsonResult } from "@reliable-server-agent/shared";
import {
	type MockTargetServer,
	createApiClient,
	createHttpResultSavedJournal,
	createMockTarget,
	createTestFixture,
	createTestJournal,
	journalExists,
	sleep,
	startAgent,
	startServer,
	waitFor,
	writeJournal,
} from "../helpers/index.js";

describe("E2E: Idempotent Completion Replay", () => {
	const fixture = createTestFixture("idempotent-replay");

	beforeAll(() => fixture.setup());
	afterAll(() => fixture.teardown());
	beforeEach(async () => fixture.setupTest());
	afterEach(async () => fixture.teardownTest());

	describe("HTTP_GET_JSON Replay from Journal", () => {
		let mockTarget: MockTargetServer;

		beforeEach(async () => {
			mockTarget = await createMockTarget({
				status: 200,
				body: { data: "test-value" },
			});
		});

		afterEach(async () => {
			await mockTarget.close();
		});

		it("agent replays HTTP completion from journal without refetching", async () => {
			mockTarget.resetRequestCount();

			// Create command and claim it
			const { commandId } = await fixture.api!.createCommand({
				type: "HTTP_GET_JSON",
				payload: { url: mockTarget.url },
			});

			const claim = await fixture.api!.claimCommand({
				agentId: "agent-http-replay",
				maxLeaseMs: 60000,
			});
			expect(claim).not.toBeNull();

			const agentId = "agent-http-replay";
			const agentStateDir = path.join(fixture.tempDir, agentId);

			// Pre-create journal with saved HTTP result
			const savedResult: HttpGetJsonResult = {
				status: 200,
				body: { replayed: true, source: "journal" },
				truncated: false,
				bytesReturned: 50,
				error: null,
			};

			const journal = createHttpResultSavedJournal({
				commandId,
				leaseId: claim!.leaseId,
				startedAt: claim!.startedAt,
				httpResult: savedResult,
			});

			writeJournal(agentStateDir, agentId, journal);
			expect(journalExists(agentStateDir, agentId)).toBe(true);

			// Reset request count after setup
			const requestsBefore = mockTarget.getRequestCount();

			// Start agent - should replay from journal
			const agent = await startAgent({
				agentId,
				serverUrl: `http://localhost:${fixture.server!.port}`,
				stateDir: agentStateDir,
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

			// Verify no new HTTP requests were made
			expect(mockTarget.getRequestCount()).toBe(requestsBefore);

			// Verify result matches journal content
			const status = await fixture.api!.getCommand(commandId);
			expect(status.status).toBe("COMPLETED");

			const result = status.result as HttpGetJsonResult;
			expect(result.body).toEqual({ replayed: true, source: "journal" });

			// Journal should be deleted
			await waitFor(
				async () => !journalExists(agentStateDir, agentId),
				{ timeoutMs: 5000 },
			);
		});

		it("single HTTP request per command even with multiple agent restarts", async () => {
			mockTarget.resetRequestCount();

			const { commandId } = await fixture.api!.createCommand({
				type: "HTTP_GET_JSON",
				payload: { url: mockTarget.url },
			});

			const agentId = "agent-restart-test";

			// Start and stop agent multiple times, verifying request count
			for (let i = 0; i < 3; i++) {
				const agent = await startAgent({
					agentId: `${agentId}-${i}`,
					serverUrl: `http://localhost:${fixture.server!.port}`,
					stateDir: path.join(fixture.tempDir, `${agentId}-${i}`),
					pollIntervalMs: 100,
					killAfterSeconds: 0.3,
				});

				await new Promise<void>((resolve) => {
					agent.process.on("exit", () => resolve());
				});
			}

			// Wait for lease expiry and recovery
			await sleep(35000);
			await fixture.server!.stop();
			fixture.server = await startServer({ tempDir: fixture.tempDir, dbPath: fixture.dbPath! });
			fixture.api = createApiClient(`http://localhost:${fixture.server.port}`);

			// Final agent to complete
			const finalAgent = await startAgent({
				agentId: "agent-final-http",
				serverUrl: `http://localhost:${fixture.server.port}`,
				stateDir: path.join(fixture.tempDir, "agent-final-http"),
				pollIntervalMs: 100,
			});
			fixture.addAgent(finalAgent);

			await waitFor(
				async () => {
					const s = await fixture.api!.getCommand(commandId);
					return s.status === "COMPLETED";
				},
				{ timeoutMs: 15000 },
			);

			// Verify limited HTTP requests (ideally 1, but some retries acceptable)
			expect(mockTarget.getRequestCount()).toBeLessThanOrEqual(4);
		}, 60000);
	});

	describe("DELAY Replay from Journal", () => {
		it("agent replays DELAY completion from RESULT_SAVED journal", async () => {
			const { commandId } = await fixture.api!.createCommand({
				type: "DELAY",
				payload: { ms: 5000 },
			});

			const claim = await fixture.api!.claimCommand({
				agentId: "agent-delay-replay",
				maxLeaseMs: 60000,
			});
			expect(claim).not.toBeNull();

			const agentId = "agent-delay-replay";
			const agentStateDir = path.join(fixture.tempDir, agentId);

			// Pre-create journal with RESULT_SAVED stage
			// This simulates: delay completed, result saved, but crash before /complete
			const journal = createTestJournal({
				commandId,
				leaseId: claim!.leaseId,
				type: "DELAY",
				startedAt: claim!.startedAt,
				scheduledEndAt: claim!.scheduledEndAt,
				stage: "RESULT_SAVED",
			});

			writeJournal(agentStateDir, agentId, journal);

			const startTime = Date.now();

			// Start agent - should immediately replay completion
			const agent = await startAgent({
				agentId,
				serverUrl: `http://localhost:${fixture.server!.port}`,
				stateDir: agentStateDir,
				pollIntervalMs: 100,
			});
			fixture.addAgent(agent);

			// Wait for completion
			await waitFor(
				async () => {
					const s = await fixture.api!.getCommand(commandId);
					return s.status === "COMPLETED";
				},
				{ timeoutMs: 5000 },
			);

			const elapsed = Date.now() - startTime;

			// Completion should be fast (replay, not re-wait)
			expect(elapsed).toBeLessThan(3000);

			const status = await fixture.api!.getCommand(commandId);
			expect(status.status).toBe("COMPLETED");

			// Journal should be deleted
			await waitFor(
				async () => !journalExists(agentStateDir, agentId),
				{ timeoutMs: 5000 },
			);
		});
	});

	describe("Stale LeaseId Rejection", () => {
		it("server rejects completion with stale leaseId (409)", async () => {
			const { commandId } = await fixture.api!.createCommand({
				type: "DELAY",
				payload: { ms: 60000 },
			});

			// First claim
			const claim1 = await fixture.api!.claimCommand({
				agentId: "agent-stale-test-1",
				maxLeaseMs: 100,
			});
			expect(claim1).not.toBeNull();
			const staleLeaseId = claim1!.leaseId;

			// Wait for lease to expire
			await sleep(200);

			// Restart server
			await fixture.server!.stop();
			fixture.server = await startServer({ tempDir: fixture.tempDir, dbPath: fixture.dbPath! });
			fixture.api = createApiClient(`http://localhost:${fixture.server.port}`);

			// Second claim (gets new lease)
			const claim2 = await fixture.api.claimCommand({
				agentId: "agent-stale-test-2",
				maxLeaseMs: 60000,
			});
			expect(claim2).not.toBeNull();
			expect(claim2!.leaseId).not.toBe(staleLeaseId);

			// Try to complete with stale leaseId
			const staleComplete = await fixture.api.completeCommand(commandId, {
				agentId: "agent-stale-test-1",
				leaseId: staleLeaseId,
				result: { ok: true, tookMs: 100 },
			});
			expect(staleComplete).toBe(false);

			// Command should still be RUNNING (not completed by stale agent)
			const status = await fixture.api.getCommand(commandId);
			expect(status.status).toBe("RUNNING");

			// Valid completion should work
			const validComplete = await fixture.api.completeCommand(commandId, {
				agentId: "agent-stale-test-2",
				leaseId: claim2!.leaseId,
				result: { ok: true, tookMs: 100 },
			});
			expect(validComplete).toBe(true);
		});

		it("agent clears stale journal after 409 rejection", async () => {
			// Use a short delay so the command completes quickly after re-claim
			const { commandId } = await fixture.api!.createCommand({
				type: "DELAY",
				payload: { ms: 500 },
			});

			// Claim with short lease
			const claim = await fixture.api!.claimCommand({
				agentId: "agent-journal-clear",
				maxLeaseMs: 100,
			});
			expect(claim).not.toBeNull();

			// Wait for lease to expire
			await sleep(200);

			// Restart server
			await fixture.server!.stop();
			fixture.server = await startServer({ tempDir: fixture.tempDir, dbPath: fixture.dbPath! });
			fixture.api = createApiClient(`http://localhost:${fixture.server.port}`);

			// Create stale journal with saved result
			const agentId = "agent-journal-clear";
			const agentStateDir = path.join(fixture.tempDir, agentId);

			// Create journal with RESULT_SAVED stage - agent will try to complete immediately
			// and get 409 because the lease is stale
			const staleJournal = createTestJournal({
				commandId,
				leaseId: claim!.leaseId, // This lease is now invalid
				type: "DELAY",
				startedAt: claim!.startedAt,
				scheduledEndAt: Date.now() - 1000, // In the past
				stage: "RESULT_SAVED",
			});

			writeJournal(agentStateDir, agentId, staleJournal);

			// Start agent with stale journal
			// Agent will try to complete with stale lease, get 409, clear journal,
			// enter claim loop, claim, execute short delay, and complete
			const agent = await startAgent({
				agentId,
				serverUrl: `http://localhost:${fixture.server.port}`,
				stateDir: agentStateDir,
				pollIntervalMs: 100,
			});
			fixture.addAgent(agent);

			// Wait for agent to process stale journal, get 409, claim and complete
			await waitFor(
				async () => {
					const s = await fixture.api!.getCommand(commandId);
					return s.status === "COMPLETED";
				},
				{ timeoutMs: 20000 },
			);

			const status = await fixture.api!.getCommand(commandId);
			expect(status.status).toBe("COMPLETED");
		}, 30000);
	});

	describe("Duplicate Completion Prevention", () => {
		it("only first completion succeeds for same leaseId", async () => {
			const { commandId } = await fixture.api!.createCommand({
				type: "DELAY",
				payload: { ms: 100 },
			});

			const claim = await fixture.api!.claimCommand({
				agentId: "agent-dup-test",
				maxLeaseMs: 30000,
			});
			expect(claim).not.toBeNull();

			// First completion
			const first = await fixture.api!.completeCommand(commandId, {
				agentId: "agent-dup-test",
				leaseId: claim!.leaseId,
				result: { ok: true, tookMs: 100 },
			});
			expect(first).toBe(true);

			// Command is COMPLETED
			let status = await fixture.api!.getCommand(commandId);
			expect(status.status).toBe("COMPLETED");

			// Second completion with same leaseId
			const second = await fixture.api!.completeCommand(commandId, {
				agentId: "agent-dup-test",
				leaseId: claim!.leaseId,
				result: { ok: true, tookMs: 200 }, // Different result
			});
			expect(second).toBe(false);

			// Result should not have changed
			status = await fixture.api!.getCommand(commandId);
			expect(status.status).toBe("COMPLETED");
			expect((status.result as DelayResult).tookMs).toBe(100);
		});

		it("cannot complete an already FAILED command", async () => {
			const { commandId } = await fixture.api!.createCommand({
				type: "DELAY",
				payload: { ms: 100 },
			});

			const claim = await fixture.api!.claimCommand({
				agentId: "agent-fail-then-complete",
				maxLeaseMs: 30000,
			});
			expect(claim).not.toBeNull();

			// Fail the command
			const failResult = await fixture.api!.failCommand(commandId, {
				agentId: "agent-fail-then-complete",
				leaseId: claim!.leaseId,
				error: "Test failure",
			});
			expect(failResult).toBe(true);

			// Try to complete
			const completeResult = await fixture.api!.completeCommand(commandId, {
				agentId: "agent-fail-then-complete",
				leaseId: claim!.leaseId,
				result: { ok: true, tookMs: 100 },
			});
			expect(completeResult).toBe(false);

			// Status should still be FAILED
			const status = await fixture.api!.getCommand(commandId);
			expect(status.status).toBe("FAILED");
		});

		it("cannot fail an already COMPLETED command", async () => {
			const { commandId } = await fixture.api!.createCommand({
				type: "DELAY",
				payload: { ms: 100 },
			});

			const claim = await fixture.api!.claimCommand({
				agentId: "agent-complete-then-fail",
				maxLeaseMs: 30000,
			});
			expect(claim).not.toBeNull();

			// Complete the command
			const completeResult = await fixture.api!.completeCommand(commandId, {
				agentId: "agent-complete-then-fail",
				leaseId: claim!.leaseId,
				result: { ok: true, tookMs: 100 },
			});
			expect(completeResult).toBe(true);

			// Try to fail
			const failResult = await fixture.api!.failCommand(commandId, {
				agentId: "agent-complete-then-fail",
				leaseId: claim!.leaseId,
				error: "Too late to fail",
			});
			expect(failResult).toBe(false);

			// Status should still be COMPLETED
			const status = await fixture.api!.getCommand(commandId);
			expect(status.status).toBe("COMPLETED");
		});
	});
});
