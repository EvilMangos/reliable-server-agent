/**
 * Injection tokens (identifiers) for all dependencies in the agent package.
 * Uses inversify-style Symbol identifiers for type-safe dependency injection.
 */

import type { CommandType } from "@reliable-server-agent/shared";
import type {
	Agent,
	AgentConfig,
	Executor,
	HeartbeatManager,
	JournalManager,
	Logger,
	ServerClient,
} from "../types/index.js";

/**
 * Token type for identifying dependencies in the container.
 * Using symbols ensures type safety and avoids string collision.
 */
export type Token<T> = symbol & { __type?: T };

/**
 * Creates a typed injection token using Symbol.for for consistency.
 */
export function createToken<T>(description: string): Token<T> {
	return Symbol.for(description) as Token<T>;
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Token for agent configuration.
 */
export const CONFIG = createToken<AgentConfig>("AgentConfig");

// ============================================================================
// Core Services
// ============================================================================

/**
 * Token for the logger instance.
 */
export const LOGGER = createToken<Logger>("Logger");

/**
 * Token for the server client.
 */
export const SERVER_CLIENT = createToken<ServerClient>("ServerClient");

/**
 * Token for the journal manager.
 */
export const JOURNAL_MANAGER = createToken<JournalManager>("JournalManager");

/**
 * Token for the heartbeat manager.
 */
export const HEARTBEAT_MANAGER = createToken<HeartbeatManager>("HeartbeatManager");

// ============================================================================
// Agent
// ============================================================================

/**
 * Token for the agent instance.
 */
export const AGENT = createToken<Agent>("Agent");

// ============================================================================
// Executors
// ============================================================================

/**
 * Token for the executor registry (map of command type to executor).
 */
export const EXECUTOR_REGISTRY = createToken<ExecutorRegistry>("ExecutorRegistry");

/**
 * Type for the executor registry.
 */
export type ExecutorRegistry = Map<CommandType, Executor>;

// ============================================================================
// Optional Dependencies
// ============================================================================

/**
 * Token for the random failure callback (optional).
 */
export const RANDOM_FAILURE_CALLBACK = createToken<(() => void) | undefined>("RandomFailureCallback");

/**
 * Token for a logger factory that creates prefixed loggers.
 */
export type LoggerFactory = (prefix: string) => Logger;
export const LOGGER_FACTORY = createToken<LoggerFactory>("LoggerFactory");

// ============================================================================
// Token groups for documentation
// ============================================================================

export const TOKENS = {
	CONFIG,
	LOGGER,
	LOGGER_FACTORY,
	SERVER_CLIENT,
	JOURNAL_MANAGER,
	HEARTBEAT_MANAGER,
	AGENT,
	EXECUTOR_REGISTRY,
	RANDOM_FAILURE_CALLBACK,
} as const;
