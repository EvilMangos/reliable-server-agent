/**
 * Dependency Injection module exports.
 */

// Re-export reflect-metadata to ensure it's loaded
import "reflect-metadata";

export { ContainerImpl, createContainer, type Container, type Factory, type Lifecycle } from "./container.js";
export { createToken, type Token } from "./tokens.js";
export {
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
	type ExecutorRegistry,
	type LoggerFactory,
} from "./tokens.js";
export { configureContainer, createAgent, createAgentContainer } from "./composition-root.js";
