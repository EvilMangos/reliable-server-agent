/**
 * Agent package public API
 *
 * This module exports the main agent factory and configuration types.
 */

// Agent factory
export { AgentImpl } from "./agent.js";

// Agent type
export type { Agent } from "./types/agent.js";

// Configuration
export { loadConfig } from "./config/index.js";
export type { AgentConfig } from "./types/agent-config.js";

// Class implementations
export { LoggerImpl } from "./logger/index.js";
export { JournalManagerImpl } from "./journal.js";
export { ServerClientImpl } from "./server-client.js";
export { HeartbeatManagerImpl } from "./heartbeat.js";

// Interface types
export type { Logger } from "./types/logger.js";
export type { JournalManager } from "./types/journal-manager.js";
export type { ServerClient } from "./types/server-client.js";
export type { HeartbeatManager } from "./types/heartbeat-manager.js";

// Dependency Injection
export {
	ContainerImpl,
	createContainer,
	createToken,
	createAgent,
	createAgentContainer,
	configureContainer,
	AGENT,
	CONFIG,
	EXECUTOR_REGISTRY,
	HEARTBEAT_MANAGER,
	JOURNAL_MANAGER,
	LOGGER,
	LOGGER_FACTORY,
	RANDOM_FAILURE_CALLBACK,
	SERVER_CLIENT,
	TOKENS,
} from "./di/index.js";
export type { Container, Factory, Token, ExecutorRegistry, LoggerFactory } from "./di/index.js";
