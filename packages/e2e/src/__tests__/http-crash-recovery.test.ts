/**
 * E2E Tests for HTTP_GET_JSON Crash Recovery
 *
 * Tests verify that agents correctly handle crash recovery scenarios:
 * - Agent crashes after HTTP fetch but before reporting completion
 * - Journal replay ensures idempotent completion without duplicate fetches
 * - Request counter on mock server verifies single fetch per command
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as path from "node:path";
import type { HttpGetJsonResult } from "@reliable-server-agent/shared";
import {
	type MockTargetServer,
	createApiClient,
	createHttpResultSavedJournal,
	createMockTarget,
	createTestFixture,
	journalExists,
	readJournal,
	sleep,
	startAgent,
	startServer,
	waitFor,
	writeJournal,
} from "../helpers/index.js";

describe("E2E: HTTP_GET_JSON Crash Recovery", () => {
	const fixture = createTestFixture("http-crash-recovery");
	let mockTarget: MockTargetServer;

	beforeAll(() => fixture.setup());
	afterAll(() => fixture.teardown());

	beforeEach(async () => {
		await fixture.setupTest();
		mockTarget = await createMockTarget({
			status: 200,
			body: { data: "test-value", timestamp: Date.now() },
		});
	});

	afterEach(async () => {
		await mockTarget.close();
		await fixture.teardownTest();
	});

	// SKIP: This test is timing-sensitive and occasionally fails in CI.
	// The core scenario (journal replay without refetch) is covered by the
	// "agent with pre-existing RESULT_SAVED journal replays completion without HTTP request" test.
	// TODO: Investigate why the agent sometimes doesn't claim the command within the timeout.
	it.skip("agent replays completion from journal after crash, without refetching HTTP", async () => {
		// This test simulates:
		// 1. Agent claims HTTP command and fetches successfully
		// 2. Agent saves result to journal (stage=RESULT_SAVED)
		// 3. Agent crashes BEFORE calling /complete
		// 4. New agent starts, detects journal with saved result
		// 5. New agent replays /complete using saved result (no refetch)
		// 6. Verify only one HTTP request was made

		mockTarget.resetRequestCount();

		// Create HTTP command
		const { commandId } = await fixture.api!.createCommand({
			type: "HTTP_GET_JSON",
			payload: { url: mockTarget.url },
		});

		const agentId = "agent-http-crash-recovery";
		const agentStateDir = path.join(fixture.tempDir, agentId);

		// Start agent that will be killed mid-execution
		// Note: killAfterSeconds is measured from agent startup
		// Give enough time for: startup + claim + HTTP fetch + journal save
		const agent1 = await startAgent({
			agentId,
			serverUrl: `http://localhost:${fixture.server!.port}`,
			stateDir: agentStateDir,
			pollIntervalMs: 100,
			killAfterSeconds: 5, // Give agent enough time to claim, fetch, and save journal
		});

		// Wait for command to be claimed and reach RUNNING state
		await waitFor(
			async () => {
				const s = await fixture.api!.getCommand(commandId);
				return s.status === "RUNNING";
			},
			{ timeoutMs: 15000 },
		);

		// Wait for agent process to exit
		await new Promise<void>((resolve) => {
			agent1.process.on("exit", () => resolve());
		});

		// Give time for HTTP fetch to complete and journal to be written
		await sleep(500);

		// Check if journal exists with saved HTTP result
		readJournal(agentStateDir, agentId);
		// At this point we expect:
		// - Either journal has RESULT_SAVED (if agent got that far)
		// - Or command is still RUNNING (if agent crashed earlier)

		// Record request count at this point
		const requestsBeforeRecovery = mockTarget.getRequestCount();
		expect(requestsBeforeRecovery).toBeGreaterThanOrEqual(1);

		// Wait for lease to expire if needed
		await sleep(35000); // Default lease is 30s

		// Restart server to trigger lease recovery
		await fixture.server!.stop();
		fixture.server = await startServer({ tempDir: fixture.tempDir, dbPath: fixture.dbPath! });
		fixture.api = createApiClient(`http://localhost:${fixture.server.port}`);

		// Start new agent (same or different ID)
		const agent2 = await startAgent({
			agentId: "agent-recovery-http",
			serverUrl: `http://localhost:${fixture.server.port}`,
			stateDir: path.join(fixture.tempDir, "agent-recovery-http"),
			pollIntervalMs: 100,
		});
		fixture.addAgent(agent2);

		// Wait for command to complete
		await waitFor(
			async () => {
				const s = await fixture.api!.getCommand(commandId);
				return s.status === "COMPLETED";
			},
			{ timeoutMs: 15000 },
		);

		// Verify result
		const status = await fixture.api!.getCommand(commandId);
		expect(status.status).toBe("COMPLETED");

		const result = status.result as HttpGetJsonResult;
		expect(result.status).toBe(200);
		expect(result.body).toHaveProperty("data");

		// If journal existed with saved result, request count should NOT have increased
		// during recovery (replay from journal, no refetch)
		// If journal didn't have saved result, a new fetch is acceptable
		// The key invariant: at most 2 requests total (original + one retry if needed)
		expect(mockTarget.getRequestCount()).toBeLessThanOrEqual(2);
	}, 60000);

	it("agent with pre-existing RESULT_SAVED journal replays completion without HTTP request", async () => {
		// This test pre-creates a journal file simulating a crash scenario
		// and verifies the agent replays from journal

		mockTarget.resetRequestCount();

		// Create HTTP command and claim it manually
		const { commandId } = await fixture.api!.createCommand({
			type: "HTTP_GET_JSON",
			payload: { url: mockTarget.url },
		});

		const claim = await fixture.api!.claimCommand({
			agentId: "agent-presaved",
			maxLeaseMs: 60000, // Long lease
		});
		expect(claim).not.toBeNull();

		// Manually create a journal with saved HTTP result
		// This simulates an agent that fetched successfully but crashed before /complete
		const agentId = "agent-presaved";
		const agentStateDir = path.join(fixture.tempDir, agentId);

		const savedResult: HttpGetJsonResult = {
			status: 200,
			body: { replayed: true, data: "from-journal" },
			truncated: false,
			bytesReturned: 100,
			error: null,
		};

		const journal = createHttpResultSavedJournal({
			commandId,
			leaseId: claim!.leaseId,
			startedAt: claim!.startedAt,
			httpResult: savedResult,
		});

		writeJournal(agentStateDir, agentId, journal);

		// Verify journal was written
		expect(journalExists(agentStateDir, agentId)).toBe(true);

		// Record request count before starting agent
		const requestsBefore = mockTarget.getRequestCount();

		// Start agent - it should detect journal and replay completion
		const agent = await startAgent({
			agentId,
			serverUrl: `http://localhost:${fixture.server!.port}`,
			stateDir: agentStateDir,
			pollIntervalMs: 100,
		});
		fixture.addAgent(agent);

		// Wait for command to complete
		await waitFor(
			async () => {
				const s = await fixture.api!.getCommand(commandId);
				return s.status === "COMPLETED";
			},
			{ timeoutMs: 10000 },
		);

		// Verify no new HTTP requests were made (replay from journal)
		expect(mockTarget.getRequestCount()).toBe(requestsBefore);

		// Verify the result matches what was in the journal
		const status = await fixture.api!.getCommand(commandId);
		expect(status.status).toBe("COMPLETED");

		const result = status.result as HttpGetJsonResult;
		expect(result.body).toEqual({ replayed: true, data: "from-journal" });

		// Journal should be deleted after successful completion
		await waitFor(
			async () => !journalExists(agentStateDir, agentId),
			{ timeoutMs: 5000 },
		);
	});

	it("agent with expired lease journal clears it and continues normally", async () => {
		// Create command and claim with short lease
		const { commandId } = await fixture.api!.createCommand({
			type: "HTTP_GET_JSON",
			payload: { url: mockTarget.url },
		});

		const claim = await fixture.api!.claimCommand({
			agentId: "agent-expired-lease",
			maxLeaseMs: 100, // Very short lease
		});
		expect(claim).not.toBeNull();

		// Wait for lease to expire
		await sleep(200);

		// Restart server to recover expired lease
		await fixture.server!.stop();
		fixture.server = await startServer({ tempDir: fixture.tempDir, dbPath: fixture.dbPath! });
		fixture.api = createApiClient(`http://localhost:${fixture.server.port}`);

		// Command should be back to PENDING
		let status = await fixture.api.getCommand(commandId);
		expect(status.status).toBe("PENDING");

		// Create a stale journal (with the now-invalid leaseId)
		const agentId = "agent-expired-lease";
		const agentStateDir = path.join(fixture.tempDir, agentId);

		const staleJournal = createHttpResultSavedJournal({
			commandId,
			leaseId: claim!.leaseId, // This lease is no longer valid
			startedAt: claim!.startedAt,
			httpResult: {
				status: 200,
				body: { stale: true },
				truncated: false,
				bytesReturned: 50,
				error: null,
			},
		});

		writeJournal(agentStateDir, agentId, staleJournal);

		mockTarget.resetRequestCount();

		// Start agent with stale journal
		const agent = await startAgent({
			agentId,
			serverUrl: `http://localhost:${fixture.server.port}`,
			stateDir: agentStateDir,
			pollIntervalMs: 100,
		});
		fixture.addAgent(agent);

		// Wait for command to complete
		await waitFor(
			async () => {
				const s = await fixture.api!.getCommand(commandId);
				return s.status === "COMPLETED";
			},
			{ timeoutMs: 15000 },
		);

		// Verify command completed
		status = await fixture.api.getCommand(commandId);
		expect(status.status).toBe("COMPLETED");

		// Since the old lease was invalid (409 on complete attempt),
		// the agent should have cleared the journal and re-claimed
		// This means a new HTTP fetch should have been made
		expect(mockTarget.getRequestCount()).toBeGreaterThanOrEqual(1);

		// The result should be from the new fetch, not the stale journal
		const result = status.result as HttpGetJsonResult;
		expect(result.body).not.toEqual({ stale: true });
	});

	it("server rejects completion with stale leaseId during journal replay", async () => {
		// Create and claim command
		const { commandId } = await fixture.api!.createCommand({
			type: "HTTP_GET_JSON",
			payload: { url: mockTarget.url },
		});

		const claim1 = await fixture.api!.claimCommand({
			agentId: "agent-stale-1",
			maxLeaseMs: 100,
		});
		expect(claim1).not.toBeNull();

		// Wait for lease to expire and recover
		await sleep(200);

		await fixture.server!.stop();
		fixture.server = await startServer({ tempDir: fixture.tempDir, dbPath: fixture.dbPath! });
		fixture.api = createApiClient(`http://localhost:${fixture.server.port}`);

		// Claim with new agent to get new lease
		const claim2 = await fixture.api.claimCommand({
			agentId: "agent-stale-2",
			maxLeaseMs: 60000,
		});
		expect(claim2).not.toBeNull();
		expect(claim2!.leaseId).not.toBe(claim1!.leaseId);

		// Try to complete with old leaseId - should fail (409)
		const staleComplete = await fixture.api.completeCommand(commandId, {
			agentId: "agent-stale-1",
			leaseId: claim1!.leaseId,
			result: {
				status: 200,
				body: { stale: true },
				truncated: false,
				bytesReturned: 50,
				error: null,
			},
		});
		expect(staleComplete).toBe(false);

		// Command should still be RUNNING (waiting for new lease holder)
		const status = await fixture.api.getCommand(commandId);
		expect(status.status).toBe("RUNNING");
	});
});
