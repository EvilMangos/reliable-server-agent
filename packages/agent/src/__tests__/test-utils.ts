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
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentJournal, ClaimCommandResponse } from "@reliable-server-agent/shared";
import { COMMAND_TYPE } from "@reliable-server-agent/shared";
import type { AgentConfig, JournalManager, Logger } from "../types/index.js";
import { DelayExecutor, HttpGetJsonExecutor } from "../executors/index.js";

// =============================================================================
// Temp Directory Management
// =============================================================================

/**
 * Creates a temporary directory for test isolation.
 *
 * @param prefix - Optional prefix for the temp directory name (default: "agent-test-")
 * @returns The absolute path to the created temp directory
 */
export function createTempDir(prefix = "agent-test-"): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Cleans up a temporary directory created during tests.
 * Silently ignores errors if the directory doesn't exist or can't be removed.
 *
 * @param dirPath - The absolute path to the temp directory to remove
 */
export function cleanupTempDir(dirPath: string): void {
	try {
		fs.rmSync(dirPath, { recursive: true, force: true });
	} catch {
		// Ignore cleanup errors
	}
}

// =============================================================================
// Fetch Mock Context
// =============================================================================

/**
 * Context for managing fetch mock state.
 * Stores the original fetch function and provides restore capability.
 */
export interface FetchMockContext {
	/** The original global.fetch function before mocking */
	originalFetch: typeof global.fetch;
	/** Restores the original fetch function */
	restore: () => void;
}

/**
 * Captures the current global.fetch and returns a context for restoration.
 * Call this in beforeEach to save the original fetch before mocking.
 *
 * @returns FetchMockContext with restore function
 */
export function captureFetchContext(): FetchMockContext {
	const originalFetch = global.fetch;
	return {
		originalFetch,
		restore: () => {
			global.fetch = originalFetch;
		},
	};
}

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
 * Result of writing a journal file to disk.
 */
export interface WriteJournalFileResult {
	/** The absolute path to the journal file */
	journalPath: string;
	/** The journal object that was written */
	journal: AgentJournal;
}

/**
 * Creates a journal file on disk for testing recovery scenarios.
 * Uses the standard naming convention: {agentId}.json in the temp directory.
 *
 * @param tempDir - The temp directory to write the journal to
 * @param agentId - The agent ID (used for file naming)
 * @param journalOverrides - Optional overrides for the journal contents
 * @returns The path to the created journal file and the journal object
 */
export function writeJournalFile(
	tempDir: string,
	agentId: string,
	journalOverrides?: Partial<AgentJournal>,
): WriteJournalFileResult {
	const journalPath = path.join(tempDir, `${agentId}.json`);
	const journal = createTestJournal(journalOverrides);
	fs.writeFileSync(journalPath, JSON.stringify(journal));
	return { journalPath, journal };
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

/**
 * Options for creating a test HttpGetJsonExecutor.
 */
export interface HttpExecutorTestOptions {
	onRandomFailure?: () => void;
}

/**
 * Result of creating a test HttpGetJsonExecutor.
 */
export interface HttpExecutorTestContext {
	executor: HttpGetJsonExecutor;
	logger: Logger;
	journalManager: JournalManager;
}

/**
 * Creates an HttpGetJsonExecutor with mock dependencies for testing.
 *
 * @param journal - Optional journal to preload in the mock JournalManager
 * @param options - Optional configuration for onRandomFailure
 * @returns The executor and its mock dependencies for assertions
 */
export function createTestHttpExecutor(
	journal?: AgentJournal,
	options?: HttpExecutorTestOptions,
): HttpExecutorTestContext {
	const logger = createMockLogger();
	const journalManager = createMockJournalManager(journal);
	const executor = new HttpGetJsonExecutor(logger, journalManager, options?.onRandomFailure);

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

/**
 * Result type for body-capturing fetch mock
 */
export interface BodyCaptureResult {
	fetchMock: ReturnType<typeof vi.fn>;
	/** Gets the parsed body from the complete endpoint call, or null if not called */
	getCompleteBody: () => Record<string, unknown> | null;
	/** Gets the commandId extracted from the complete URL, or null if not called */
	getCompleteCommandId: () => string | null;
}

/**
 * Mocks global.fetch with body capturing for /complete endpoint.
 * Useful for verifying the result structure sent to the server.
 *
 * @param claimResponse - The response to return when claim endpoint is called
 * @returns Object with mock function and body capture getters
 */
export function mockFetchWithClaimAndCapture(
	claimResponse: ClaimCommandResponse,
): BodyCaptureResult {
	let completeBody: Record<string, unknown> | null = null;
	let completeCommandId: string | null = null;

	const mockFn = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
		if (url.includes("/claim")) {
			return Promise.resolve({
				status: 200,
				ok: true,
				json: () => Promise.resolve(claimResponse),
			});
		}
		if (url.includes("/complete")) {
			completeBody = JSON.parse(options?.body as string);
			completeCommandId = url.match(/commands\/([^/]+)\/complete/)?.[1] || null;
			return Promise.resolve({ status: 204, ok: true });
		}
		if (url.includes("/heartbeat")) {
			return Promise.resolve({ status: 204, ok: true });
		}
		return Promise.resolve({ status: 204, ok: true });
	});
	global.fetch = mockFn;

	return {
		fetchMock: mockFn,
		getCompleteBody: () => completeBody,
		getCompleteCommandId: () => completeCommandId,
	};
}

// =============================================================================
// Config Test Helpers
// =============================================================================

/**
 * Loads the config module and calls loadConfig with the provided args.
 * Note: Caller should call vi.resetModules() in beforeEach to ensure
 * fresh module state for each test.
 *
 * @param args - CLI arguments to pass to loadConfig
 * @returns The loaded AgentConfig
 */
export async function loadConfigFresh(args: string[]): Promise<AgentConfig> {
	const { loadConfig } = await import("../config/index.js");
	return loadConfig(args);
}

// =============================================================================
// DI Test Helpers
// =============================================================================

/** Counter for generating unique token names */
let tokenCounter = 0;

/**
 * Creates a unique token name by appending an incrementing counter.
 * Useful for DI tests where each test needs isolated tokens to avoid
 * conflicts from Symbol.for sharing.
 *
 * @param baseName - The base name for the token
 * @returns A unique token name string
 */
export function createUniqueTokenName(baseName: string): string {
	tokenCounter++;
	return `${baseName}-${tokenCounter}`;
}

// =============================================================================
// Timer Helpers
// =============================================================================

/**
 * Sets up Vitest fake timers.
 * Call this in beforeEach for tests that need time control.
 */
export function setupFakeTimers(): void {
	vi.useFakeTimers();
}

/**
 * Tears down Vitest fake timers and restores all mocks.
 * Call this in afterEach for tests that use setupFakeTimers.
 */
export function teardownFakeTimers(): void {
	vi.useRealTimers();
	vi.restoreAllMocks();
}
