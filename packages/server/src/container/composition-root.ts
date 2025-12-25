/**
 * Composition Root
 *
 * Configures the Inversify DI container with all application dependencies.
 * This is the single place where the dependency graph is wired together.
 */

import "reflect-metadata";
import Database from "better-sqlite3";
import { Container } from "inversify";
import { type ServerConfig, TYPES } from "./tokens.js";
import { CommandDatabase } from "../store/index.js";
import { CommandService } from "../service/index.js";
import { createCommandRoutes } from "../routes/commands.js";
import type { CommandRepository } from "../contracts/index.js";

/**
 * Create and configure the application container
 *
 * @param config - Server configuration (database path, port)
 * @param overrides - Optional overrides for testing (clock, etc.)
 */
export function createContainer(
	config: ServerConfig,
	overrides?: {
		clock?: () => number;
	},
): Container {
	const container = new Container();

	// Bind configuration
	container.bind<ServerConfig>(TYPES.Config).toConstantValue(config);

	// Bind clock (injectable for testing)
	container.bind<() => number>(TYPES.Clock).toConstantValue(overrides?.clock ?? (() => Date.now()));

	// Bind SQLite database connection (singleton)
	container.bind<Database.Database>(TYPES.Database).toDynamicValue(() => {
		const cfg = container.get<ServerConfig>(TYPES.Config);
		const db = new Database(cfg.databasePath);
		db.pragma("journal_mode = WAL");
		return db;
	}).inSingletonScope();

	// Bind command repository (singleton, wraps raw database)
	container.bind<CommandRepository>(TYPES.CommandRepository).toDynamicValue(() => {
		const db = container.get<Database.Database>(TYPES.Database);
		return new CommandDatabase(db);
	}).inSingletonScope();

	// Bind command service (singleton)
	container.bind<CommandService>(TYPES.CommandService).toDynamicValue(() => {
		const repository = container.get<CommandRepository>(TYPES.CommandRepository);
		const clock = container.get<() => number>(TYPES.Clock);
		return new CommandService(repository, clock);
	}).inSingletonScope();

	// Bind command router (transient - creates new router each time)
	container.bind(TYPES.CommandRouter).toDynamicValue(() => {
		const service = container.get<CommandService>(TYPES.CommandService);
		return createCommandRoutes(service);
	}).inTransientScope();

	return container;
}

/**
 * Dispose container resources (close database connections, etc.)
 */
export function disposeContainer(container: Container): void {
	if (container.isBound(TYPES.CommandRepository)) {
		const repository = container.get<CommandRepository>(TYPES.CommandRepository);
		repository.close();
	}
}
