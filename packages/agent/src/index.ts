/**
 * Agent package public API
 *
 * This module exports the main agent factory and configuration types.
 */

// Agent factory
export { AgentImpl } from "./agent";

// Agent type
export type { Agent } from "./types/agent";

// Configuration
export { loadConfig } from "./config";
export type { AgentConfig } from "./types/agent-config";

// Class implementations
export { LoggerImpl } from "./logger";
export { JournalManagerImpl } from "./journal";
export { ServerClientImpl } from "./server-client";
export { HeartbeatManagerImpl } from "./heartbeat";

// Interface types
export type { Logger } from "./types/logger";
export type { JournalManager } from "./types/journal-manager";
export type { ServerClient } from "./types/server-client";
export type { HeartbeatManager } from "./types/heartbeat-manager";
