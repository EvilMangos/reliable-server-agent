/**
 * E2E Test Fixture
 *
 * Factory function that encapsulates common test setup/teardown patterns.
 * Provides a consistent way to manage server, agents, and temp directories
 * across E2E test suites.
 *
 * Usage:
 *   const fixture = createTestFixture("my-test-suite");
 *
 *   beforeAll(() => fixture.setup());
 *   afterAll(() => fixture.teardown());
 *   beforeEach(async () => fixture.setupTest());
 *   afterEach(async () => fixture.teardownTest());
 */

import * as path from "node:path";
import {
	type AgentProcess,
	type ServerProcess,
	cleanupTempDir,
	createTempDir,
	startServer,
} from "./process-manager.js";
import { type ApiClient, createApiClient } from "./api-client.js";

/**
 * Test fixture state and methods for managing E2E test lifecycle
 */
export interface TestFixture {
	/** The temporary directory for this test suite */
	readonly tempDir: string;

	/** The current server process (null until setupTest is called) */
	server: ServerProcess | null;

	/** The current API client (null until setupTest is called) */
	api: ApiClient | null;

	/** Tracked agent processes for cleanup */
	readonly agents: AgentProcess[];

	/** The current test's database path (null until setupTest is called) */
	dbPath: string | null;

	/**
	 * Setup the test suite (call in beforeAll).
	 * Creates the temporary directory.
	 */
	setup(): void;

	/**
	 * Teardown the test suite (call in afterAll).
	 * Cleans up the temporary directory.
	 */
	teardown(): void;

	/**
	 * Setup a single test (call in beforeEach).
	 * Starts the server with a unique database and creates an API client.
	 */
	setupTest(): Promise<void>;

	/**
	 * Teardown a single test (call in afterEach).
	 * Stops all tracked agents and the server.
	 */
	teardownTest(): Promise<void>;

	/**
	 * Add an agent to the tracking list for automatic cleanup.
	 * @param agent The agent process to track
	 */
	addAgent(agent: AgentProcess): void;

	/**
	 * Generate a unique database path for test isolation.
	 * @returns Absolute path to a unique SQLite database file
	 */
	createUniqueDbPath(): string;
}

/**
 * Creates a test fixture for E2E tests.
 *
 * The fixture manages:
 * - Temporary directory creation and cleanup
 * - Server process lifecycle
 * - API client creation
 * - Agent process tracking and cleanup
 *
 * @param prefix - Prefix for the temp directory name (e.g., "basic-flow")
 * @returns A test fixture with setup/teardown methods
 *
 * @example
 * ```typescript
 * describe("E2E: My Test Suite", () => {
 *   const fixture = createTestFixture("my-suite");
 *
 *   beforeAll(() => fixture.setup());
 *   afterAll(() => fixture.teardown());
 *   beforeEach(async () => fixture.setupTest());
 *   afterEach(async () => fixture.teardownTest());
 *
 *   it("does something", async () => {
 *     const { commandId } = await fixture.api!.createCommand({
 *       type: "DELAY",
 *       payload: { ms: 100 },
 *     });
 *
 *     const agent = await startAgent({
 *       agentId: "test-agent",
 *       serverUrl: `http://localhost:${fixture.server!.port}`,
 *       stateDir: path.join(fixture.tempDir, "test-agent"),
 *       pollIntervalMs: 100,
 *     });
 *     fixture.addAgent(agent);
 *
 *     // ... test assertions
 *   });
 * });
 * ```
 */
export function createTestFixture(prefix: string): TestFixture {
	let tempDir = "";
	let server: ServerProcess | null = null;
	let api: ApiClient | null = null;
	let dbPath: string | null = null;
	const agents: AgentProcess[] = [];

	const createUniqueDbPath = (): string => {
		if (!tempDir) {
			throw new Error("Fixture not set up. Call setup() first.");
		}
		return path.join(
			tempDir,
			`test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
		);
	};

	const setup = (): void => {
		tempDir = createTempDir(prefix);
	};

	const teardown = (): void => {
		if (tempDir) {
			cleanupTempDir(tempDir);
			tempDir = "";
		}
	};

	const setupTest = async (): Promise<void> => {
		dbPath = createUniqueDbPath();
		server = await startServer({ tempDir, dbPath });
		api = createApiClient(`http://localhost:${server.port}`);
	};

	const teardownTest = async (): Promise<void> => {
		// Stop all tracked agents with error handling for each
		// Agents may have already crashed in failure tests
		for (const agent of agents) {
			try {
				await agent.stop();
			} catch (error) {
				// Log but don't fail cleanup for already-dead agents
				console.warn(
					`[teardown] Could not stop agent ${agent.agentId}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
		agents.length = 0;

		// Stop server
		if (server) {
			await server.stop();
			server = null;
		}

		api = null;
		dbPath = null;
	};

	const addAgent = (agent: AgentProcess): void => {
		agents.push(agent);
	};

	// Return fixture object with getters for mutable state
	return {
		get tempDir() {
			return tempDir;
		},
		get server() {
			return server;
		},
		set server(value: ServerProcess | null) {
			server = value;
		},
		get api() {
			return api;
		},
		set api(value: ApiClient | null) {
			api = value;
		},
		get agents() {
			return agents;
		},
		get dbPath() {
			return dbPath;
		},
		set dbPath(value: string | null) {
			dbPath = value;
		},
		setup,
		teardown,
		setupTest,
		teardownTest,
		addAgent,
		createUniqueDbPath,
	};
}
