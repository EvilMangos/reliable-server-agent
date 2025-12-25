/**
 * Shared test utilities for agent tests
 *
 * Provides:
 * - Factory functions for creating test configs and journals
 * - Mock implementations for JournalManager and Logger
 * - Executor factories for delay and http tests
 * - Fetch mock helpers for simulating server responses
 */

import { vi } from "vitest";
import type { AgentJournal, ClaimCommandResponse } from "@reliable-server-agent/shared";
import { COMMAND_TYPE } from "@reliable-server-agent/shared";
import type { AgentConfig, JournalManager, Logger } from "../types";
import { DelayExecutor } from "../executors";

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
		type: COMMAND_TYPE.DELAY,
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
export function createMockJournalManager(journal?: AgentJournal): JournalManager {
	return {
		getJournalPath: vi.fn(() => "/mock/path/agent.json"),
		load: vi.fn(() => journal ?? null),
		save: vi.fn(),
		delete: vi.fn(),
		createClaimed: vi.fn(() => journal ?? createTestJournal()),
		updateStage: vi.fn((j: AgentJournal, stage: string) => {
			j.stage = stage as AgentJournal["stage"];
		}),
		updateHttpSnapshot: vi.fn(),
	};
}

/**
 * Creates a mock Logger for testing.
 * All methods are no-op Vitest mocks that can be inspected.
 */
export function createMockLogger(): Logger {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};
}

// =============================================================================
// Executor Factories
// =============================================================================

/**
 * Options for creating a test DelayExecutor.
 */
export interface DelayExecutorTestOptions {
	onRandomFailure?: () => void;
}

/**
 * Result of creating a test DelayExecutor.
 */
export interface DelayExecutorTestContext {
	executor: DelayExecutor;
	logger: Logger;
	journalManager: JournalManager;
}

/**
 * Creates a DelayExecutor with mock dependencies for testing.
 *
 * @param journal - Optional journal to preload in the mock JournalManager
 * @param options - Optional configuration for onRandomFailure
 * @returns The executor and its mock dependencies for assertions
 */
export function createTestDelayExecutor(
	journal?: AgentJournal,
	options?: DelayExecutorTestOptions,
): DelayExecutorTestContext {
	const logger = createMockLogger();
	const journalManager = createMockJournalManager(journal);
	const executor = new DelayExecutor(logger, journalManager, options?.onRandomFailure);

	return { executor, logger, journalManager };
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

/**
 * Mocks global.fetch to return 409 (Conflict) for `/complete` endpoints.
 * Useful for testing stale lease scenarios.
 *
 * @param claimResponse - Optional claim response for the claim endpoint
 * @returns The mock function for assertions
 */
export function mockFetchWith409OnComplete(
	claimResponse?: ClaimCommandResponse,
): ReturnType<typeof vi.fn> {
	const mockFn = vi.fn().mockImplementation((url: string) => {
		if (url.includes("/claim") && claimResponse) {
			return Promise.resolve({
				status: 200,
				ok: true,
				json: () => Promise.resolve(claimResponse),
			});
		}
		if (url.includes("/complete")) {
			return Promise.resolve({ status: 409, ok: false });
		}
		if (url.includes("/heartbeat")) {
			return Promise.resolve({ status: 204, ok: true });
		}
		return Promise.resolve({ status: 204, ok: true });
	});
	global.fetch = mockFn;
	return mockFn;
}

/**
 * Mocks global.fetch to return a specific HTTP error status for all calls.
 * Useful for testing server error handling.
 *
 * @param status - The HTTP status code to return (e.g., 500, 503)
 * @param statusText - Optional status text (e.g., "Internal Server Error")
 * @returns The mock function for assertions
 */
export function mockFetchWithServerError(
	status: number,
	statusText = "Error",
): ReturnType<typeof vi.fn> {
	const mockFn = vi.fn().mockResolvedValue({
		status,
		ok: false,
		statusText,
	});
	global.fetch = mockFn;
	return mockFn;
}

/**
 * Mocks global.fetch to reject with a network error.
 * Useful for testing network failure handling.
 *
 * @param errorMessage - The error message for the rejection
 * @returns The mock function for assertions
 */
export function mockFetchWithNetworkError(
	errorMessage = "Network error",
): ReturnType<typeof vi.fn> {
	const mockFn = vi.fn().mockRejectedValue(new Error(errorMessage));
	global.fetch = mockFn;
	return mockFn;
}

/**
 * Result type for call tracking mock
 */
export interface CallTrackingResult {
	fetchMock: ReturnType<typeof vi.fn>;
	getHeartbeatCalls: () => number[];
	getCompleteCalls: () => number[];
	getCallOrder: () => number;
}

/**
 * Executes a function with Math.random mocked to return a specific value.
 * Automatically restores the original Math.random after execution.
 *
 * @param value - The value that Math.random should return (0-1)
 * @param fn - The async function to execute with mocked random
 */
export async function withMockedRandom(value: number, fn: () => Promise<void>): Promise<void> {
	const originalRandom = Math.random;
	Math.random = () => value;
	try {
		await fn();
	} finally {
		Math.random = originalRandom;
	}
}

/**
 * Mocks global.fetch with call order tracking.
 * Tracks the order in which heartbeat and complete endpoints are called.
 * Useful for verifying heartbeat stops before completion.
 *
 * @param claimResponse - The response to return when claim endpoint is called
 * @returns Object with mock function and call tracking getters
 */
export function mockFetchWithCallTracking(
	claimResponse: ClaimCommandResponse,
): CallTrackingResult {
	const heartbeatCalls: number[] = [];
	const completeCalls: number[] = [];
	let callOrder = 0;

	const mockFn = vi.fn().mockImplementation((url: string) => {
		callOrder++;
		if (url.includes("/claim")) {
			return Promise.resolve({
				status: 200,
				ok: true,
				json: () => Promise.resolve(claimResponse),
			});
		}
		if (url.includes("/heartbeat")) {
			heartbeatCalls.push(callOrder);
			return Promise.resolve({ status: 204, ok: true });
		}
		if (url.includes("/complete")) {
			completeCalls.push(callOrder);
			return Promise.resolve({ status: 204, ok: true });
		}
		return Promise.resolve({ status: 204, ok: true });
	});
	global.fetch = mockFn;

	return {
		fetchMock: mockFn,
		getHeartbeatCalls: () => heartbeatCalls,
		getCompleteCalls: () => completeCalls,
		getCallOrder: () => callOrder,
	};
}
