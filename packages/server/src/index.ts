import express, { type Application } from "express";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import { CommandDatabase } from "./store/database.js";
import { createCommandRoutes } from "./routes/commands.js";

/**
 * Server startup result
 */
export interface ServerInstance {
	app: Application;
	server: http.Server;
	db: CommandDatabase;
}

/**
 * Start the Control Server
 *
 * Initializes database, performs startup recovery, mounts routes,
 * and begins listening for HTTP requests.
 */
export async function startServer(): Promise<ServerInstance> {
	// Read configuration from environment
	const dbPath = process.env.DATABASE_PATH || "./data/commands.db";
	// Use PORT=0 for dynamic port assignment, default to 3000 if PORT is not set
	const portEnv = process.env.PORT;
	const port = portEnv !== undefined ? parseInt(portEnv, 10) : 3000;

	// Ensure database directory exists
	const dbDir = path.dirname(dbPath);
	fs.mkdirSync(dbDir, { recursive: true });

	// Initialize database
	const db = new CommandDatabase(dbPath);

	// Startup recovery: reset expired leases
	const now = Date.now();
	const resetCount = db.resetExpiredLeases(now);
	console.log(`Startup recovery: reset ${resetCount} expired lease(s)`);

	// Create Express app with JSON body parsing
	const app = express();
	app.use(express.json());

	// Health check endpoint
	app.get("/health", (_req, res) => {
		res.status(200).json({ status: "ok" });
	});

	// Mount command routes
	const commandRoutes = createCommandRoutes(db);
	app.use("/commands", commandRoutes);

	// Start server with promise wrapper
	const server = await new Promise<http.Server>((resolve, reject) => {
		const httpServer = app.listen(port, () => {
			// Get the actual port in case port 0 was used for dynamic assignment
			const address = httpServer.address();
			const actualPort = typeof address === "object" && address !== null
				? address.port
				: port;
			console.log(`Server started on port ${actualPort}`);
			resolve(httpServer);
		});

		httpServer.on("error", (err) => {
			db.close();
			reject(err);
		});
	});

	// Register signal handlers for graceful shutdown
	const shutdown = () => {
		server.close();
		db.close();
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	return { app, server, db };
}

/**
 * Check if this module is being run directly (as CLI entry point).
 */
function isMainModule(): boolean {
	const scriptPath = process.argv[1];
	if (!scriptPath) {
		return false;
	}
	// Check if the script path contains our module name
	return scriptPath.includes("packages/server") && (
		scriptPath.endsWith("index.js") ||
		scriptPath.endsWith("index.ts")
	);
}

// CLI entry point
if (isMainModule()) {
	startServer().catch(err => {
		console.error("Server failed:", err);
		process.exit(1);
	});
}

// Start server when run directly (not when imported as a module in tests)
// Check if this file is being run directly by comparing the ESM main module pattern
const isMainModule = process.argv[1]?.includes("packages/server") && !process.argv[1]?.includes("vitest");

if (isMainModule) {
	startServer().catch((err) => {
		console.error("Failed to start server:", err);
		process.exit(1);
	});
}
