import * as http from "http";
import * as path from "path";
import type { Container } from "inversify";
import type { CommandRepository } from "../../contracts/index.js";

export interface TestServerResult {
	server: http.Server;
	db: CommandRepository;
	container?: Container;
	dbPath: string;
}

/**
 * Creates a test server with the specified configuration.
 * Sets up environment variables and starts the server.
 *
 * Uses dynamic import to ensure fresh module instance for each test.
 *
 * @param tempDir - The temporary directory for the test database
 * @param dbName - Optional database filename (defaults to "test.db")
 * @param port - Optional port (defaults to "0" for ephemeral port)
 * @returns The server, database, container, and database path
 */
export async function createTestServer(
	tempDir: string,
	dbName = "test.db",
	port = "0",
): Promise<TestServerResult> {
	// Dynamic import to ensure fresh module instance after vi.resetModules()
	const { startServer } = await import("../../index.js");

	const dbPath = path.join(tempDir, dbName);
	process.env.DATABASE_PATH = dbPath;
	process.env.PORT = port;

	const { server, db, container } = await startServer();

	return { server, db, container, dbPath };
}

/**
 * Closes a test server and its database connection.
 * Uses the container's dispose function for proper cleanup.
 * Waits for server to fully close before disposing resources.
 *
 * @param server - The HTTP server to close
 * @param db - The database connection to close (deprecated, use container)
 * @param container - Optional container for proper resource cleanup
 */
export async function closeTestServer(
	server: http.Server,
	db: CommandRepository,
	container?: Container,
): Promise<void> {
	// Wait for server to fully close
	await new Promise<void>((resolve) => {
		server.close(() => resolve());
	});

	if (container) {
		// Dynamic import to match the module instance used in createTestServer
		const { disposeContainer } = await import("../../index.js");
		disposeContainer(container);
	} else {
		// Fallback for backwards compatibility
		db.close();
	}
}
