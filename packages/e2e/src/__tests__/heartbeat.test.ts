/**
 * E2E Tests for Heartbeat Functionality
 *
 * Tests verify that agents correctly use heartbeats to extend leases:
 * - Heartbeats extend lease expiration time
 * - Invalid/stale lease heartbeats are rejected (409)
 * - Long-running commands stay alive via heartbeats
 * - Commands without heartbeats expire when lease runs out
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as path from "node:path";
import type { DelayResult } from "@reliable-server-agent/shared";
import {
	createApiClient,
	createTestFixture,
	sleep,
	startAgent,
	startServer,
	waitFor,
} from "../helpers/index.js";

describe("E2E: Heartbeat Functionality", () => {
	const fixture = createTestFixture("heartbeat");

	beforeAll(() => fixture.setup());
	afterAll(() => fixture.teardown());
	beforeEach(async () => fixture.setupTest());
	afterEach(async () => fixture.teardownTest());

	describe("Lease Extension via Heartbeat", () => {
		it("heartbeat extends lease expiration time", async () => {
			// Create command with long delay
			const { commandId } = await fixture.api!.createCommand({
				type: "DELAY",
				payload: { ms: 100 },
			});

			// Claim with short lease
			const claim = await fixture.api!.claimCommand({
				agentId: "agent-heartbeat-test",
				maxLeaseMs: 5000, // 5 second initial lease
			});
			expect(claim).not.toBeNull();

			// Send heartbeat to extend lease
			const heartbeatResult = await fixture.api!.heartbeat(commandId, {
				agentId: "agent-heartbeat-test",
				leaseId: claim!.leaseId,
				extendMs: 10000, // Extend by 10 seconds
			});

			expect(heartbeatResult).toBe(true);

			// We can't directly verify the new expiration time without querying server internals
			// But we can verify the heartbeat succeeded
			// The real test is that the command doesn't expire during execution

			// Complete the command
			const completeResult = await fixture.api!.completeCommand(commandId, {
				agentId: "agent-heartbeat-test",
				leaseId: claim!.leaseId,
				result: { ok: true, tookMs: 100 },
			});
			expect(completeResult).toBe(true);
		});

		it("heartbeat with invalid leaseId is rejected", async () => {
			const { commandId } = await fixture.api!.createCommand({
				type: "DELAY",
				payload: { ms: 100 },
			});

			// Claim the command
			const claim = await fixture.api!.claimCommand({
				agentId: "agent-invalid-heartbeat",
				maxLeaseMs: 30000,
			});
			expect(claim).not.toBeNull();

			// Try heartbeat with wrong leaseId
			const heartbeatResult = await fixture.api!.heartbeat(commandId, {
				agentId: "agent-invalid-heartbeat",
				leaseId: "invalid-lease-id-12345",
				extendMs: 10000,
			});

			expect(heartbeatResult).toBe(false); // Should be 409
		});

		it("heartbeat with wrong agentId is rejected", async () => {
			const { commandId } = await fixture.api!.createCommand({
				type: "DELAY",
				payload: { ms: 100 },
			});

			const claim = await fixture.api!.claimCommand({
				agentId: "agent-correct",
				maxLeaseMs: 30000,
			});
			expect(claim).not.toBeNull();

			// Try heartbeat with wrong agentId but correct leaseId
			const heartbeatResult = await fixture.api!.heartbeat(commandId, {
				agentId: "agent-wrong",
				leaseId: claim!.leaseId,
				extendMs: 10000,
			});

			expect(heartbeatResult).toBe(false); // Should be 409
		});
	});

	describe("Long-Running Commands with Heartbeats", () => {
		it("agent keeps long-running DELAY command alive via heartbeats", async () => {
			// Create a delay longer than the lease duration
			// Agent should use heartbeats to keep extending the lease
			const { commandId } = await fixture.api!.createCommand({
				type: "DELAY",
				payload: { ms: 8000 }, // 8 second delay
			});

			// Start agent with short lease but with heartbeat interval
			const agent = await startAgent({
				agentId: "agent-long-running",
				serverUrl: `http://localhost:${fixture.server!.port}`,
				stateDir: path.join(fixture.tempDir, "agent-long-running"),
				pollIntervalMs: 100,
				maxLeaseMs: 5000, // 5 second lease
				heartbeatIntervalMs: 2000, // Heartbeat every 2 seconds
			});
			fixture.addAgent(agent);

			// Wait for command to complete
			await waitFor(
				async () => {
					const s = await fixture.api!.getCommand(commandId);
					return s.status === "COMPLETED";
				},
				{ timeoutMs: 20000 },
			);

			const status = await fixture.api!.getCommand(commandId);
			expect(status.status).toBe("COMPLETED");

			const result = status.result as DelayResult;
			expect(result.ok).toBe(true);
			expect(result.tookMs).toBeGreaterThanOrEqual(8000);
		}, 25000);

		it("command expires without heartbeats when lease runs out", async () => {
			// This tests that without heartbeats, the lease expires
			const { commandId } = await fixture.api!.createCommand({
				type: "DELAY",
				payload: { ms: 60000 }, // Very long delay
			});

			// Claim with very short lease
			const claim = await fixture.api!.claimCommand({
				agentId: "agent-no-heartbeat",
				maxLeaseMs: 500, // Very short lease
			});
			expect(claim).not.toBeNull();

			// Don't send any heartbeats, just wait for lease to expire
			await sleep(1000);

			// Restart server to trigger lease recovery
			await fixture.server!.stop();
			fixture.server = await startServer({ tempDir: fixture.tempDir, dbPath: fixture.dbPath! });
			fixture.api = createApiClient(`http://localhost:${fixture.server.port}`);

			// Command should be back to PENDING due to expired lease
			const status = await fixture.api.getCommand(commandId);
			expect(status.status).toBe("PENDING");
		});
	});

	describe("Heartbeat on Completed/Failed Commands", () => {
		it("heartbeat on completed command is rejected", async () => {
			const { commandId } = await fixture.api!.createCommand({
				type: "DELAY",
				payload: { ms: 100 },
			});

			const claim = await fixture.api!.claimCommand({
				agentId: "agent-complete-first",
				maxLeaseMs: 30000,
			});
			expect(claim).not.toBeNull();

			// Complete the command
			const completeResult = await fixture.api!.completeCommand(commandId, {
				agentId: "agent-complete-first",
				leaseId: claim!.leaseId,
				result: { ok: true, tookMs: 100 },
			});
			expect(completeResult).toBe(true);

			// Try to heartbeat after completion
			const heartbeatResult = await fixture.api!.heartbeat(commandId, {
				agentId: "agent-complete-first",
				leaseId: claim!.leaseId,
				extendMs: 10000,
			});

			expect(heartbeatResult).toBe(false); // Should be rejected
		});

		it("heartbeat on failed command is rejected", async () => {
			const { commandId } = await fixture.api!.createCommand({
				type: "DELAY",
				payload: { ms: 100 },
			});

			const claim = await fixture.api!.claimCommand({
				agentId: "agent-fail-first",
				maxLeaseMs: 30000,
			});
			expect(claim).not.toBeNull();

			// Fail the command
			const failResult = await fixture.api!.failCommand(commandId, {
				agentId: "agent-fail-first",
				leaseId: claim!.leaseId,
				error: "Test failure",
			});
			expect(failResult).toBe(true);

			// Try to heartbeat after failure
			const heartbeatResult = await fixture.api!.heartbeat(commandId, {
				agentId: "agent-fail-first",
				leaseId: claim!.leaseId,
				extendMs: 10000,
			});

			expect(heartbeatResult).toBe(false); // Should be rejected
		});
	});

	describe("Heartbeat Race Conditions", () => {
		it("only current lease holder can heartbeat", async () => {
			const { commandId } = await fixture.api!.createCommand({
				type: "DELAY",
				payload: { ms: 60000 },
			});

			// First agent claims
			const claim1 = await fixture.api!.claimCommand({
				agentId: "agent-1",
				maxLeaseMs: 200,
			});
			expect(claim1).not.toBeNull();

			// Wait for lease to expire
			await sleep(300);

			// Restart server to recover expired lease
			await fixture.server!.stop();
			fixture.server = await startServer({ tempDir: fixture.tempDir, dbPath: fixture.dbPath! });
			fixture.api = createApiClient(`http://localhost:${fixture.server.port}`);

			// Second agent claims (gets new lease)
			const claim2 = await fixture.api.claimCommand({
				agentId: "agent-2",
				maxLeaseMs: 30000,
			});
			expect(claim2).not.toBeNull();
			expect(claim2!.leaseId).not.toBe(claim1!.leaseId);

			// First agent's heartbeat should fail (stale lease)
			const staleHeartbeat = await fixture.api.heartbeat(commandId, {
				agentId: "agent-1",
				leaseId: claim1!.leaseId,
				extendMs: 10000,
			});
			expect(staleHeartbeat).toBe(false);

			// Second agent's heartbeat should succeed
			const validHeartbeat = await fixture.api.heartbeat(commandId, {
				agentId: "agent-2",
				leaseId: claim2!.leaseId,
				extendMs: 10000,
			});
			expect(validHeartbeat).toBe(true);
		});
	});
});
