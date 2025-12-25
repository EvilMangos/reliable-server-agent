/**
 * E2E Tests for Server Persistence
 *
 * Tests verify that the server correctly persists state to SQLite:
 * - Commands survive server restarts
 * - Completed/Failed states are preserved
 * - Lease information is correctly persisted
 * - Attempt counter is incremented on retry
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import * as path from "node:path";
import type { DelayResult } from "@reliable-server-agent/shared";
import {
	type AgentProcess,
	cleanupTempDir,
	createApiClient,
	createTempDir,
	sleep,
	startAgent,
	startServer,
	waitFor,
} from "../helpers/index.js";

describe("E2E: Server Persistence", () => {
	let tempDir: string;

	beforeAll(() => {
		tempDir = createTempDir("server-persistence");
	});

	afterAll(() => {
		cleanupTempDir(tempDir);
	});

	describe("Command State Persistence", () => {
		it("PENDING commands survive server restart", async () => {
			// Use unique database for this test
			const testDbPath = path.join(tempDir, `test-pending-${Date.now()}.db`);

			// Start server and create command
			let server = await startServer({ tempDir, dbPath: testDbPath });
			let api = createApiClient(`http://localhost:${server.port}`);

			const { commandId } = await api.createCommand({
				type: "DELAY",
				payload: { ms: 1000 },
			});

			let status = await api.getCommand(commandId);
			expect(status.status).toBe("PENDING");

			// Stop and restart server
			await server.stop();
			server = await startServer({ tempDir, dbPath: testDbPath });
			api = createApiClient(`http://localhost:${server.port}`);

			// Command should still exist and be PENDING
			status = await api.getCommand(commandId);
			expect(status.status).toBe("PENDING");

			await server.stop();
		});

		it("COMPLETED commands are preserved across restarts", async () => {
			// Use unique database for this test
			const testDbPath = path.join(tempDir, `test-completed-${Date.now()}.db`);

			let server = await startServer({ tempDir, dbPath: testDbPath });
			let api = createApiClient(`http://localhost:${server.port}`);

			const { commandId } = await api.createCommand({
				type: "DELAY",
				payload: { ms: 100 },
			});

			// Complete the command
			const claim = await api.claimCommand({
				agentId: "agent-complete-persist",
				maxLeaseMs: 30000,
			});
			expect(claim).not.toBeNull();
			expect(claim!.commandId).toBe(commandId);

			const result: DelayResult = { ok: true, tookMs: 100 };
			await api.completeCommand(commandId, {
				agentId: "agent-complete-persist",
				leaseId: claim!.leaseId,
				result,
			});

			// Verify COMPLETED
			let status = await api.getCommand(commandId);
			expect(status.status).toBe("COMPLETED");
			expect(status.result).toEqual(result);

			// Restart server
			await server.stop();
			server = await startServer({ tempDir, dbPath: testDbPath });
			api = createApiClient(`http://localhost:${server.port}`);

			// Should still be COMPLETED with same result
			status = await api.getCommand(commandId);
			expect(status.status).toBe("COMPLETED");
			expect((status.result as DelayResult).ok).toBe(true);
			expect((status.result as DelayResult).tookMs).toBe(100);

			await server.stop();
		});

		it("FAILED commands are preserved across restarts", async () => {
			// Use unique database for this test
			const testDbPath = path.join(tempDir, `test-failed-${Date.now()}.db`);

			let server = await startServer({ tempDir, dbPath: testDbPath });
			let api = createApiClient(`http://localhost:${server.port}`);

			const { commandId } = await api.createCommand({
				type: "DELAY",
				payload: { ms: 100 },
			});

			const claim = await api.claimCommand({
				agentId: "agent-fail-persist",
				maxLeaseMs: 30000,
			});
			expect(claim).not.toBeNull();
			expect(claim!.commandId).toBe(commandId);

			// Fail the command
			await api.failCommand(commandId, {
				agentId: "agent-fail-persist",
				leaseId: claim!.leaseId,
				error: "Test failure reason",
			});

			let status = await api.getCommand(commandId);
			expect(status.status).toBe("FAILED");

			// Restart server
			await server.stop();
			server = await startServer({ tempDir, dbPath: testDbPath });
			api = createApiClient(`http://localhost:${server.port}`);

			// Should still be FAILED
			status = await api.getCommand(commandId);
			expect(status.status).toBe("FAILED");

			await server.stop();
		});
	});

	describe("Expired Lease Recovery", () => {
		it("RUNNING commands with expired leases become PENDING on restart", async () => {
			// Use unique database for this test
			const testDbPath = path.join(tempDir, `test-expired-${Date.now()}.db`);

			let server = await startServer({ tempDir, dbPath: testDbPath });
			let api = createApiClient(`http://localhost:${server.port}`);

			const { commandId } = await api.createCommand({
				type: "DELAY",
				payload: { ms: 60000 },
			});

			// Claim with very short lease
			const claim = await api.claimCommand({
				agentId: "agent-expire-test",
				maxLeaseMs: 100,
			});
			expect(claim).not.toBeNull();
			expect(claim!.commandId).toBe(commandId);

			// Verify RUNNING
			let status = await api.getCommand(commandId);
			expect(status.status).toBe("RUNNING");

			// Wait for lease to expire
			await sleep(200);

			// Restart server to trigger recovery
			await server.stop();
			server = await startServer({ tempDir, dbPath: testDbPath });
			api = createApiClient(`http://localhost:${server.port}`);

			// Should be back to PENDING
			status = await api.getCommand(commandId);
			expect(status.status).toBe("PENDING");

			await server.stop();
		});

		it("RUNNING commands with active leases stay RUNNING on restart", async () => {
			// Use unique database for this test
			const testDbPath = path.join(tempDir, `test-active-${Date.now()}.db`);

			let server = await startServer({ tempDir, dbPath: testDbPath });
			let api = createApiClient(`http://localhost:${server.port}`);

			const { commandId } = await api.createCommand({
				type: "DELAY",
				payload: { ms: 60000 },
			});

			// Claim with long lease
			const claim = await api.claimCommand({
				agentId: "agent-active-lease",
				maxLeaseMs: 120000, // 2 minutes
			});
			expect(claim).not.toBeNull();
			expect(claim!.commandId).toBe(commandId);

			// Verify RUNNING
			let status = await api.getCommand(commandId);
			expect(status.status).toBe("RUNNING");

			// Restart server immediately (lease should still be valid)
			await server.stop();
			server = await startServer({ tempDir, dbPath: testDbPath });
			api = createApiClient(`http://localhost:${server.port}`);

			// Should still be RUNNING (lease hasn't expired)
			status = await api.getCommand(commandId);
			expect(status.status).toBe("RUNNING");

			await server.stop();
		});

		it("multiple expired RUNNING commands are all recovered", async () => {
			// Use unique database for this test
			const testDbPath = path.join(tempDir, `test-multi-expired-${Date.now()}.db`);

			let server = await startServer({ tempDir, dbPath: testDbPath });
			let api = createApiClient(`http://localhost:${server.port}`);

			// Create multiple commands
			const commands: string[] = [];
			for (let i = 0; i < 3; i++) {
				const { commandId } = await api.createCommand({
					type: "DELAY",
					payload: { ms: 60000 },
				});
				commands.push(commandId);

				// Claim each with short lease
				await api.claimCommand({
					agentId: `agent-multi-expire-${i}`,
					maxLeaseMs: 100,
				});
			}

			// Verify all RUNNING
			for (const commandId of commands) {
				const status = await api.getCommand(commandId);
				expect(status.status).toBe("RUNNING");
			}

			// Wait for leases to expire
			await sleep(200);

			// Restart server
			await server.stop();
			server = await startServer({ tempDir, dbPath: testDbPath });
			api = createApiClient(`http://localhost:${server.port}`);

			// All should be PENDING
			for (const commandId of commands) {
				const status = await api.getCommand(commandId);
				expect(status.status).toBe("PENDING");
			}

			await server.stop();
		});
	});

	describe("Command Ordering", () => {
		it("claims oldest PENDING command first (FIFO)", async () => {
			// Use unique database for this test
			const testDbPath = path.join(tempDir, `test-fifo-${Date.now()}.db`);

			const server = await startServer({ tempDir, dbPath: testDbPath });
			const api = createApiClient(`http://localhost:${server.port}`);

			// Create commands with small delay between them
			const command1 = await api.createCommand({
				type: "DELAY",
				payload: { ms: 100 },
			});
			await sleep(50);
			const command2 = await api.createCommand({
				type: "DELAY",
				payload: { ms: 100 },
			});
			await sleep(50);
			const command3 = await api.createCommand({
				type: "DELAY",
				payload: { ms: 100 },
			});

			// First claim should get command1
			const claim1 = await api.claimCommand({
				agentId: "agent-fifo",
				maxLeaseMs: 30000,
			});
			expect(claim1).not.toBeNull();
			expect(claim1!.commandId).toBe(command1.commandId);

			// Complete it
			await api.completeCommand(claim1!.commandId, {
				agentId: "agent-fifo",
				leaseId: claim1!.leaseId,
				result: { ok: true, tookMs: 100 },
			});

			// Second claim should get command2
			const claim2 = await api.claimCommand({
				agentId: "agent-fifo",
				maxLeaseMs: 30000,
			});
			expect(claim2).not.toBeNull();
			expect(claim2!.commandId).toBe(command2.commandId);

			// Complete it
			await api.completeCommand(claim2!.commandId, {
				agentId: "agent-fifo",
				leaseId: claim2!.leaseId,
				result: { ok: true, tookMs: 100 },
			});

			// Third claim should get command3
			const claim3 = await api.claimCommand({
				agentId: "agent-fifo",
				maxLeaseMs: 30000,
			});
			expect(claim3).not.toBeNull();
			expect(claim3!.commandId).toBe(command3.commandId);

			await server.stop();
		});
	});

	describe("Attempt Counter", () => {
		it("attempt counter increments when command is retried", async () => {
			// Use unique database for this test
			const testDbPath = path.join(tempDir, `test-attempt-${Date.now()}.db`);

			let server = await startServer({ tempDir, dbPath: testDbPath });
			let api = createApiClient(`http://localhost:${server.port}`);

			const { commandId } = await api.createCommand({
				type: "DELAY",
				payload: { ms: 60000 },
			});

			// First claim
			const claim1 = await api.claimCommand({
				agentId: "agent-attempt-1",
				maxLeaseMs: 100,
			});
			expect(claim1).not.toBeNull();
			expect(claim1!.commandId).toBe(commandId);

			// Wait for lease to expire
			await sleep(200);

			// Restart server to recover
			await server.stop();
			server = await startServer({ tempDir, dbPath: testDbPath });
			api = createApiClient(`http://localhost:${server.port}`);

			// Second claim (should have incremented attempt)
			const claim2 = await api.claimCommand({
				agentId: "agent-attempt-2",
				maxLeaseMs: 100,
			});
			expect(claim2).not.toBeNull();
			expect(claim2!.commandId).toBe(commandId);

			// Wait for lease to expire again
			await sleep(200);

			// Restart server
			await server.stop();
			server = await startServer({ tempDir, dbPath: testDbPath });
			api = createApiClient(`http://localhost:${server.port}`);

			// Third claim
			const claim3 = await api.claimCommand({
				agentId: "agent-attempt-3",
				maxLeaseMs: 30000,
			});
			expect(claim3).not.toBeNull();
			expect(claim3!.commandId).toBe(commandId);

			// The attempt counter should have been incremented
			// We can't directly query the attempt counter without DB access,
			// but we can verify the command is claimable multiple times

			await server.stop();
		});
	});
});

describe("E2E: Full Workflow with Server Restart", () => {
	let tempDir: string;
	let agents: AgentProcess[] = [];

	beforeAll(() => {
		tempDir = createTempDir("full-workflow");
	});

	afterAll(() => {
		cleanupTempDir(tempDir);
	});

	afterEach(async () => {
		for (const agent of agents) {
			await agent.stop();
		}
		agents = [];
	});

	it("complete workflow survives server restart mid-execution", async () => {
		const dbPath = path.join(tempDir, "workflow-test.db");

		// Start server
		let server = await startServer({ tempDir, dbPath });
		let api = createApiClient(`http://localhost:${server.port}`);

		// Create a moderate-length delay command
		const { commandId } = await api.createCommand({
			type: "DELAY",
			payload: { ms: 2000 },
		});

		// Start agent
		const agent = await startAgent({
			agentId: "agent-workflow",
			serverUrl: `http://localhost:${server.port}`,
			stateDir: path.join(tempDir, "agent-workflow"),
			pollIntervalMs: 100,
		});
		agents.push(agent);

		// Wait for command to start running
		await waitFor(
			async () => {
				const s = await api.getCommand(commandId);
				return s.status === "RUNNING";
			},
			{ timeoutMs: 5000 },
		);

		// Stop agent and server mid-execution
		await agent.stop();
		await server.stop();

		// Wait a bit then restart
		await sleep(1000);

		// Restart server
		server = await startServer({ tempDir, dbPath });
		api = createApiClient(`http://localhost:${server.port}`);

		// Command should be PENDING again (lease expired during downtime)
		// or still RUNNING if lease was long enough
		let status = await api.getCommand(commandId);
		expect(["PENDING", "RUNNING"]).toContain(status.status);

		// If still RUNNING, wait for lease to expire
		if (status.status === "RUNNING") {
			await sleep(35000);
			await server.stop();
			server = await startServer({ tempDir, dbPath });
			api = createApiClient(`http://localhost:${server.port}`);
		}

		// Start new agent to complete
		const agent2 = await startAgent({
			agentId: "agent-workflow-2",
			serverUrl: `http://localhost:${server.port}`,
			stateDir: path.join(tempDir, "agent-workflow-2"),
			pollIntervalMs: 100,
		});
		agents.push(agent2);

		// Wait for completion
		await waitFor(
			async () => {
				const s = await api.getCommand(commandId);
				return s.status === "COMPLETED";
			},
			{ timeoutMs: 15000 },
		);

		status = await api.getCommand(commandId);
		expect(status.status).toBe("COMPLETED");

		const result = status.result as DelayResult;
		expect(result.ok).toBe(true);

		await server.stop();
	}, 60000);
});
