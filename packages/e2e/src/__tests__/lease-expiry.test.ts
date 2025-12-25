/**
 * E2E Tests for Lease Expiry and Retry
 *
 * Tests verify that expired leases trigger proper recovery:
 * - RUNNING commands with expired leases become PENDING on server restart
 * - Expired commands can be claimed by new agents
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createApiClient,
	createTestFixture,
	sleep,
	startServer,
} from "../helpers/index.js";

describe("E2E: Lease Expiry and Retry", () => {
	const fixture = createTestFixture("lease-expiry");

	beforeAll(() => fixture.setup());
	afterAll(() => fixture.teardown());

	it("expired RUNNING command becomes PENDING and can be claimed again", async () => {
		// Use unique database for this test
		const testDbPath = fixture.createUniqueDbPath();

		let server = await startServer({ tempDir: fixture.tempDir, dbPath: testDbPath });
		let api = createApiClient(`http://localhost:${server.port}`);

		// Create command
		const { commandId } = await api.createCommand({
			type: "DELAY",
			payload: { ms: 1000 },
		});

		// Claim with short lease
		const claim1 = await api.claimCommand({
			agentId: "agent-expire-1",
			maxLeaseMs: 100,
		});
		expect(claim1).not.toBeNull();
		expect(claim1!.commandId).toBe(commandId);

		// Verify RUNNING
		let status = await api.getCommand(commandId);
		expect(status.status).toBe("RUNNING");

		// Wait for lease to expire
		await sleep(200);

		// Try to claim again - should work because lease expired
		// Note: The server needs to reset expired leases. This typically happens on startup
		// or when the server checks during claim. Let's restart the server to trigger recovery.

		await server.stop();
		server = await startServer({ tempDir: fixture.tempDir, dbPath: testDbPath });
		api = createApiClient(`http://localhost:${server.port}`);

		// Now command should be PENDING
		status = await api.getCommand(commandId);
		expect(status.status).toBe("PENDING");

		// New claim should succeed
		const claim2 = await api.claimCommand({
			agentId: "agent-expire-2",
			maxLeaseMs: 30000,
		});
		expect(claim2).not.toBeNull();
		expect(claim2!.commandId).toBe(commandId);

		await server.stop();
	});
});
