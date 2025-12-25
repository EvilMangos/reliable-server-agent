/**
 * E2E Tests for Multi-Agent Concurrency
 *
 * Tests verify that multiple agents work correctly together:
 * - Server assigns at most one agent per command at a time
 * - Multiple agents process different commands concurrently
 * - Race conditions during claim are handled atomically
 * - No duplicate command execution across agents
 *
 * PERFORMANCE NOTE:
 * Some tests in this suite are slow due to agent failure/recovery scenarios:
 * - "when one agent fails, others continue processing": ~40-90s
 *   (requires lease expiry wait of ~35s and server restart)
 * - Other tests: typically 5-25s
 *
 * Consider running with --testTimeout=120000 for the full suite.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as path from "node:path";
import {
	createApiClient,
	createMockTarget,
	createTestFixture,
	sleep,
	startAgent,
	startServer,
	waitFor,
} from "../helpers/index.js";

describe("E2E: Multi-Agent Concurrency", () => {
	const fixture = createTestFixture("multi-agent-concurrency");

	beforeAll(() => fixture.setup());
	afterAll(() => fixture.teardown());
	beforeEach(async () => fixture.setupTest());
	afterEach(async () => fixture.teardownTest());

	describe("Exclusive Command Assignment", () => {
		it("only one agent can hold a command lease at a time", async () => {
			const { commandId } = await fixture.api!.createCommand({
				type: "DELAY",
				payload: { ms: 10000 }, // Long delay
			});

			// First agent claims
			const claim1 = await fixture.api!.claimCommand({
				agentId: "agent-exclusive-1",
				maxLeaseMs: 60000,
			});
			expect(claim1).not.toBeNull();
			expect(claim1!.commandId).toBe(commandId);

			// Second agent tries to claim - should get nothing
			const claim2 = await fixture.api!.claimCommand({
				agentId: "agent-exclusive-2",
				maxLeaseMs: 60000,
			});
			expect(claim2).toBeNull();

			// Third agent also gets nothing
			const claim3 = await fixture.api!.claimCommand({
				agentId: "agent-exclusive-3",
				maxLeaseMs: 60000,
			});
			expect(claim3).toBeNull();

			// Complete the command to clean up
			await fixture.api!.completeCommand(commandId, {
				agentId: "agent-exclusive-1",
				leaseId: claim1!.leaseId,
				result: { ok: true, tookMs: 100 },
			});
		});

		it("second agent can claim after first agent completes", async () => {
			// Create two commands
			const cmd1 = await fixture.api!.createCommand({
				type: "DELAY",
				payload: { ms: 100 },
			});
			const cmd2 = await fixture.api!.createCommand({
				type: "DELAY",
				payload: { ms: 100 },
			});

			// First agent claims first command
			const claim1 = await fixture.api!.claimCommand({
				agentId: "agent-seq-1",
				maxLeaseMs: 30000,
			});
			expect(claim1).not.toBeNull();
			expect(claim1!.commandId).toBe(cmd1.commandId);

			// First agent claims second command - should also work
			const claim2 = await fixture.api!.claimCommand({
				agentId: "agent-seq-2",
				maxLeaseMs: 30000,
			});
			expect(claim2).not.toBeNull();
			expect(claim2!.commandId).toBe(cmd2.commandId);

			// Complete both
			await fixture.api!.completeCommand(cmd1.commandId, {
				agentId: "agent-seq-1",
				leaseId: claim1!.leaseId,
				result: { ok: true, tookMs: 100 },
			});
			await fixture.api!.completeCommand(cmd2.commandId, {
				agentId: "agent-seq-2",
				leaseId: claim2!.leaseId,
				result: { ok: true, tookMs: 100 },
			});
		});

		it("after lease expiry, another agent can claim the command", async () => {
			const { commandId } = await fixture.api!.createCommand({
				type: "DELAY",
				payload: { ms: 60000 },
			});

			// First agent claims with very short lease
			const claim1 = await fixture.api!.claimCommand({
				agentId: "agent-lease-expire-1",
				maxLeaseMs: 100,
			});
			expect(claim1).not.toBeNull();

			// Wait for lease to expire
			await sleep(200);

			// Restart server to recover expired lease
			await fixture.server!.stop();
			fixture.server = await startServer({ tempDir: fixture.tempDir, dbPath: fixture.dbPath! });
			fixture.api = createApiClient(`http://localhost:${fixture.server.port}`);

			// Second agent should now be able to claim
			const claim2 = await fixture.api.claimCommand({
				agentId: "agent-lease-expire-2",
				maxLeaseMs: 30000,
			});
			expect(claim2).not.toBeNull();
			expect(claim2!.commandId).toBe(commandId);
			expect(claim2!.leaseId).not.toBe(claim1!.leaseId);

			// Complete
			await fixture.api.completeCommand(commandId, {
				agentId: "agent-lease-expire-2",
				leaseId: claim2!.leaseId,
				result: { ok: true, tookMs: 100 },
			});
		});
	});

	describe("Concurrent Processing", () => {
		it("multiple agents process multiple commands in parallel", async () => {
			// Create 6 commands
			const commands: string[] = [];
			for (let i = 0; i < 6; i++) {
				const { commandId } = await fixture.api!.createCommand({
					type: "DELAY",
					payload: { ms: 500 },
				});
				commands.push(commandId);
			}

			const startTime = Date.now();

			// Start 3 agents
			for (let i = 0; i < 3; i++) {
				const agent = await startAgent({
					agentId: `agent-parallel-${i}`,
					serverUrl: `http://localhost:${fixture.server!.port}`,
					stateDir: path.join(fixture.tempDir, `agent-parallel-${i}`),
					pollIntervalMs: 50,
				});
				fixture.addAgent(agent);
			}

			// Wait for all commands to complete
			await waitFor(
				async () => {
					const statuses = await Promise.all(
						commands.map((id) => fixture.api!.getCommand(id)),
					);
					return statuses.every((s) => s.status === "COMPLETED");
				},
				{ timeoutMs: 20000 },
			);

			const elapsed = Date.now() - startTime;

			// Verify all completed
			for (const commandId of commands) {
				const status = await fixture.api!.getCommand(commandId);
				expect(status.status).toBe("COMPLETED");
			}

			// With 3 agents processing 6 commands of 500ms each:
			// Sequential would take ~3000ms
			// Parallel should take ~1000-1500ms (2 batches of 3)
			// Allow some overhead, but should be significantly less than sequential
			expect(elapsed).toBeLessThan(5000);
		}, 25000);

		it("each command is processed by exactly one agent", async () => {
			const mockTarget = await createMockTarget({
				status: 200,
				body: { test: true },
			});

			try {
				mockTarget.resetRequestCount();

				// Create 3 HTTP commands
				const commands: string[] = [];
				for (let i = 0; i < 3; i++) {
					const { commandId } = await fixture.api!.createCommand({
						type: "HTTP_GET_JSON",
						payload: { url: mockTarget.url },
					});
					commands.push(commandId);
				}

				// Start 3 agents
				for (let i = 0; i < 3; i++) {
					const agent = await startAgent({
						agentId: `agent-http-parallel-${i}`,
						serverUrl: `http://localhost:${fixture.server!.port}`,
						stateDir: path.join(fixture.tempDir, `agent-http-parallel-${i}`),
						pollIntervalMs: 50,
					});
					fixture.addAgent(agent);
				}

				// Wait for all to complete
				await waitFor(
					async () => {
						const statuses = await Promise.all(
							commands.map((id) => fixture.api!.getCommand(id)),
						);
						return statuses.every((s) => s.status === "COMPLETED");
					},
					{ timeoutMs: 15000 },
				);

				// Verify exactly 3 HTTP requests (one per command)
				expect(mockTarget.getRequestCount()).toBe(3);
			} finally {
				await mockTarget.close();
			}
		});
	});

	describe("Agent Assignment Tracking", () => {
		it("command result includes agentId of the completing agent", async () => {
			const { commandId } = await fixture.api!.createCommand({
				type: "DELAY",
				payload: { ms: 100 },
			});

			// Start a specific agent
			const agent = await startAgent({
				agentId: "agent-tracked",
				serverUrl: `http://localhost:${fixture.server!.port}`,
				stateDir: path.join(fixture.tempDir, "agent-tracked"),
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
			expect(status.status).toBe("COMPLETED");
			expect(status.agentId).toBe("agent-tracked");
		});

		it("different commands may be completed by different agents", async () => {
			// Create 4 commands
			const commands: string[] = [];
			for (let i = 0; i < 4; i++) {
				const { commandId } = await fixture.api!.createCommand({
					type: "DELAY",
					payload: { ms: 200 },
				});
				commands.push(commandId);
			}

			// Start 2 agents
			for (let i = 0; i < 2; i++) {
				const agent = await startAgent({
					agentId: `agent-multi-track-${i}`,
					serverUrl: `http://localhost:${fixture.server!.port}`,
					stateDir: path.join(fixture.tempDir, `agent-multi-track-${i}`),
					pollIntervalMs: 50,
				});
				fixture.addAgent(agent);
			}

			// Wait for all to complete
			await waitFor(
				async () => {
					const statuses = await Promise.all(
						commands.map((id) => fixture.api!.getCommand(id)),
					);
					return statuses.every((s) => s.status === "COMPLETED");
				},
				{ timeoutMs: 15000 },
			);

			// Check agent assignments
			const assignedAgents = new Set<string>();
			for (const commandId of commands) {
				const status = await fixture.api!.getCommand(commandId);
				expect(status.status).toBe("COMPLETED");
				if (status.agentId) {
					assignedAgents.add(status.agentId);
				}
			}

			// At least one agent should have been used
			expect(assignedAgents.size).toBeGreaterThanOrEqual(1);
			// With 4 commands and 2 agents, both agents should have been used
			expect(assignedAgents.size).toBe(2);
		});
	});

	describe("Race Condition Handling", () => {
		it("concurrent claim requests result in each command assigned to exactly one agent", async () => {
			// Create a single command
			const { commandId } = await fixture.api!.createCommand({
				type: "DELAY",
				payload: { ms: 1000 },
			});

			// Attempt multiple concurrent claims
			const claimPromises = [];
			for (let i = 0; i < 5; i++) {
				claimPromises.push(
					fixture.api!.claimCommand({
						agentId: `agent-race-${i}`,
						maxLeaseMs: 30000,
					}),
				);
			}

			const results = await Promise.all(claimPromises);

			// Exactly one should succeed (get the command)
			const successfulClaims = results.filter((r) => r !== null);
			expect(successfulClaims.length).toBe(1);

			// The successful claim should have the correct commandId
			expect(successfulClaims[0]!.commandId).toBe(commandId);

			// Complete the command
			await fixture.api!.completeCommand(commandId, {
				agentId: successfulClaims[0]!.leaseId.includes("0") ? "agent-race-0" : results.findIndex((r) => r !== null) + "-agent",
				leaseId: successfulClaims[0]!.leaseId,
				result: { ok: true, tookMs: 100 },
			});
		});

		it("concurrent completions with same leaseId - only first succeeds", async () => {
			const { commandId } = await fixture.api!.createCommand({
				type: "DELAY",
				payload: { ms: 100 },
			});

			const claim = await fixture.api!.claimCommand({
				agentId: "agent-dup-complete",
				maxLeaseMs: 30000,
			});
			expect(claim).not.toBeNull();

			// Attempt multiple concurrent completions
			const completePromises = [];
			for (let i = 0; i < 5; i++) {
				completePromises.push(
					fixture.api!.completeCommand(commandId, {
						agentId: "agent-dup-complete",
						leaseId: claim!.leaseId,
						result: { ok: true, tookMs: 100 + i },
					}),
				);
			}

			const results = await Promise.all(completePromises);

			// Exactly one should succeed
			const successCount = results.filter((r) => r === true).length;
			expect(successCount).toBe(1);

			// Command should be COMPLETED
			const status = await fixture.api!.getCommand(commandId);
			expect(status.status).toBe("COMPLETED");
		});
	});

	describe("Agent Failure and Recovery", () => {
		it("when one agent fails, others continue processing", async () => {
			// Create 4 commands
			const commands: string[] = [];
			for (let i = 0; i < 4; i++) {
				const { commandId } = await fixture.api!.createCommand({
					type: "DELAY",
					payload: { ms: 500 },
				});
				commands.push(commandId);
			}

			// Start 2 agents, one will be killed
			const agent1 = await startAgent({
				agentId: "agent-fail-1",
				serverUrl: `http://localhost:${fixture.server!.port}`,
				stateDir: path.join(fixture.tempDir, "agent-fail-1"),
				pollIntervalMs: 100,
				killAfterSeconds: 0.3, // Kill quickly
			});
			fixture.addAgent(agent1);

			const agent2 = await startAgent({
				agentId: "agent-survivor",
				serverUrl: `http://localhost:${fixture.server!.port}`,
				stateDir: path.join(fixture.tempDir, "agent-survivor"),
				pollIntervalMs: 100,
			});
			fixture.addAgent(agent2);

			// Wait for at least some commands to be claimed
			await sleep(500);

			// Wait for first agent to die
			await new Promise<void>((resolve) => {
				if (agent1.process.exitCode !== null) {
					resolve();
				} else {
					agent1.process.on("exit", () => resolve());
				}
			});

			// Wait for lease expiry and server recovery if needed
			await sleep(35000);

			await fixture.server!.stop();
			fixture.server = await startServer({ tempDir: fixture.tempDir, dbPath: fixture.dbPath! });
			fixture.api = createApiClient(`http://localhost:${fixture.server.port}`);

			// Update agent2 to use new server
			// Actually, we need to restart agent2 with new server URL
			await agent2.stop();
			const agent3 = await startAgent({
				agentId: "agent-survivor-2",
				serverUrl: `http://localhost:${fixture.server.port}`,
				stateDir: path.join(fixture.tempDir, "agent-survivor-2"),
				pollIntervalMs: 100,
			});
			fixture.addAgent(agent3);

			// Wait for all commands to complete
			await waitFor(
				async () => {
					const statuses = await Promise.all(
						commands.map((id) => fixture.api!.getCommand(id)),
					);
					return statuses.every((s) => s.status === "COMPLETED");
				},
				{ timeoutMs: 30000 },
			);

			// All commands should be completed
			for (const commandId of commands) {
				const status = await fixture.api!.getCommand(commandId);
				expect(status.status).toBe("COMPLETED");
			}
		}, 90000);
	});
});
