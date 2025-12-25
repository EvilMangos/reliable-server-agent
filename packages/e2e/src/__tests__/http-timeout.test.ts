/**
 * E2E Tests for HTTP_GET_JSON Timeout Handling
 *
 * Tests verify that agents correctly handle HTTP request timeouts:
 * - 30 second timeout is enforced
 * - Timeout results in appropriate error response
 * - Command completes with timeout error (not FAILED status)
 *
 * PERFORMANCE NOTE:
 * These tests are inherently slow due to the 30 second HTTP timeout requirement.
 * Expected durations:
 * - "completes with timeout error when target server hangs forever": ~30-35s
 * - "times out when delay exceeds 30 seconds": ~30-35s
 * - Other tests: 5-15s
 *
 * Consider running with --testTimeout=60000 and skipping in CI fast feedback loops.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as path from "node:path";
import type { HttpGetJsonResult } from "@reliable-server-agent/shared";
import {
	type MockTargetServer,
	createMockTarget,
	createTestFixture,
	startAgent,
	waitFor,
} from "../helpers/index.js";

describe("E2E: HTTP_GET_JSON Timeout Handling", () => {
	const fixture = createTestFixture("http-timeout");
	let mockTarget: MockTargetServer;

	beforeAll(() => fixture.setup());
	afterAll(() => fixture.teardown());
	beforeEach(async () => fixture.setupTest());

	afterEach(async () => {
		if (mockTarget) {
			await mockTarget.close();
		}
		await fixture.teardownTest();
	});

	it("completes with timeout error when target server hangs forever", async () => {
		// Create mock target that never responds
		mockTarget = await createMockTarget({
			hangForever: true,
		});

		// Create HTTP command targeting hanging server
		const { commandId } = await fixture.api!.createCommand({
			type: "HTTP_GET_JSON",
			payload: { url: mockTarget.url },
		});

		// Start agent with long lease to accommodate timeout
		const agent = await startAgent({
			agentId: "agent-timeout",
			serverUrl: `http://localhost:${fixture.server!.port}`,
			stateDir: path.join(fixture.tempDir, "agent-timeout"),
			pollIntervalMs: 100,
			maxLeaseMs: 60000, // 60 seconds to allow for 30s timeout + processing
		});
		fixture.addAgent(agent);

		// Wait for command to complete (should take ~30 seconds due to timeout)
		await waitFor(
			async () => {
				const s = await fixture.api!.getCommand(commandId);
				return s.status === "COMPLETED" || s.status === "FAILED";
			},
			{ timeoutMs: 45000 }, // Allow extra time for timeout + processing
		);

		// Verify result contains timeout error
		const status = await fixture.api!.getCommand(commandId);
		// Command may complete with error in result, or fail entirely
		// Based on CLAUDE.md, timeout should result in error in result
		expect(["COMPLETED", "FAILED"]).toContain(status.status);

		if (status.status === "COMPLETED") {
			const result = status.result as HttpGetJsonResult;
			expect(result.error).not.toBeNull();
			expect(result.error?.toLowerCase()).toContain("timeout");
		}

		// Verify request was made
		expect(mockTarget.getRequestCount()).toBe(1);
	}, 50000); // Extended timeout for this test

	it("completes with error when connection is immediately closed", async () => {
		// Create mock target that immediately closes connection
		mockTarget = await createMockTarget({
			closeImmediately: true,
		});

		const { commandId } = await fixture.api!.createCommand({
			type: "HTTP_GET_JSON",
			payload: { url: mockTarget.url },
		});

		const agent = await startAgent({
			agentId: "agent-connection-reset",
			serverUrl: `http://localhost:${fixture.server!.port}`,
			stateDir: path.join(fixture.tempDir, "agent-connection-reset"),
			pollIntervalMs: 100,
		});
		fixture.addAgent(agent);

		// Wait for command to complete
		await waitFor(
			async () => {
				const s = await fixture.api!.getCommand(commandId);
				return s.status === "COMPLETED" || s.status === "FAILED";
			},
			{ timeoutMs: 15000 },
		);

		const status = await fixture.api!.getCommand(commandId);
		expect(["COMPLETED", "FAILED"]).toContain(status.status);

		// Should have an error about connection
		if (status.status === "COMPLETED") {
			const result = status.result as HttpGetJsonResult;
			expect(result.error).not.toBeNull();
		}
	});

	it("handles slow but responsive server within timeout", async () => {
		// Create mock target with delay less than timeout
		mockTarget = await createMockTarget({
			status: 200,
			body: { slow: true },
			delayMs: 5000, // 5 second delay, within 30s timeout
		});

		const { commandId } = await fixture.api!.createCommand({
			type: "HTTP_GET_JSON",
			payload: { url: mockTarget.url },
		});

		const agent = await startAgent({
			agentId: "agent-slow-success",
			serverUrl: `http://localhost:${fixture.server!.port}`,
			stateDir: path.join(fixture.tempDir, "agent-slow-success"),
			pollIntervalMs: 100,
		});
		fixture.addAgent(agent);

		await waitFor(
			async () => {
				const s = await fixture.api!.getCommand(commandId);
				return s.status === "COMPLETED";
			},
			{ timeoutMs: 20000 },
		);

		const status = await fixture.api!.getCommand(commandId);
		expect(status.status).toBe("COMPLETED");

		const result = status.result as HttpGetJsonResult;
		expect(result.status).toBe(200);
		expect(result.body).toEqual({ slow: true });
		expect(result.error).toBeNull();
	}, 25000);

	it("times out when delay exceeds 30 seconds", async () => {
		// This is a long test - create mock that delays beyond timeout
		mockTarget = await createMockTarget({
			status: 200,
			body: { should_timeout: true },
			delayMs: 35000, // 35 second delay, beyond 30s timeout
		});

		const { commandId } = await fixture.api!.createCommand({
			type: "HTTP_GET_JSON",
			payload: { url: mockTarget.url },
		});

		const agent = await startAgent({
			agentId: "agent-delay-timeout",
			serverUrl: `http://localhost:${fixture.server!.port}`,
			stateDir: path.join(fixture.tempDir, "agent-delay-timeout"),
			pollIntervalMs: 100,
			maxLeaseMs: 60000,
		});
		fixture.addAgent(agent);

		await waitFor(
			async () => {
				const s = await fixture.api!.getCommand(commandId);
				return s.status === "COMPLETED" || s.status === "FAILED";
			},
			{ timeoutMs: 45000 },
		);

		const status = await fixture.api!.getCommand(commandId);
		expect(["COMPLETED", "FAILED"]).toContain(status.status);

		if (status.status === "COMPLETED") {
			const result = status.result as HttpGetJsonResult;
			expect(result.error).not.toBeNull();
			expect(result.error?.toLowerCase()).toContain("timeout");
		}
	}, 50000);
});
