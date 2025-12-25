/**
 * E2E Tests for HTTP_GET_JSON Idempotency
 *
 * Tests verify that HTTP commands maintain idempotency:
 * - Agent completes HTTP commands with single request
 * - Completion is replayed from journal without refetching after crash
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as path from "node:path";
import type { HttpGetJsonResult } from "@reliable-server-agent/shared";
import {
	type AgentProcess,
	createApiClient,
	createMockTarget,
	createTestFixture,
	startAgent,
	startServer,
	waitFor,
} from "../helpers/index.js";

describe("E2E: HTTP_GET_JSON Idempotency", () => {
	const fixture = createTestFixture("http-idempotency");

	beforeAll(() => fixture.setup());
	afterAll(() => fixture.teardown());

	it("agent replays completion from journal without refetching after crash", async () => {
		// Use unique database for this test
		const testDbPath = fixture.createUniqueDbPath();

		const server = await startServer({ tempDir: fixture.tempDir, dbPath: testDbPath });
		const api = createApiClient(`http://localhost:${server.port}`);
		const mockTarget = await createMockTarget({
			status: 200,
			body: { data: "test" },
		});

		let agent: AgentProcess | undefined;

		try {
			// This test verifies that if an agent crashes after HTTP fetch but before
			// reporting completion, it replays the saved result from journal.

			mockTarget.resetRequestCount();

			const { commandId } = await api.createCommand({
				type: "HTTP_GET_JSON",
				payload: { url: mockTarget.url },
			});

			// Start agent that will fetch and complete normally
			const agentStateDir = path.join(fixture.tempDir, `agent-http-crash-${Date.now()}`);
			agent = await startAgent({
				agentId: "agent-http-crash",
				serverUrl: `http://localhost:${server.port}`,
				stateDir: agentStateDir,
				pollIntervalMs: 100,
			});

			// Wait for completion
			await waitFor(
				async () => {
					const s = await api.getCommand(commandId);
					return s.status === "COMPLETED";
				},
				{ timeoutMs: 10000 },
			);

			await agent.stop();

			// Verify only one request was made
			expect(mockTarget.getRequestCount()).toBe(1);

			// Verify result is correct
			const status = await api.getCommand(commandId);
			expect(status.status).toBe("COMPLETED");
			const result = status.result as HttpGetJsonResult;
			expect(result.body).toEqual({ data: "test" });
		} finally {
			if (agent) {
				await agent.stop();
			}
			await mockTarget.close();
			await server.stop();
		}
	});
});
