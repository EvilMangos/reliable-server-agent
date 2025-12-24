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
	const port = parseInt(process.env.PORT || "3000", 10) || 3000;

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

	// Mount command routes
	const commandRoutes = createCommandRoutes(db);
	app.use("/commands", commandRoutes);

	// Start server with promise wrapper
	const server = await new Promise<http.Server>((resolve, reject) => {
		const httpServer = app.listen(port, () => {
			console.log(`Server started on port ${port}`);
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
