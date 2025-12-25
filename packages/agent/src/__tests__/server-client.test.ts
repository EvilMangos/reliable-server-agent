/**
 * Tests for ServerClientImpl
 *
 * Covers:
 * - Claim endpoint behavior
 * - Heartbeat endpoint behavior
 * - Complete endpoint behavior
 * - Fail endpoint behavior (including 409 handling)
 * - Network error handling
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMAND_TYPE } from "@reliable-server-agent/shared";
import {
	type FetchMockContext,
	captureFetchContext,
	cleanupTempDir,
	createDefaultAgentConfig,
	createMockLogger,
	createTempDir,
} from "./test-utils";
import { ServerClientImpl } from "../server-client";

describe("ServerClientImpl", () => {
	let fetchContext: FetchMockContext;
	let tempDir: string;

	beforeEach(() => {
		fetchContext = captureFetchContext();
		tempDir = createTempDir("server-client-test-");
	});

	afterEach(() => {
		fetchContext.restore();
		vi.restoreAllMocks();
		cleanupTempDir(tempDir);
	});

	function createServerClient(configOverrides?: Parameters<typeof createDefaultAgentConfig>[1]) {
		const config = createDefaultAgentConfig(tempDir, configOverrides);
		const logger = createMockLogger();
		return new ServerClientImpl(config, logger);
	}

	describe("fail endpoint", () => {
		it("calls /fail endpoint with correct request body", async () => {
			const client = createServerClient({ agentId: "fail-agent" });

			let capturedBody: Record<string, unknown> | null = null;
			let capturedUrl: string | null = null;

			global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
				capturedUrl = url;
				capturedBody = JSON.parse(options?.body as string);
				return Promise.resolve({ status: 204, ok: true });
			});

			const success = await client.fail("cmd-123", "lease-456", "Execution error");

			expect(success).toBe(true);
			expect(capturedUrl).toContain("/commands/cmd-123/fail");
			expect(capturedBody).toEqual({
				agentId: "fail-agent",
				leaseId: "lease-456",
				error: "Execution error",
				result: undefined,
			});
		});

		it("includes result in request body when provided", async () => {
			const client = createServerClient({ agentId: "fail-agent-result" });

			let capturedBody: Record<string, unknown> | null = null;

			global.fetch = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
				capturedBody = JSON.parse(options?.body as string);
				return Promise.resolve({ status: 204, ok: true });
			});

			const partialResult = { status: 500, body: null, truncated: false, bytesReturned: 0, error: "Server error" };
			const success = await client.fail("cmd-with-result", "lease-789", "Partial failure", partialResult);

			expect(success).toBe(true);
			expect(capturedBody?.result).toEqual(partialResult);
		});

		it("returns true when server responds with 204", async () => {
			const client = createServerClient();

			global.fetch = vi.fn().mockResolvedValue({ status: 204, ok: true });

			const success = await client.fail("cmd-success", "lease-success", "Error message");

			expect(success).toBe(true);
		});

		it("returns false when server responds with 409 (stale lease)", async () => {
			const client = createServerClient();

			global.fetch = vi.fn().mockResolvedValue({ status: 409, ok: false });

			const success = await client.fail("cmd-stale", "lease-stale", "Error message");

			expect(success).toBe(false);
		});

		it("returns false for non-204/409 status codes", async () => {
			const client = createServerClient();

			global.fetch = vi.fn().mockResolvedValue({ status: 500, ok: false });

			const success = await client.fail("cmd-error", "lease-error", "Error message");

			expect(success).toBe(false);
		});

		it("returns false and does not throw on network error", async () => {
			const client = createServerClient();

			global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

			const success = await client.fail("cmd-network", "lease-network", "Error message");

			expect(success).toBe(false);
		});
	});

	describe("claim endpoint", () => {
		it("calls /claim endpoint with correct request body", async () => {
			const client = createServerClient({
				agentId: "claim-agent",
				maxLeaseMs: 45000,
			});

			let capturedBody: Record<string, unknown> | null = null;

			global.fetch = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
				capturedBody = JSON.parse(options?.body as string);
				return Promise.resolve({ status: 204, ok: true });
			});

			await client.claim();

			expect(capturedBody).toEqual({
				agentId: "claim-agent",
				maxLeaseMs: 45000,
			});
		});

		it("returns null when server responds with 204 (no work)", async () => {
			const client = createServerClient();

			global.fetch = vi.fn().mockResolvedValue({ status: 204, ok: true });

			const result = await client.claim();

			expect(result).toBeNull();
		});

		it("returns command data when server responds with 200", async () => {
			const client = createServerClient();

			const claimResponse = {
				commandId: "cmd-claimed",
				type: COMMAND_TYPE.DELAY,
				payload: { ms: 5000 },
				leaseId: "lease-claimed",
				leaseExpiresAt: Date.now() + 30000,
				startedAt: Date.now(),
				scheduledEndAt: Date.now() + 5000,
			};

			global.fetch = vi.fn().mockResolvedValue({
				status: 200,
				ok: true,
				json: () => Promise.resolve(claimResponse),
			});

			const result = await client.claim();

			expect(result).toEqual(claimResponse);
		});

		it("returns null on network error", async () => {
			const client = createServerClient();

			global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

			const result = await client.claim();

			expect(result).toBeNull();
		});
	});

	describe("heartbeat endpoint", () => {
		it("calls /heartbeat endpoint with correct request body", async () => {
			const client = createServerClient({
				agentId: "hb-agent",
				heartbeatIntervalMs: 10000,
			});

			let capturedBody: Record<string, unknown> | null = null;
			let capturedUrl: string | null = null;

			global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
				capturedUrl = url;
				capturedBody = JSON.parse(options?.body as string);
				return Promise.resolve({ status: 204, ok: true });
			});

			await client.heartbeat("cmd-hb", "lease-hb");

			expect(capturedUrl).toContain("/commands/cmd-hb/heartbeat");
			expect(capturedBody).toEqual({
				agentId: "hb-agent",
				leaseId: "lease-hb",
				extendMs: 30000, // 10000 * 3 (HEARTBEAT_TO_LEASE_MULTIPLIER)
			});
		});

		it("returns true when server responds with 204", async () => {
			const client = createServerClient();

			global.fetch = vi.fn().mockResolvedValue({ status: 204, ok: true });

			const success = await client.heartbeat("cmd-success", "lease-success");

			expect(success).toBe(true);
		});

		it("returns false when server responds with 409", async () => {
			const client = createServerClient();

			global.fetch = vi.fn().mockResolvedValue({ status: 409, ok: false });

			const success = await client.heartbeat("cmd-expired", "lease-expired");

			expect(success).toBe(false);
		});

		it("returns false on network error", async () => {
			const client = createServerClient();

			global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

			const success = await client.heartbeat("cmd-net", "lease-net");

			expect(success).toBe(false);
		});
	});

	describe("complete endpoint", () => {
		it("calls /complete endpoint with correct request body", async () => {
			const client = createServerClient({ agentId: "complete-agent" });

			let capturedBody: Record<string, unknown> | null = null;
			let capturedUrl: string | null = null;

			global.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
				capturedUrl = url;
				capturedBody = JSON.parse(options?.body as string);
				return Promise.resolve({ status: 204, ok: true });
			});

			const result = { ok: true, tookMs: 5000 };
			await client.complete("cmd-complete", "lease-complete", result);

			expect(capturedUrl).toContain("/commands/cmd-complete/complete");
			expect(capturedBody).toEqual({
				agentId: "complete-agent",
				leaseId: "lease-complete",
				result: { ok: true, tookMs: 5000 },
			});
		});

		it("returns true when server responds with 204", async () => {
			const client = createServerClient();

			global.fetch = vi.fn().mockResolvedValue({ status: 204, ok: true });

			const success = await client.complete("cmd-ok", "lease-ok", { ok: true, tookMs: 1000 });

			expect(success).toBe(true);
		});

		it("returns false when server responds with 409", async () => {
			const client = createServerClient();

			global.fetch = vi.fn().mockResolvedValue({ status: 409, ok: false });

			const success = await client.complete("cmd-stale", "lease-stale", { ok: true, tookMs: 1000 });

			expect(success).toBe(false);
		});

		it("returns false on network error", async () => {
			const client = createServerClient();

			global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

			const success = await client.complete("cmd-net", "lease-net", { ok: true, tookMs: 1000 });

			expect(success).toBe(false);
		});
	});
});
