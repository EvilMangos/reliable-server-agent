import "reflect-metadata";
import express, { type Router } from "express";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import { fileURLToPath } from "url";
import type { Container } from "inversify";
import type { ServerInstance } from "./contracts/index.js";
import {
	type ServerConfig,
	TYPES,
	createContainer,
	disposeContainer,
} from "./container/index.js";
import type { CommandRepository } from "./contracts/index.js";
import type { CommandService } from "./service/index.js";
import { errorHandler } from "./routes/middleware/index.js";

export type { ServerInstance } from "./contracts/index.js";
export {
	Container,
	createContainer,
	disposeContainer,
	TYPES,
	CONFIG,
	CLOCK,
	COMMAND_REPOSITORY,
	COMMAND_SERVICE,
	COMMAND_ROUTER,
	type ServerConfig,
} from "./container/index.js";

/**
 * Start the Control Server
 *
 * Initializes the DI container, performs startup recovery, mounts routes,
 * and begins listening for HTTP requests.
 *
 * @param containerOverride - Optional pre-configured container for testing
 */
export async function startServer(containerOverride?: Container): Promise<ServerInstance> {
	// Read configuration from environment
	const config: ServerConfig = {
		databasePath: process.env.DATABASE_PATH || "./data/commands.db",
		port: process.env.PORT !== undefined ? parseInt(process.env.PORT, 10) : 3000,
	};

	// Ensure database directory exists
	const dbDir = path.dirname(config.databasePath);
	fs.mkdirSync(dbDir, { recursive: true });

	// Create or use provided container
	const container = containerOverride ?? createContainer(config);

	// Resolve dependencies from container
	const service = container.get<CommandService>(TYPES.CommandService);
	const commandRoutes = container.get<Router>(TYPES.CommandRouter);
	const db = container.get<CommandRepository>(TYPES.CommandRepository);

	// Startup recovery: reset expired leases
	const resetCount = service.resetExpiredLeases();
	console.log(`Startup recovery: reset ${resetCount} expired lease(s)`);

	// Create Express app with JSON body parsing
	const app = express();
	app.use(express.json());

	// Health check endpoint
	app.get("/health", (_req, res) => {
		res.status(200).json({ status: "ok" });
	});

	// Mount command routes
	app.use("/commands", commandRoutes);

	// Error handling middleware (must be last)
	app.use(errorHandler);

	// Resolve port from container config
	const port = container.get<ServerConfig>(TYPES.Config).port;

	// Start server with promise wrapper
	const server = await new Promise<http.Server>((resolve, reject) => {
		const httpServer = app.listen(port, () => {
			const address = httpServer.address();
			const actualPort = typeof address === "object" && address ? address.port : port;
			console.log(`Server started on port ${actualPort}`);
			resolve(httpServer);
		});

		httpServer.on("error", (err) => {
			disposeContainer(container);
			reject(err);
		});
	});

	// Register signal handlers for graceful shutdown
	let isShuttingDown = false;
	const shutdown = () => {
		if (isShuttingDown) return;
		isShuttingDown = true;

		console.log("Shutting down gracefully...");

		// Stop accepting new connections and wait for existing ones to finish
		server.close(() => {
			console.log("All connections closed, disposing resources...");
			disposeContainer(container);
			process.exit(0);
		});

		// Force exit after timeout if connections don't drain
		setTimeout(() => {
			console.warn("Forcing shutdown after timeout");
			disposeContainer(container);
			process.exit(1);
		}, 10000);
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	return { app, server, db, service, container };
}

// Start server when run directly (not when imported as a module in tests)
const currentFilePath = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] === currentFilePath;

if (isMainModule) {
	startServer().catch((err) => {
		console.error("Failed to start server:", err);
		process.exit(1);
	});
}
