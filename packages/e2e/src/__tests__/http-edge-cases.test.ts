/**
 * E2E Tests for HTTP_GET_JSON Edge Cases
 *
 * Tests verify handling of various edge cases:
 * - Large responses and truncation (10,240 chars limit)
 * - Various HTTP status codes (4xx, 5xx)
 * - Invalid URLs and unreachable hosts
 * - Empty responses
 * - Non-JSON content types
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

describe("E2E: HTTP_GET_JSON Edge Cases", () => {
	const fixture = createTestFixture("http-edge-cases");
	let mockTarget: MockTargetServer;

	beforeAll(() => fixture.setup());
	afterAll(() => fixture.teardown());

	beforeEach(async () => {
		await fixture.setupTest();
		mockTarget = await createMockTarget({
			status: 200,
			body: { default: true },
		});
	});

	afterEach(async () => {
		await mockTarget.close();
		await fixture.teardownTest();
	});

	describe("Response Truncation", () => {
		it("truncates response body at 10,240 characters and sets truncated flag", async () => {
			// Create a large response that exceeds 10,240 chars
			const largeData = "x".repeat(15000);
			mockTarget.setResponse({
				status: 200,
				body: { data: largeData },
			});

			const { commandId } = await fixture.api!.createCommand({
				type: "HTTP_GET_JSON",
				payload: { url: mockTarget.url },
			});

			const agent = await startAgent({
				agentId: "agent-truncation",
				serverUrl: `http://localhost:${fixture.server!.port}`,
				stateDir: path.join(fixture.tempDir, "agent-truncation"),
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
			expect(status.status).toBe("COMPLETED");

			const result = status.result as HttpGetJsonResult;
			expect(result.status).toBe(200);
			expect(result.truncated).toBe(true);
			expect(result.bytesReturned).toBeLessThanOrEqual(10240);
		});

		it("does not truncate small responses and sets truncated false", async () => {
			mockTarget.setResponse({
				status: 200,
				body: { small: "data" },
			});

			const { commandId } = await fixture.api!.createCommand({
				type: "HTTP_GET_JSON",
				payload: { url: mockTarget.url },
			});

			const agent = await startAgent({
				agentId: "agent-small-response",
				serverUrl: `http://localhost:${fixture.server!.port}`,
				stateDir: path.join(fixture.tempDir, "agent-small-response"),
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
			expect(result.truncated).toBe(false);
		});
	});

	describe("HTTP Status Codes", () => {
		it("handles 404 Not Found response", async () => {
			mockTarget.setResponse({
				status: 404,
				body: { error: "Not Found" },
			});

			const { commandId } = await fixture.api!.createCommand({
				type: "HTTP_GET_JSON",
				payload: { url: mockTarget.url },
			});

			const agent = await startAgent({
				agentId: "agent-404",
				serverUrl: `http://localhost:${fixture.server!.port}`,
				stateDir: path.join(fixture.tempDir, "agent-404"),
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
			expect(status.status).toBe("COMPLETED");

			const result = status.result as HttpGetJsonResult;
			expect(result.status).toBe(404);
			expect(result.error).toBeNull(); // No error - this is a valid response
		});

		it("handles 500 Internal Server Error response", async () => {
			mockTarget.setResponse({
				status: 500,
				body: { error: "Internal Server Error" },
			});

			const { commandId } = await fixture.api!.createCommand({
				type: "HTTP_GET_JSON",
				payload: { url: mockTarget.url },
			});

			const agent = await startAgent({
				agentId: "agent-500",
				serverUrl: `http://localhost:${fixture.server!.port}`,
				stateDir: path.join(fixture.tempDir, "agent-500"),
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
			expect(status.status).toBe("COMPLETED");

			const result = status.result as HttpGetJsonResult;
			expect(result.status).toBe(500);
		});

		it("handles 503 Service Unavailable response", async () => {
			mockTarget.setResponse({
				status: 503,
				body: { error: "Service Unavailable" },
			});

			const { commandId } = await fixture.api!.createCommand({
				type: "HTTP_GET_JSON",
				payload: { url: mockTarget.url },
			});

			const agent = await startAgent({
				agentId: "agent-503",
				serverUrl: `http://localhost:${fixture.server!.port}`,
				stateDir: path.join(fixture.tempDir, "agent-503"),
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
			expect(result.status).toBe(503);
		});
	});

	describe("Invalid URLs", () => {
		it("handles unreachable host gracefully", async () => {
			// Use a non-routable IP to ensure connection failure
			const { commandId } = await fixture.api!.createCommand({
				type: "HTTP_GET_JSON",
				payload: { url: "http://192.0.2.1:12345/unreachable" },
			});

			const agent = await startAgent({
				agentId: "agent-unreachable",
				serverUrl: `http://localhost:${fixture.server!.port}`,
				stateDir: path.join(fixture.tempDir, "agent-unreachable"),
				pollIntervalMs: 100,
				maxLeaseMs: 60000, // Long lease for potential timeout
			});
			fixture.addAgent(agent);

			await waitFor(
				async () => {
					const s = await fixture.api!.getCommand(commandId);
					return s.status === "COMPLETED" || s.status === "FAILED";
				},
				{ timeoutMs: 45000 }, // May take time due to connection timeout
			);

			const status = await fixture.api!.getCommand(commandId);
			// Should complete (not fail) with error in result
			expect(["COMPLETED", "FAILED"]).toContain(status.status);

			if (status.status === "COMPLETED") {
				const result = status.result as HttpGetJsonResult;
				expect(result.error).not.toBeNull();
			}
		}, 50000);

		it("handles invalid URL format", async () => {
			const { commandId } = await fixture.api!.createCommand({
				type: "HTTP_GET_JSON",
				payload: { url: "not-a-valid-url" },
			});

			const agent = await startAgent({
				agentId: "agent-invalid-url",
				serverUrl: `http://localhost:${fixture.server!.port}`,
				stateDir: path.join(fixture.tempDir, "agent-invalid-url"),
				pollIntervalMs: 100,
			});
			fixture.addAgent(agent);

			await waitFor(
				async () => {
					const s = await fixture.api!.getCommand(commandId);
					return s.status === "COMPLETED" || s.status === "FAILED";
				},
				{ timeoutMs: 10000 },
			);

			const status = await fixture.api!.getCommand(commandId);
			expect(["COMPLETED", "FAILED"]).toContain(status.status);

			if (status.status === "COMPLETED") {
				const result = status.result as HttpGetJsonResult;
				expect(result.error).not.toBeNull();
			}
		});
	});

	describe("Response Content Types", () => {
		it("handles empty response body", async () => {
			mockTarget.setResponse({
				status: 204,
				body: undefined,
			});

			const { commandId } = await fixture.api!.createCommand({
				type: "HTTP_GET_JSON",
				payload: { url: mockTarget.url },
			});

			const agent = await startAgent({
				agentId: "agent-empty-body",
				serverUrl: `http://localhost:${fixture.server!.port}`,
				stateDir: path.join(fixture.tempDir, "agent-empty-body"),
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
			expect(status.status).toBe("COMPLETED");

			const result = status.result as HttpGetJsonResult;
			expect(result.status).toBe(204);
		});

		it("handles HTML response as string body", async () => {
			const htmlContent = "<html><body><h1>Hello</h1></body></html>";
			mockTarget.setResponse({
				status: 200,
				body: htmlContent,
				headers: { "Content-Type": "text/html" },
			});

			const { commandId } = await fixture.api!.createCommand({
				type: "HTTP_GET_JSON",
				payload: { url: mockTarget.url },
			});

			const agent = await startAgent({
				agentId: "agent-html",
				serverUrl: `http://localhost:${fixture.server!.port}`,
				stateDir: path.join(fixture.tempDir, "agent-html"),
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
			expect(status.status).toBe("COMPLETED");

			const result = status.result as HttpGetJsonResult;
			expect(result.status).toBe(200);
			// Body should be the raw HTML string since it's not valid JSON
			expect(typeof result.body).toBe("string");
		});

		it("handles malformed JSON in response body", async () => {
			// Set body as a string that looks like JSON but is malformed
			mockTarget.setResponse({
				status: 200,
				body: '{"invalid": json}',
				headers: { "Content-Type": "application/json" },
			});

			const { commandId } = await fixture.api!.createCommand({
				type: "HTTP_GET_JSON",
				payload: { url: mockTarget.url },
			});

			const agent = await startAgent({
				agentId: "agent-malformed-json",
				serverUrl: `http://localhost:${fixture.server!.port}`,
				stateDir: path.join(fixture.tempDir, "agent-malformed-json"),
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
			expect(status.status).toBe("COMPLETED");

			const result = status.result as HttpGetJsonResult;
			// Should return raw string body when JSON parsing fails
			expect(typeof result.body === "string" || result.error !== null).toBe(true);
		});
	});

	describe("Redirect Handling", () => {
		it("does not follow redirects and reports redirect error", async () => {
			mockTarget.setResponse({
				redirect: "http://example.com/redirected",
			});

			const { commandId } = await fixture.api!.createCommand({
				type: "HTTP_GET_JSON",
				payload: { url: mockTarget.url },
			});

			const agent = await startAgent({
				agentId: "agent-redirect",
				serverUrl: `http://localhost:${fixture.server!.port}`,
				stateDir: path.join(fixture.tempDir, "agent-redirect"),
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
			expect(status.status).toBe("COMPLETED");

			const result = status.result as HttpGetJsonResult;
			// Should report 302 status or error about redirects not followed
			expect(result.status === 302 || result.error !== null).toBe(true);
			if (result.error !== null) {
				expect(result.error.toLowerCase()).toContain("redirect");
			}
		});
	});
});
