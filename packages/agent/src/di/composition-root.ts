/**
 * Composition root for the agent package.
 * Wires all dependencies together using the inversify-based DI container.
 */

import "reflect-metadata";
import { COMMAND_TYPE } from "@reliable-server-agent/shared";
import type { AgentConfig } from "../types";
import { AgentImpl } from "../agent";
import { HeartbeatManagerImpl } from "../heartbeat";
import { JournalManagerImpl } from "../journal";
import { LoggerImpl } from "../logger";
import { ServerClientImpl } from "../server-client";
import { DelayExecutor, HttpGetJsonExecutor } from "../executors";
import { type Container, createContainer } from "./container";
import {
	AGENT,
	CONFIG,
	EXECUTOR_REGISTRY,
	type ExecutorRegistry,
	HEARTBEAT_MANAGER,
	JOURNAL_MANAGER,
	LOGGER,
	LOGGER_FACTORY,
	type LoggerFactory,
	RANDOM_FAILURE_CALLBACK,
	SERVER_CLIENT,
} from "./tokens";

/**
 * Configure all dependencies in the container.
 * This is the single place where all wiring happens.
 */
export function configureContainer(container: Container, config: AgentConfig): void {
	// Register configuration
	container.instance(CONFIG, config);

	// Register logger factory
	container.singleton<LoggerFactory>(LOGGER_FACTORY, () => {
		return (prefix: string) => new LoggerImpl(prefix);
	});

	// Register main logger
	container.singleton(LOGGER, (c: Container) => {
		const factory = c.resolve(LOGGER_FACTORY);
		return factory("agent");
	});

	// Register random failure callback (optional)
	container.singleton(RANDOM_FAILURE_CALLBACK, (c: Container) => {
		const cfg = c.resolve(CONFIG);
		if (!cfg.randomFailures) {
			return undefined;
		}
		const logger = c.resolve(LOGGER);
		return () => {
			logger.warn("Random failure triggered - exiting process");
			process.exit(1);
		};
	});

	// Register server client
	container.singleton(SERVER_CLIENT, (c: Container) => {
		const cfg = c.resolve(CONFIG);
		const factory = c.resolve(LOGGER_FACTORY);
		return new ServerClientImpl(cfg, factory("server-client"));
	});

	// Register journal manager
	container.singleton(JOURNAL_MANAGER, (c: Container) => {
		const cfg = c.resolve(CONFIG);
		const factory = c.resolve(LOGGER_FACTORY);
		return new JournalManagerImpl(cfg.stateDir, cfg.agentId, factory("journal"));
	});

	// Register heartbeat manager
	container.singleton(HEARTBEAT_MANAGER, (c: Container) => {
		const cfg = c.resolve(CONFIG);
		const serverClient = c.resolve(SERVER_CLIENT);
		const factory = c.resolve(LOGGER_FACTORY);
		return new HeartbeatManagerImpl(serverClient, cfg.heartbeatIntervalMs, factory("heartbeat"));
	});

	// Register executor registry
	container.singleton<ExecutorRegistry>(EXECUTOR_REGISTRY, (c: Container) => {
		const logger = c.resolve(LOGGER);
		const journalManager = c.resolve(JOURNAL_MANAGER);
		const onRandomFailure = c.resolve(RANDOM_FAILURE_CALLBACK);

		const registry: ExecutorRegistry = new Map();
		registry.set(COMMAND_TYPE.DELAY, new DelayExecutor(logger, journalManager, onRandomFailure));
		registry.set(COMMAND_TYPE.HTTP_GET_JSON, new HttpGetJsonExecutor(logger, journalManager, onRandomFailure));

		return registry;
	});

	// Register agent
	container.singleton(AGENT, (c: Container) => {
		return new AgentImpl(
			c.resolve(CONFIG),
			c.resolve(LOGGER),
			c.resolve(SERVER_CLIENT),
			c.resolve(JOURNAL_MANAGER),
			c.resolve(HEARTBEAT_MANAGER),
			c.resolve(EXECUTOR_REGISTRY),
		);
	});
}

/**
 * Create and configure a container with all dependencies for the given config.
 */
export function createAgentContainer(config: AgentConfig): Container {
	const container = createContainer();
	configureContainer(container, config);
	return container;
}

/**
 * Create and return the agent from a fully configured container.
 */
export function createAgent(config: AgentConfig): AgentImpl {
	const container = createAgentContainer(config);
	return container.resolve(AGENT) as AgentImpl;
}
