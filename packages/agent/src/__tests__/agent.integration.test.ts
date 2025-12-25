/**
 * Integration tests for Agent main loop
 *
 * Covers:
 * - Journal recovery on startup
 * - Claim-execute-report cycle
 * - Heartbeat management
 * - Handle 409 response (stale lease)
 * - Route commands to correct executor
 * - Server unavailable handling
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ClaimCommandResponse,
	DelayPayload,
	HttpGetJsonPayload,
} from "@reliable-server-agent/shared";
import { COMMAND_TYPE } from "@reliable-server-agent/shared";
import * as fs from "node:fs";
import {
	type FetchMockContext,
	captureFetchContext,
	cleanupTempDir,
	createDefaultAgentConfig,
	createTempDir,
	mockFetchNoWork,
	mockFetchWith409OnComplete,
	mockFetchWithCallTracking,
	mockFetchWithClaim,
	mockFetchWithClaimAndCapture,
	mockFetchWithNetworkError,
	mockFetchWithServerError,
	setupFakeTimers,
	teardownFakeTimers,
	writeJournalFile,
} from "./test-utils.js";
import { AgentImpl } from "../index.js";

describe("Agent Integration", () => {
	let tempDir: string;
	let fetchContext: FetchMockContext;

	beforeEach(() => {
		setupFakeTimers();
		tempDir = createTempDir();
		fetchContext = captureFetchContext();
	});

	afterEach(() => {
		teardownFakeTimers();
		fetchContext.restore();
		cleanupTempDir(tempDir);
	});

	describe("Journal Recovery on Startup", () => {
		it("recovers from RESULT_SAVED stage and attempts completion", async () => {
			// Setup: Create a journal file with saved result
			writeJournalFile(tempDir, "agent-123", {
				commandId: "cmd-456",
				leaseId: "lease-789",
				type: COMMAND_TYPE.HTTP_GET_JSON,
				startedAt: Date.now() - 5000,
				scheduledEndAt: null,
				httpSnapshot: {
					status: 200,
					body: { data: "test" },
					truncated: false,
					bytesReturned: 15,
					error: null,
				},
				stage: "RESULT_SAVED",
			});

			// Track calls to the complete endpoint via fetch mock
			let completeCalledWith: { commandId: string; leaseId: string; result: unknown } | null = null;
			global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
				if (url.includes("/complete")) {
					const body = JSON.parse(options?.body as string);
					completeCalledWith = {
						commandId: url.match(/commands\/([^/]+)\/complete/)?.[1] || "",
						leaseId: body.leaseId,
						result: body.result,
					};
					return Promise.resolve({ status: 204, ok: true });
				}
				if (url.includes("/heartbeat")) {
					return Promise.resolve({ status: 204, ok: true });
				}
				return Promise.resolve({ status: 204, ok: true });
			});

			// Create agent
			const agent = new AgentImpl(createDefaultAgentConfig(tempDir, { agentId: "agent-123" }));

			// Run one iteration of recovery
			await agent.recoverFromJournal();

			// Should attempt to complete with saved result
			expect(completeCalledWith).not.toBeNull();
			expect(completeCalledWith!.commandId).toBe("cmd-456");
			expect(completeCalledWith!.leaseId).toBe("lease-789");
			expect(completeCalledWith!.result).toEqual(expect.objectContaining({ status: 200 }));
		});

		it("deletes journal after server confirms completion with 204", async () => {
			const { journalPath } = writeJournalFile(tempDir, "agent-456", {
				commandId: "cmd-789",
				leaseId: "lease-012",
				type: COMMAND_TYPE.DELAY,
				startedAt: Date.now() - 2000,
				scheduledEndAt: Date.now() - 1000, // Already past
				stage: "RESULT_SAVED",
			});

			const agent = new AgentImpl(createDefaultAgentConfig(tempDir, { agentId: "agent-456" }));

			mockFetchNoWork();

			await agent.recoverFromJournal();

			// Journal file should be deleted
			expect(fs.existsSync(journalPath)).toBe(false);
		});

		it("deletes journal when server returns 409 (lease no longer valid)", async () => {
			const { journalPath } = writeJournalFile(tempDir, "agent-789", {
				commandId: "cmd-stale",
				leaseId: "lease-stale",
				type: COMMAND_TYPE.HTTP_GET_JSON,
				startedAt: Date.now() - 60000,
				scheduledEndAt: null,
				httpSnapshot: {
					status: 200,
					body: "data",
					truncated: false,
					bytesReturned: 4,
					error: null,
				},
				stage: "RESULT_SAVED",
			});

			const agent = new AgentImpl(createDefaultAgentConfig(tempDir, { agentId: "agent-789" }));

			mockFetchWith409OnComplete();

			await agent.recoverFromJournal();

			// Journal file should be deleted (lease is stale, move on)
			expect(fs.existsSync(journalPath)).toBe(false);
		});

		it("resumes DELAY command by waiting remaining time", async () => {
			const now = Date.now();
			writeJournalFile(tempDir, "agent-delay", {
				commandId: "cmd-delay",
				leaseId: "lease-delay",
				type: COMMAND_TYPE.DELAY,
				startedAt: now - 3000, // Started 3s ago
				scheduledEndAt: now + 2000, // 2s remaining
				stage: "IN_PROGRESS",
			});

			const agent = new AgentImpl(createDefaultAgentConfig(tempDir, { agentId: "agent-delay" }));

			const fetchMock = mockFetchNoWork();

			const recoveryPromise = agent.recoverFromJournal();

			// Advance time for remaining delay
			await vi.advanceTimersByTimeAsync(2000);

			await recoveryPromise;

			// Should have attempted completion
			expect(fetchMock).toHaveBeenCalledWith(
				expect.stringContaining("/complete"),
				expect.any(Object),
			);
		});
	});

	describe("Claim-Execute-Report Cycle", () => {
		it("claims command, executes, and reports completion", async () => {
			const agent = new AgentImpl(createDefaultAgentConfig(tempDir, { agentId: "agent-cycle" }));

			const claimResponse: ClaimCommandResponse = {
				commandId: "cmd-exec",
				type: COMMAND_TYPE.DELAY,
				payload: { ms: 1000 } as DelayPayload,
				leaseId: "lease-exec",
				leaseExpiresAt: Date.now() + 30000,
				startedAt: Date.now(),
				scheduledEndAt: Date.now() + 1000,
			};

			const fetchMock = mockFetchWithClaim(claimResponse);

			const iterationPromise = agent.runOneIteration();
			await vi.advanceTimersByTimeAsync(1000);
			await iterationPromise;

			// Should have called claim and complete
			const fetchCalls = fetchMock.mock.calls as [string, ...unknown[]][];
			expect(fetchCalls.some((call) => call[0].includes("/claim"))).toBe(true);
			expect(fetchCalls.some((call) => call[0].includes("/complete"))).toBe(true);
		});

		it("returns to poll loop when claim returns 204 (no work)", async () => {
			const agent = new AgentImpl(createDefaultAgentConfig(tempDir, { agentId: "agent-nowork" }));

			const fetchMock = mockFetchNoWork();

			await agent.runOneIteration();

			// Should have called claim only once, no execute/complete
			const fetchCalls = fetchMock.mock.calls as [string, ...unknown[]][];
			expect(fetchCalls.length).toBe(1);
			expect(fetchCalls[0][0]).toContain("/claim");
		});
	});

	describe("Heartbeat Management", () => {
		it("starts heartbeat immediately after claim", async () => {
			const agent = new AgentImpl(createDefaultAgentConfig(tempDir, {
				agentId: "agent-hb",
				heartbeatIntervalMs: 5000, // 5 second interval
			}));

			const claimResponse: ClaimCommandResponse = {
				commandId: "cmd-hb",
				type: COMMAND_TYPE.DELAY,
				payload: { ms: 20000 } as DelayPayload,
				leaseId: "lease-hb",
				leaseExpiresAt: Date.now() + 30000,
				startedAt: Date.now(),
				scheduledEndAt: Date.now() + 20000,
			};

			const fetchMock = mockFetchWithClaim(claimResponse);

			const iterationPromise = agent.runOneIteration();

			// Advance past heartbeat interval
			await vi.advanceTimersByTimeAsync(6000);

			// Should have called heartbeat
			const fetchCalls = fetchMock.mock.calls as [string, ...unknown[]][];
			expect(fetchCalls.some((call) => call[0].includes("/heartbeat"))).toBe(true);

			// Complete the iteration
			await vi.advanceTimersByTimeAsync(14000);
			await iterationPromise;
		});

		it("stops heartbeat before reporting completion", async () => {
			const agent = new AgentImpl(createDefaultAgentConfig(tempDir, {
				agentId: "agent-hbstop",
				heartbeatIntervalMs: 2000,
			}));

			const claimResponse: ClaimCommandResponse = {
				commandId: "cmd-hbstop",
				type: COMMAND_TYPE.DELAY,
				payload: { ms: 3000 } as DelayPayload,
				leaseId: "lease-hbstop",
				leaseExpiresAt: Date.now() + 30000,
				startedAt: Date.now(),
				scheduledEndAt: Date.now() + 3000,
			};

			const { getHeartbeatCalls, getCompleteCalls } = mockFetchWithCallTracking(claimResponse);

			const iterationPromise = agent.runOneIteration();
			await vi.advanceTimersByTimeAsync(3000);
			await iterationPromise;

			const heartbeatCalls = getHeartbeatCalls();
			const completeCalls = getCompleteCalls();

			// Complete should be called, and no heartbeats after complete
			expect(completeCalls.length).toBe(1);
			// All heartbeat calls should be before complete
			for (const hbCall of heartbeatCalls) {
				expect(hbCall).toBeLessThan(completeCalls[0]);
			}
		});
	});

	describe("409 Response Handling", () => {
		it("deletes journal and continues to poll when completion returns 409", async () => {
			// Use RESULT_SAVED stage so no waiting is needed - we're testing the 409 handling,
			// not the delay execution itself
			const { journalPath } = writeJournalFile(tempDir, "agent-409", {
				commandId: "cmd-409",
				leaseId: "lease-409",
				type: COMMAND_TYPE.DELAY,
				startedAt: Date.now() - 2000,
				scheduledEndAt: Date.now() - 1000, // Already past
				stage: "RESULT_SAVED",
			});

			const agent = new AgentImpl(createDefaultAgentConfig(tempDir, { agentId: "agent-409" }));

			mockFetchWith409OnComplete();

			await agent.recoverFromJournal();

			// Journal should be deleted
			expect(fs.existsSync(journalPath)).toBe(false);
		});

		it("does not retry completion after 409", async () => {
			const agent = new AgentImpl(createDefaultAgentConfig(tempDir, { agentId: "agent-noretry" }));

			let completeCallCount = 0;
			global.fetch = vi.fn().mockImplementation((url: string) => {
				if (url.includes("/claim")) {
					return Promise.resolve({
						status: 200,
						ok: true,
						json: () =>
							Promise.resolve({
								commandId: "cmd-noretry",
								type: COMMAND_TYPE.DELAY,
								payload: { ms: 100 },
								leaseId: "lease-noretry",
								leaseExpiresAt: Date.now() + 30000,
								startedAt: Date.now(),
								scheduledEndAt: Date.now() + 100,
							}),
					});
				}
				if (url.includes("/complete")) {
					completeCallCount++;
					return Promise.resolve({ status: 409, ok: false });
				}
				return Promise.resolve({ status: 204, ok: true });
			});

			const iterationPromise = agent.runOneIteration();
			await vi.advanceTimersByTimeAsync(100);
			await iterationPromise;

			// Should only call complete once (no retry)
			expect(completeCallCount).toBe(1);
		});
	});

	describe("Command Routing", () => {
		it("routes DELAY commands to delay executor", async () => {
			const agent = new AgentImpl(createDefaultAgentConfig(tempDir, { agentId: "agent-route-delay" }));

			const claimResponse: ClaimCommandResponse = {
				commandId: "cmd-route-delay",
				type: COMMAND_TYPE.DELAY,
				payload: { ms: 500 } as DelayPayload,
				leaseId: "lease-route-delay",
				leaseExpiresAt: Date.now() + 30000,
				startedAt: Date.now(),
				scheduledEndAt: Date.now() + 500,
			};

			const { getCompleteBody } = mockFetchWithClaimAndCapture(claimResponse);

			const iterationPromise = agent.runOneIteration();
			await vi.advanceTimersByTimeAsync(500);
			await iterationPromise;

			// Check that result has DELAY structure
			const completeBody = getCompleteBody();
			expect(completeBody).not.toBeNull();
			expect(completeBody!.result).toEqual(
				expect.objectContaining({
					ok: true,
					tookMs: expect.any(Number),
				}),
			);
		});

		it("routes HTTP_GET_JSON commands to http executor", async () => {
			const agent = new AgentImpl(createDefaultAgentConfig(tempDir, { agentId: "agent-route-http" }));

			const claimResponse: ClaimCommandResponse = {
				commandId: "cmd-route-http",
				type: COMMAND_TYPE.HTTP_GET_JSON,
				payload: { url: "http://example.com/api" } as HttpGetJsonPayload,
				leaseId: "lease-route-http",
				leaseExpiresAt: Date.now() + 30000,
				startedAt: Date.now(),
				scheduledEndAt: null,
			};

			let completeBody: Record<string, unknown> | null = null;
			global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
				if (url.includes("/claim")) {
					return Promise.resolve({
						status: 200,
						ok: true,
						json: () => Promise.resolve(claimResponse),
					});
				}
				if (url.includes("example.com")) {
					return Promise.resolve({
						status: 200,
						ok: true,
						text: () => Promise.resolve('{"test": true}'),
					});
				}
				if (url.includes("/complete")) {
					completeBody = JSON.parse(options?.body as string);
					return Promise.resolve({ status: 204, ok: true });
				}
				return Promise.resolve({ status: 204, ok: true });
			});

			await agent.runOneIteration();

			// Check that result has HTTP_GET_JSON structure
			expect(completeBody).not.toBeNull();
			expect(completeBody!.result).toEqual(
				expect.objectContaining({
					status: expect.any(Number),
					body: expect.anything(),
					truncated: expect.any(Boolean),
					bytesReturned: expect.any(Number),
				}),
			);
		});

		it("handles unknown command type gracefully without crashing", async () => {
			const agent = new AgentImpl(createDefaultAgentConfig(tempDir, { agentId: "agent-unknown" }));

			const claimResponse = {
				commandId: "cmd-unknown",
				type: "UNKNOWN_TYPE",
				payload: {},
				leaseId: "lease-unknown",
				leaseExpiresAt: Date.now() + 30000,
				startedAt: Date.now(),
				scheduledEndAt: null,
			};

			global.fetch = vi.fn().mockImplementation((url: string) => {
				if (url.includes("/claim")) {
					return Promise.resolve({
						status: 200,
						ok: true,
						json: () => Promise.resolve(claimResponse),
					});
				}
				return Promise.resolve({ status: 204, ok: true });
			});

			// Agent should handle unknown command type gracefully (fault-tolerant)
			// It logs the error and deletes the journal, but doesn't throw
			await expect(agent.runOneIteration()).resolves.not.toThrow();
		});
	});

	describe("Server Unavailability Handling", () => {
		it("handles network errors gracefully during claim", async () => {
			const agent = new AgentImpl(createDefaultAgentConfig(tempDir, { agentId: "agent-netfail" }));

			mockFetchWithNetworkError("Network error");

			// Should not throw, should handle gracefully
			await expect(agent.runOneIteration()).resolves.not.toThrow();
		});

		it("continues polling after server errors", async () => {
			const agent = new AgentImpl(createDefaultAgentConfig(tempDir, { agentId: "agent-retry" }));

			let callCount = 0;
			global.fetch = vi.fn().mockImplementation(() => {
				callCount++;
				if (callCount === 1) {
					return Promise.reject(new Error("Server down"));
				}
				return Promise.resolve({ status: 204, ok: true });
			});

			// First iteration - should handle error
			await agent.runOneIteration();
			expect(callCount).toBe(1);

			// Second iteration - should succeed
			await agent.runOneIteration();
			expect(callCount).toBe(2);
		});

		it("handles server 500 errors gracefully", async () => {
			const agent = new AgentImpl(createDefaultAgentConfig(tempDir, { agentId: "agent-500" }));

			mockFetchWithServerError(500, "Internal Server Error");

			// Should not throw
			await expect(agent.runOneIteration()).resolves.not.toThrow();
		});
	});

	describe("Lease Validity During Execution", () => {
		it("stops execution when heartbeat fails (lease expired)", async () => {
			const agent = new AgentImpl(createDefaultAgentConfig(tempDir, {
				agentId: "agent-expiry",
				heartbeatIntervalMs: 2000, // 2 second heartbeat
			}));

			const claimResponse: ClaimCommandResponse = {
				commandId: "cmd-expiry",
				type: COMMAND_TYPE.DELAY,
				payload: { ms: 10000 } as DelayPayload,
				leaseId: "lease-expiry",
				leaseExpiresAt: Date.now() + 30000,
				startedAt: Date.now(),
				scheduledEndAt: Date.now() + 10000,
			};

			let heartbeatCount = 0;
			global.fetch = vi.fn().mockImplementation((url: string) => {
				if (url.includes("/claim")) {
					return Promise.resolve({
						status: 200,
						ok: true,
						json: () => Promise.resolve(claimResponse),
					});
				}
				if (url.includes("/heartbeat")) {
					heartbeatCount++;
					// First heartbeat succeeds, second fails
					if (heartbeatCount === 1) {
						return Promise.resolve({ status: 204, ok: true });
					}
					return Promise.resolve({ status: 409, ok: false });
				}
				return Promise.resolve({ status: 204, ok: true });
			});

			const iterationPromise = agent.runOneIteration();

			// Advance past first heartbeat (should succeed)
			await vi.advanceTimersByTimeAsync(2000);

			// Advance past second heartbeat (should fail and stop execution)
			await vi.advanceTimersByTimeAsync(2000);

			// The iteration should complete gracefully (fault-tolerant behavior)
			// Agent catches the lease expiry error internally and continues
			await iterationPromise;

			// Heartbeat should have been called at least once
			expect(heartbeatCount).toBeGreaterThan(0);
		});
	});
});
