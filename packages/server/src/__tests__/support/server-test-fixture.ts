import * as http from "http";
import * as path from "path";
import type { CommandDatabase } from "../../store";

export interface TestServerResult {
	server: http.Server;
	db: CommandDatabase;
	dbPath: string;
}

/**
 * Creates a test server with the specified configuration.
 * Sets up environment variables and starts the server.
 *
 * @param tempDir - The temporary directory for the test database
 * @param dbName - Optional database filename (defaults to "test.db")
 * @param port - Optional port (defaults to "0" for ephemeral port)
 * @returns The server, database, and database path
 */
export async function createTestServer(
	tempDir: string,
	dbName = "test.db",
	port = "0",
): Promise<TestServerResult> {
	// Dynamic import required because tests using this fixture call vi.resetModules()
	// and need fresh module instances
	const { startServer } = await import("../../index.js");

	const dbPath = path.join(tempDir, dbName);
	process.env.DATABASE_PATH = dbPath;
	process.env.PORT = port;

	const { server, db } = await startServer();

	return { server, db, dbPath };
}

/**
 * Closes a test server and its database connection.
 *
 * @param server - The HTTP server to close
 * @param db - The database connection to close
 */
export function closeTestServer(server: http.Server, db: CommandDatabase): void {
	server.close();
	db.close();
}
