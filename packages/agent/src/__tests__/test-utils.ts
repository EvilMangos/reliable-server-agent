/**
 * Shared test utilities for agent tests
 *
 * Provides:
 * - Factory functions for creating test configs and journals
 * - Mock implementations for JournalManager
 * - Fetch mock helpers for simulating server responses
 */

import { vi } from "vitest";
import type { AgentJournal, ClaimCommandResponse } from "@reliable-server-agent/shared";
import type { AgentConfig } from "../config.js";
import type { JournalManager } from "../journal.js";

/**
 * Creates a default AgentConfig with sensible test defaults.
 * All values can be overridden via the overrides parameter.
 */
export function createDefaultAgentConfig(
	tempDir: string,
	overrides?: Partial<AgentConfig>,
): AgentConfig {
	return {
		agentId: "test-agent",
		serverUrl: "http://test:3000",
		stateDir: tempDir,
		maxLeaseMs: 30000,
		heartbeatIntervalMs: 10000,
		pollIntervalMs: 1000,
		killAfterSeconds: null,
		randomFailures: false,
		...overrides,
	};
}

/**
 * Creates a test AgentJournal with sensible defaults.
 * Useful for testing journal-related functionality.
 */
export function createTestJournal(
	overrides?: Partial<AgentJournal>,
): AgentJournal {
	return {
		commandId: "cmd-123",
		leaseId: "lease-456",
		type: "DELAY",
		startedAt: Date.now(),
		scheduledEndAt: Date.now() + 5000,
		httpSnapshot: null,
		stage: "CLAIMED",
		...overrides,
	};
}

/**
 * Creates a mock JournalManager for testing.
 * All methods are Vitest mocks that can be inspected.
 */
export function createMockJournalManager(journal: AgentJournal): JournalManager {
	return {
		getJournalPath: vi.fn(() => "/mock/path/agent.json"),
		load: vi.fn(() => journal),
		save: vi.fn(),
		delete: vi.fn(),
		createClaimed: vi.fn(() => journal),
		updateStage: vi.fn((j: AgentJournal, stage: string) => {
			j.stage = stage as AgentJournal["stage"];
		}),
		updateHttpSnapshot: vi.fn(),
	};
}

// =============================================================================
// Fetch Mock Helpers
// =============================================================================

/**
 * Mocks global.fetch to return 204 for all calls.
 * Simulates the "no work available" scenario where claim returns 204.
 *
 * @returns The mock function for assertions
 */
export function mockFetchNoWork(): ReturnType<typeof vi.fn> {
	const mockFn = vi.fn().mockResolvedValue({
		status: 204,
		ok: true,
	});
	global.fetch = mockFn;
	return mockFn;
}

/**
 * Mocks global.fetch to handle standard agent-server interactions:
 * - Returns 200 with claimResponse for `/claim` endpoints
 * - Returns 204 for `/complete` endpoints
 * - Returns 204 for `/heartbeat` endpoints
 *
 * @param claimResponse - The response to return when claim endpoint is called
 * @returns The mock function for assertions
 */
export function mockFetchWithClaim(
	claimResponse: ClaimCommandResponse,
): ReturnType<typeof vi.fn> {
	const mockFn = vi.fn().mockImplementation((url: string) => {
		if (url.includes("/claim")) {
			return Promise.resolve({
				status: 200,
				ok: true,
				json: () => Promise.resolve(claimResponse),
			});
		}
		if (url.includes("/complete")) {
			return Promise.resolve({
				status: 204,
				ok: true,
			});
		}
		if (url.includes("/heartbeat")) {
			return Promise.resolve({
				status: 204,
				ok: true,
			});
		}
		// Default: return 204 for unknown endpoints
		return Promise.resolve({
			status: 204,
			ok: true,
		});
	});
	global.fetch = mockFn;
	return mockFn;
}
