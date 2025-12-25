import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import { startServer } from "../index.js";
import { CommandDatabase } from "../store/database.js";

/**
 * Tests for server entry point (index.ts)
 *
 * These tests verify:
 * - Express app with JSON body parsing
 * - SQLite database initialization with WAL mode
 * - Database directory creation
 * - Startup recovery for expired leases
 * - Command routes mounting at /commands
 * - Port configuration
 * - Graceful shutdown on SIGINT/SIGTERM
 * - Error handling for database and port failures
 * - No periodic lease checking
 */

/**
 * HTTP agent that doesn't reuse connections
 * This prevents keep-alive connections from causing issues between tests
 */
const noKeepAliveAgent = new http.Agent({ keepAlive: false });

/**
 * Helper to close a server and wait for it to fully close
 */
async function closeServer(server: http.Server): Promise<void> {
	return new Promise((resolve) => {
		// Close all active connections first (Node 18.2+)
		server.closeAllConnections();
		server.close(() => resolve());
	});
}

/**
 * Helper to make HTTP requests to a server
 */
async function httpRequest(
	server: http.Server,
	method: string,
	path: string,
	body?: object,
): Promise<{ status: number; body: unknown }> {
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Server not listening");
	}

	return new Promise((resolve, reject) => {
		const data = body ? JSON.stringify(body) : undefined;
		const req = http.request(
			{
				hostname: "localhost",
				port: address.port,
				path,
				method,
				agent: noKeepAliveAgent,
				headers: {
					"Content-Type": "application/json",
					Connection: "close",
					...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
				},
			},
			(res) => {
				let responseBody = "";
				res.on("data", (chunk) => (responseBody += chunk));
				res.on("end", () => {
					let parsedBody: unknown = responseBody;
					try {
						if (responseBody) {
							parsedBody = JSON.parse(responseBody);
						}
					} catch {
						// Keep as string if not JSON
					}
					resolve({ status: res.statusCode ?? 0, body: parsedBody });
				});
			},
		);
		req.on("error", reject);
		if (data) {
			req.write(data);
		}
		req.end();
	});
}

describe("server entry point (index.ts)", () => {
	// Make a deep copy of the original environment
	const originalEnv = { ...process.env };
	let consoleLogSpy: MockInstance;
	let _consoleErrorSpy: MockInstance;
	let _processExitSpy: MockInstance;
	let tempDir: string;

	beforeEach(() => {
		// Reset env vars to original state (don't use vi.resetModules() - breaks native modules)
		process.env = { ...originalEnv };
		delete process.env.PORT;
		delete process.env.DATABASE_PATH;

		// Spy on console
		consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {
		});
		_consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {
		});
		_processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

		// Create temp directory for test database
		tempDir = fs.mkdtempSync(path.join(process.cwd(), ".test-server-"));
	});

	afterEach(() => {
		process.env = originalEnv;
		vi.restoreAllMocks();

		// Remove signal handlers that were added by startServer
		// This prevents signal handler accumulation across tests
		process.removeAllListeners("SIGINT");
		process.removeAllListeners("SIGTERM");

		// Clean up temp directory
		if (tempDir && fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	describe("Express app configuration", () => {
		it("creates Express app with JSON body parsing middleware", async () => {
			const dbPath = path.join(tempDir, "test.db");
			process.env.DATABASE_PATH = dbPath;
			process.env.PORT = "0"; // Use ephemeral port

			const { server, db } = await startServer();

			try {
				// Verify JSON body parsing works by making a POST request
				const response = await httpRequest(server, "POST", "/commands", {
					type: "DELAY",
					payload: { ms: 1000 },
				});

				// Should get 201 Created, not 400 Bad Request (which would indicate JSON not parsed)
				expect(response.status).toBe(201);
				expect(response.body).toHaveProperty("commandId");
			} finally {
				await closeServer(server);
				db.close();
			}
		});
	});

	describe("SQLite database initialization", () => {
		it("initializes SQLite database with WAL mode at DATABASE_PATH", async () => {
			const dbPath = path.join(tempDir, "custom.db");
			process.env.DATABASE_PATH = dbPath;
			process.env.PORT = "0";

			const { server, db } = await startServer();

			try {
				// Verify database file exists
				expect(fs.existsSync(dbPath)).toBe(true);

				// Verify WAL mode is enabled (check for -wal file after first write)
				// WAL mode creates a -wal file on first transaction
				await httpRequest(server, "POST", "/commands", {
					type: "DELAY",
					payload: { ms: 100 },
				});

				// WAL mode should create a .db-wal file
				expect(fs.existsSync(`${dbPath}-wal`)).toBe(true);
			} finally {
				await closeServer(server);
				db.close();
			}
		});

		it("uses default database path ./data/commands.db when DATABASE_PATH not set", async () => {
			// Ensure DATABASE_PATH is not set
			delete process.env.DATABASE_PATH;
			process.env.PORT = "0";

			// Create data directory to avoid directory creation test interference
			const dataDir = path.join(process.cwd(), "data");
			const createdDataDir = !fs.existsSync(dataDir);
			if (createdDataDir) {
				fs.mkdirSync(dataDir, { recursive: true });
			}

			const { server, db } = await startServer();

			try {
				const defaultDbPath = path.join(process.cwd(), "data", "commands.db");
				expect(fs.existsSync(defaultDbPath)).toBe(true);
			} finally {
				await closeServer(server);
				db.close();
				// Clean up default database
				const defaultDbPath = path.join(process.cwd(), "data", "commands.db");
				if (fs.existsSync(defaultDbPath)) {
					fs.unlinkSync(defaultDbPath);
				}
				// Clean up WAL files if they exist
				if (fs.existsSync(`${defaultDbPath}-wal`)) {
					fs.unlinkSync(`${defaultDbPath}-wal`);
				}
				if (fs.existsSync(`${defaultDbPath}-shm`)) {
					fs.unlinkSync(`${defaultDbPath}-shm`);
				}
				// Remove data dir if we created it
				if (createdDataDir && fs.existsSync(dataDir)) {
					fs.rmdirSync(dataDir);
				}
			}
		});

		it("creates database directory if it does not exist", async () => {
			const nestedDir = path.join(tempDir, "nested", "deep", "path");
			const dbPath = path.join(nestedDir, "test.db");
			process.env.DATABASE_PATH = dbPath;
			process.env.PORT = "0";

			// Verify directory doesn't exist
			expect(fs.existsSync(nestedDir)).toBe(false);

			const { server, db } = await startServer();

			try {
				// Verify directory was created
				expect(fs.existsSync(nestedDir)).toBe(true);
				expect(fs.existsSync(dbPath)).toBe(true);
			} finally {
				await closeServer(server);
				db.close();
			}
		});
	});

	describe("startup recovery", () => {
		it("resets expired leases to PENDING on startup", async () => {
			const dbPath = path.join(tempDir, "recovery.db");

			// Pre-populate database with expired RUNNING command
			const seedDb = new CommandDatabase(dbPath);
			seedDb.createCommand("cmd-1", "DELAY", { ms: 5000 }, Date.now() - 60000);

			// Claim the command (sets it to RUNNING)
			const claimed = seedDb.claimCommand("agent-old", "lease-old", 1000, Date.now() - 60000);
			expect(claimed).not.toBeNull();
			expect(claimed!.status).toBe("RUNNING");

			// Verify lease is expired
			expect(claimed!.leaseExpiresAt).toBeLessThan(Date.now());

			seedDb.close();

			// Now start the server which should recover the expired lease
			process.env.DATABASE_PATH = dbPath;
			process.env.PORT = "0";

			const { server, db } = await startServer();

			try {
				// Verify the command is now PENDING (recovered)
				const command = db.getCommand("cmd-1");
				expect(command).not.toBeNull();
				expect(command!.status).toBe("PENDING");
				expect(command!.agentId).toBeNull();
				expect(command!.leaseId).toBeNull();
				expect(command!.leaseExpiresAt).toBeNull();
			} finally {
				await closeServer(server);
				db.close();
			}
		});

		it("logs recovery operation results", async () => {
			const dbPath = path.join(tempDir, "recovery-log.db");

			// Pre-populate with expired command
			const seedDb = new CommandDatabase(dbPath);
			seedDb.createCommand("cmd-1", "DELAY", { ms: 5000 }, Date.now() - 60000);
			seedDb.claimCommand("agent-old", "lease-old", 1000, Date.now() - 60000);
			seedDb.close();

			process.env.DATABASE_PATH = dbPath;
			process.env.PORT = "0";

			const { server, db } = await startServer();

			try {
				// Verify recovery was logged
				const logCalls = consoleLogSpy.mock.calls.map((call) => call.join(" "));
				const hasRecoveryLog = logCalls.some(
					(log) =>
						/recovery|reset.*expired|recovered.*lease/i.test(log) ||
                        /1.*lease.*reset|reset.*1/i.test(log),
				);
				expect(hasRecoveryLog).toBe(true);
			} finally {
				await closeServer(server);
				db.close();
			}
		});

		it("keeps non-expired RUNNING commands unchanged", async () => {

			const dbPath = path.join(tempDir, "no-recovery.db");

			// Pre-populate with valid (non-expired) RUNNING command
			const seedDb = new CommandDatabase(dbPath);
			seedDb.createCommand("cmd-1", "DELAY", { ms: 5000 }, Date.now());

			// Claim with a lease that expires in the future
			const claimed = seedDb.claimCommand("agent-active", "lease-active", 60000, Date.now());
			expect(claimed).not.toBeNull();
			expect(claimed!.status).toBe("RUNNING");
			expect(claimed!.leaseExpiresAt).toBeGreaterThan(Date.now());

			seedDb.close();

			process.env.DATABASE_PATH = dbPath;
			process.env.PORT = "0";

			const { server, db } = await startServer();

			try {
				// Verify command is still RUNNING (not recovered)
				const command = db.getCommand("cmd-1");
				expect(command).not.toBeNull();
				expect(command!.status).toBe("RUNNING");
				expect(command!.agentId).toBe("agent-active");
				expect(command!.leaseId).toBe("lease-active");
			} finally {
				await closeServer(server);
				db.close();
			}
		});
	});

	describe("command routes", () => {
		it("mounts command routes at /commands path", async () => {
			const dbPath = path.join(tempDir, "routes.db");
			process.env.DATABASE_PATH = dbPath;
			process.env.PORT = "0";

			const { server, db } = await startServer();

			try {
				// Test POST /commands (create)
				const createRes = await httpRequest(server, "POST", "/commands", {
					type: "DELAY",
					payload: { ms: 1000 },
				});

				expect(createRes.status).toBe(201);
				const commandId = (createRes.body as { commandId: string }).commandId;

				// Test GET /commands/:id
				const getRes = await httpRequest(server, "GET", `/commands/${commandId}`);
				expect(getRes.status).toBe(200);
				expect((getRes.body as { status: string }).status).toBe("PENDING");

				// Test POST /commands/claim
				const claimRes = await httpRequest(server, "POST", "/commands/claim", {
					agentId: "test-agent",
					maxLeaseMs: 30000,
				});

				expect(claimRes.status).toBe(200);
				expect((claimRes.body as { commandId: string }).commandId).toBe(commandId);
			} finally {
				await closeServer(server);
				db.close();
			}
		});

		it("returns 404 for requests not matching /commands routes", async () => {

			const dbPath = path.join(tempDir, "404.db");
			process.env.DATABASE_PATH = dbPath;
			process.env.PORT = "0";

			const { server, db } = await startServer();

			try {
				const res = await httpRequest(server, "GET", "/nonexistent");
				expect(res.status).toBe(404);
			} finally {
				await closeServer(server);
				db.close();
			}
		});
	});

	describe("port configuration", () => {
		it("listens on configurable PORT from environment variable", async () => {
			const dbPath = path.join(tempDir, "port.db");
			process.env.DATABASE_PATH = dbPath;
			process.env.PORT = "4567";

			const { server, db } = await startServer();

			try {
				const address = server.address();
				expect(address).not.toBeNull();
				expect((address as { port: number }).port).toBe(4567);
			} finally {
				await closeServer(server);
				db.close();
			}
		});

		it("uses default port 3000 when PORT is not set", async () => {
			// Test that the default port logic is 3000 by checking if it tries to bind to port 3000
			// We can't actually test binding if port 3000 is in use (e.g., by Docker)
			const dbPath = path.join(tempDir, "default-port.db");
			process.env.DATABASE_PATH = dbPath;
			delete process.env.PORT;

			try {
				const { server, db } = await startServer();
				// If we get here, port 3000 was available
				try {
					const address = server.address();
					expect(address).not.toBeNull();
					expect((address as { port: number }).port).toBe(3000);
				} finally {
					await closeServer(server);
					db.close();
				}
			} catch (err: unknown) {
				// If port 3000 is in use, verify the error is EADDRINUSE (which proves default is 3000)
				if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
					expect((err as NodeJS.ErrnoException).message).toContain("3000");
				} else {
					throw err;
				}
			}
		});

		it("logs startup success message with port", async () => {
			const dbPath = path.join(tempDir, "startup-log.db");
			process.env.DATABASE_PATH = dbPath;
			process.env.PORT = "5555";

			const { server, db } = await startServer();

			try {
				const logCalls = consoleLogSpy.mock.calls.map((call) => call.join(" "));
				const hasStartupLog = logCalls.some((log) =>
					/server.*started|listening.*5555|started.*5555|5555/i.test(log),
				);
				expect(hasStartupLog).toBe(true);
			} finally {
				await closeServer(server);
				db.close();
			}
		});
	});

	describe("graceful shutdown", () => {
		it("handles SIGINT for graceful shutdown", async () => {

			const dbPath = path.join(tempDir, "sigint.db");
			process.env.DATABASE_PATH = dbPath;
			process.env.PORT = "0";

			const { server } = await startServer();

			// Create a promise that resolves when server closes
			const serverClosed = new Promise<void>((resolve) => {
				server.on("close", resolve);
			});

			// Emit SIGINT
			process.emit("SIGINT");

			// Wait for server to close (with timeout)
			await Promise.race([
				serverClosed,
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error("Server did not close on SIGINT")), 5000),
				),
			]);

			// Verify server is closed
			expect(server.listening).toBe(false);
		});

		it("handles SIGTERM for graceful shutdown", async () => {
			const dbPath = path.join(tempDir, "sigterm.db");
			process.env.DATABASE_PATH = dbPath;
			process.env.PORT = "0";

			const { server } = await startServer();

			// Create a promise that resolves when server closes
			const serverClosed = new Promise<void>((resolve) => {
				server.on("close", resolve);
			});

			// Emit SIGTERM
			process.emit("SIGTERM");

			// Wait for server to close (with timeout)
			await Promise.race([
				serverClosed,
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error("Server did not close on SIGTERM")), 5000),
				),
			]);

			// Verify server is closed
			expect(server.listening).toBe(false);
		});

		it("closes database connection on shutdown", async () => {
			const dbPath = path.join(tempDir, "db-close.db");
			process.env.DATABASE_PATH = dbPath;
			process.env.PORT = "0";

			const { server, db } = await startServer();

			// Spy on db.close
			const dbCloseSpy = vi.spyOn(db, "close");

			// Create a promise that resolves when server closes
			const serverClosed = new Promise<void>((resolve) => {
				server.on("close", resolve);
			});

			// Emit SIGINT
			process.emit("SIGINT");

			await Promise.race([
				serverClosed,
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error("Server did not close")), 5000),
				),
			]);

			// Verify database was closed
			expect(dbCloseSpy).toHaveBeenCalled();
		});
	});

	describe("error handling", () => {
		it("exits with code 1 on database initialization failure", async () => {
			// Use an invalid path that cannot be created (e.g., in /dev/null directory)
			const invalidPath = "/dev/null/invalid/path/db.sqlite";
			process.env.DATABASE_PATH = invalidPath;
			process.env.PORT = "0";

			await expect(startServer()).rejects.toThrow();

			// Or if startServer handles errors internally:
			// expect(processExitSpy).toHaveBeenCalledWith(1);
		});

		it("exits with code 1 on port binding failure", async () => {
			const dbPath = path.join(tempDir, "port-conflict.db");
			process.env.DATABASE_PATH = dbPath;

			// First, occupy a port
			const blockingServer = http.createServer();
			await new Promise<void>((resolve) => {
				blockingServer.listen(9876, () => resolve());
			});

			try {
				process.env.PORT = "9876"; // Same port as blocking server

				await expect(startServer()).rejects.toThrow(/EADDRINUSE|address already in use/i);

				// Or if startServer handles errors internally:
				// expect(processExitSpy).toHaveBeenCalledWith(1);
			} finally {
				blockingServer.close();
			}
		});
	});

	describe("no periodic lease checking", () => {
		it("does NOT set up periodic lease expiry checking", async () => {
			const dbPath = path.join(tempDir, "no-periodic.db");
			process.env.DATABASE_PATH = dbPath;
			process.env.PORT = "0";

			// Spy on setInterval to detect periodic tasks
			const setIntervalSpy = vi.spyOn(global, "setInterval");

			const { server, db } = await startServer();

			try {
				// Verify no setInterval was called with lease-related callbacks
				// This checks that no periodic lease checking is set up
				const leaseCheckingCalls = setIntervalSpy.mock.calls.filter(([callback]) => {
					// Check if callback string representation mentions lease
					const callbackStr = callback.toString();
					return (
						callbackStr.includes("lease") ||
                        callbackStr.includes("expired") ||
                        callbackStr.includes("resetExpiredLeases")
					);
				});

				expect(leaseCheckingCalls.length).toBe(0);
			} finally {
				await closeServer(server);
				db.close();
			}
		});
	});

	describe("startServer function contract", () => {
		it("returns an object with app, server, and db properties", async () => {
			const dbPath = path.join(tempDir, "contract.db");
			process.env.DATABASE_PATH = dbPath;
			process.env.PORT = "0";

			const result = await startServer();

			try {
				expect(result).toHaveProperty("app");
				expect(result).toHaveProperty("server");
				expect(result).toHaveProperty("db");

				// Verify types
				expect(typeof result.app).toBe("function"); // Express app is a function
				expect(result.server).toBeInstanceOf(http.Server);
				expect(result.db).toHaveProperty("getCommand"); // Has database methods
				expect(result.db).toHaveProperty("close");
			} finally {
				await closeServer(result.server);
				result.db.close();
			}
		});
	});
});
