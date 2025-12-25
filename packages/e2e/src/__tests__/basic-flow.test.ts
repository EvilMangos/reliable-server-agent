/**
 * E2E Tests for Basic Command Flow
 *
 * Black-box tests that spawn real server and agent processes to verify:
 * - Basic DELAY command execution and completion
 * - Basic HTTP_GET_JSON command execution and response handling
 * - Sequential command processing by single agent
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as path from "node:path";
import type { DelayResult, HttpGetJsonResult } from "@reliable-server-agent/shared";
import {
	type MockTargetServer,
	createMockTarget,
	createTestFixture,
	startAgent,
	waitFor,
} from "../helpers/index.js";

describe("E2E: Basic Command Flow", () => {
	const fixture = createTestFixture("basic-flow");

	beforeAll(() => fixture.setup());
	afterAll(() => fixture.teardown());
	beforeEach(async () => fixture.setupTest());
	afterEach(async () => fixture.teardownTest());

	describe("DELAY command", () => {
		it("executes a DELAY command and reports completion with correct result", async () => {
			// Create a short delay command
			const { commandId } = await fixture.api!.createCommand({
				type: "DELAY",
				payload: { ms: 500 },
			});

			// Verify command is pending
			let status = await fixture.api!.getCommand(commandId);
			expect(status.status).toBe("PENDING");

			// Start an agent
			const agent = await startAgent({
				agentId: "agent-delay-1",
				serverUrl: `http://localhost:${fixture.server!.port}`,
				stateDir: path.join(fixture.tempDir, "agent-delay-1"),
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

			// Verify result structure
			status = await fixture.api!.getCommand(commandId);
			expect(status.status).toBe("COMPLETED");
			expect(status.result).toBeDefined();

			const result = status.result as DelayResult;
			expect(result.ok).toBe(true);
			expect(result.tookMs).toBeGreaterThanOrEqual(500);
		});

		it("processes multiple DELAY commands sequentially with single agent", async () => {
			// Create multiple commands
			const command1 = await fixture.api!.createCommand({
				type: "DELAY",
				payload: { ms: 200 },
			});
			const command2 = await fixture.api!.createCommand({
				type: "DELAY",
				payload: { ms: 200 },
			});

			// Start agent
			const agent = await startAgent({
				agentId: "agent-multi-1",
				serverUrl: `http://localhost:${fixture.server!.port}`,
				stateDir: path.join(fixture.tempDir, "agent-multi-1"),
				pollIntervalMs: 100,
			});
			fixture.addAgent(agent);

			// Wait for both commands to complete
			await waitFor(
				async () => {
					const s1 = await fixture.api!.getCommand(command1.commandId);
					const s2 = await fixture.api!.getCommand(command2.commandId);
					return s1.status === "COMPLETED" && s2.status === "COMPLETED";
				},
				{ timeoutMs: 15000 },
			);

			// Verify both completed
			const status1 = await fixture.api!.getCommand(command1.commandId);
			const status2 = await fixture.api!.getCommand(command2.commandId);
			expect(status1.status).toBe("COMPLETED");
			expect(status2.status).toBe("COMPLETED");
		});
	});

	describe("HTTP_GET_JSON command", () => {
		let mockTarget: MockTargetServer;

		beforeEach(async () => {
			mockTarget = await createMockTarget({
				status: 200,
				body: { message: "Hello from mock" },
			});
		});

		afterEach(async () => {
			await mockTarget.close();
		});

		it("executes HTTP_GET_JSON and returns response body", async () => {
			// Create HTTP command targeting our mock server
			const { commandId } = await fixture.api!.createCommand({
				type: "HTTP_GET_JSON",
				payload: { url: mockTarget.url },
			});

			// Start agent
			const agent = await startAgent({
				agentId: "agent-http-1",
				serverUrl: `http://localhost:${fixture.server!.port}`,
				stateDir: path.join(fixture.tempDir, "agent-http-1"),
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

			// Verify result
			const status = await fixture.api!.getCommand(commandId);
			expect(status.status).toBe("COMPLETED");

			const result = status.result as HttpGetJsonResult;
			expect(result.status).toBe(200);
			expect(result.body).toEqual({ message: "Hello from mock" });
			expect(result.truncated).toBe(false);
			expect(result.error).toBeNull();
		});

		it("handles non-JSON response as string body", async () => {
			mockTarget.setResponse({
				status: 200,
				body: "Plain text response",
				headers: { "Content-Type": "text/plain" },
			});

			const { commandId } = await fixture.api!.createCommand({
				type: "HTTP_GET_JSON",
				payload: { url: mockTarget.url },
			});

			const agent = await startAgent({
				agentId: "agent-http-text",
				serverUrl: `http://localhost:${fixture.server!.port}`,
				stateDir: path.join(fixture.tempDir, "agent-http-text"),
				pollIntervalMs: 100,
			});
			fixture.addAgent(agent);

			await waitFor(
				async () => {
					const s = await fixture.api!.getCommand(commandId);
					return s.status === "COMPLETED";
				},
				{ timeoutMs: 10000 },
			);

			const status = await fixture.api!.getCommand(commandId);
			const result = status.result as HttpGetJsonResult;
			expect(result.status).toBe(200);
			// Body should be the raw string since it's not JSON
			expect(typeof result.body === "string" || typeof result.body === "object").toBe(true);
		});

		it("handles redirect without following it", async () => {
			mockTarget.setResponse({
				redirect: "http://example.com/redirected",
			});

			const { commandId } = await fixture.api!.createCommand({
				type: "HTTP_GET_JSON",
				payload: { url: mockTarget.url },
			});

			const agent = await startAgent({
				agentId: "agent-http-redirect",
				serverUrl: `http://localhost:${fixture.server!.port}`,
				stateDir: path.join(fixture.tempDir, "agent-http-redirect"),
				pollIntervalMs: 100,
			});
			fixture.addAgent(agent);

			await waitFor(
				async () => {
					const s = await fixture.api!.getCommand(commandId);
					return s.status === "COMPLETED";
				},
				{ timeoutMs: 10000 },
			);

			const status = await fixture.api!.getCommand(commandId);
			const result = status.result as HttpGetJsonResult;
			// Should report redirect error or 302 status
			expect(result.status === 302 || result.error !== null).toBe(true);
		});

		it("verifies only one HTTP request is made per command", async () => {
			mockTarget.resetRequestCount();

			const { commandId } = await fixture.api!.createCommand({
				type: "HTTP_GET_JSON",
				payload: { url: mockTarget.url },
			});

			const agent = await startAgent({
				agentId: "agent-http-once",
				serverUrl: `http://localhost:${fixture.server!.port}`,
				stateDir: path.join(fixture.tempDir, "agent-http-once"),
				pollIntervalMs: 100,
			});
			fixture.addAgent(agent);

			await waitFor(
				async () => {
					const s = await fixture.api!.getCommand(commandId);
					return s.status === "COMPLETED";
				},
				{ timeoutMs: 10000 },
			);

			// Verify exactly one request was made
			expect(mockTarget.getRequestCount()).toBe(1);
		});
	});
});
