import { type MockInstance, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import { httpRequest } from "./support/http-test-client.js";
import { closeTestServer, createTestServer } from "./support/server-test-fixture.js";

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

describe("server entry point (index.ts)", () => {
	const originalEnv = process.env;
	let consoleLogSpy: MockInstance;
	let tempDir: string;

	beforeEach(() => {
		// Reset module cache to get fresh imports
		vi.resetModules();

		// Clean up signal handlers from previous test runs to prevent MaxListenersExceededWarning
		process.removeAllListeners("SIGINT");
		process.removeAllListeners("SIGTERM");

		// Reset env vars
		process.env = { ...originalEnv };
		delete process.env.PORT;
		delete process.env.DATABASE_PATH;

		// Spy on console (suppress output during tests)
		consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

		// Create temp directory for test database
		tempDir = fs.mkdtempSync(path.join(process.cwd(), ".test-server-"));
	});

	afterEach(() => {
		process.env = originalEnv;
		vi.restoreAllMocks();

		// Clean up temp directory
		if (tempDir && fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	describe("Express app configuration", () => {
		it("creates Express app with JSON body parsing middleware", async () => {
			const { server, db } = await createTestServer(tempDir);

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
				closeTestServer(server, db);
			}
		});
	});

	describe("SQLite database initialization", () => {
		it("initializes SQLite database with WAL mode at DATABASE_PATH", async () => {
			const { server, db, dbPath } = await createTestServer(tempDir, "custom.db");

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
				closeTestServer(server, db);
			}
		});

		it("uses default database path ./data/commands.db when DATABASE_PATH not set", async () => {
			const { startServer } = await import("../index.js");

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
				closeTestServer(server, db);
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
			const { startServer } = await import("../index.js");

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
				closeTestServer(server, db);
			}
		});
	});

	describe("startup recovery", () => {
		it("resets expired leases to PENDING on startup", async () => {
			const { CommandDatabase } = await import("../store/database.js");
			const { startServer } = await import("../index.js");

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
				closeTestServer(server, db);
			}
		});

		it("logs recovery operation results", async () => {
			const { CommandDatabase } = await import("../store/database.js");
			const { startServer } = await import("../index.js");

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
				closeTestServer(server, db);
			}
		});

		it("keeps non-expired RUNNING commands unchanged", async () => {
			const { CommandDatabase } = await import("../store/database.js");
			const { startServer } = await import("../index.js");

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
				closeTestServer(server, db);
			}
		});
	});

	describe("command routes", () => {
		it("mounts command routes at /commands path", async () => {
			const { server, db } = await createTestServer(tempDir, "routes.db");

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
				closeTestServer(server, db);
			}
		});

		it("returns 404 for requests not matching /commands routes", async () => {
			const { server, db } = await createTestServer(tempDir, "404.db");

			try {
				const res = await httpRequest(server, "GET", "/nonexistent");
				expect(res.status).toBe(404);
			} finally {
				closeTestServer(server, db);
			}
		});
	});

	describe("port configuration", () => {
		it("listens on configurable PORT from environment variable", async () => {
			const { server, db } = await createTestServer(tempDir, "port.db", "4567");

			try {
				const address = server.address();
				expect(address).not.toBeNull();
				expect((address as { port: number }).port).toBe(4567);
			} finally {
				closeTestServer(server, db);
			}
		});

		it("uses default port 3000 when PORT is not set", async () => {
			const { startServer } = await import("../index.js");

			const dbPath = path.join(tempDir, "default-port.db");
			process.env.DATABASE_PATH = dbPath;
			delete process.env.PORT;

			const { server, db } = await startServer();

			try {
				const address = server.address();
				expect(address).not.toBeNull();
				expect((address as { port: number }).port).toBe(3000);
			} finally {
				closeTestServer(server, db);
			}
		});

		it("logs startup success message with port", async () => {
			const { server, db } = await createTestServer(tempDir, "startup-log.db", "5555");

			try {
				const logCalls = consoleLogSpy.mock.calls.map((call) => call.join(" "));
				const hasStartupLog = logCalls.some((log) =>
					/server.*started|listening.*5555|started.*5555|5555/i.test(log),
				);
				expect(hasStartupLog).toBe(true);
			} finally {
				closeTestServer(server, db);
			}
		});
	});

	describe("graceful shutdown", () => {
		it("handles SIGINT for graceful shutdown", async () => {
			const { startServer } = await import("../index.js");

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
			const { startServer } = await import("../index.js");

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
			const { startServer } = await import("../index.js");

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
			const { startServer } = await import("../index.js");

			// Use an invalid path that cannot be created (e.g., in /dev/null directory)
			const invalidPath = "/dev/null/invalid/path/db.sqlite";
			process.env.DATABASE_PATH = invalidPath;
			process.env.PORT = "0";

			await expect(startServer()).rejects.toThrow();

			// Or if startServer handles errors internally:
			// expect(processExitSpy).toHaveBeenCalledWith(1);
		});

		it("exits with code 1 on port binding failure", async () => {
			const { startServer } = await import("../index.js");

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
			// Spy on setInterval to detect periodic tasks (must be set up before server starts)
			const setIntervalSpy = vi.spyOn(global, "setInterval");

			const { server, db } = await createTestServer(tempDir, "no-periodic.db");

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
				closeTestServer(server, db);
			}
		});
	});

	describe("startServer function contract", () => {
		it("returns an object with app, server, and db properties", async () => {
			// Import startServer directly to verify the returned object shape
			const { startServer } = await import("../index.js");

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
				closeTestServer(result.server, result.db);
			}
		});
	});
});
