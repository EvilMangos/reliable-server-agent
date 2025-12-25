/**
 * Dependency Injection Tokens (Inversify Symbols)
 *
 * Centralized token definitions for all injectable dependencies.
 * Uses symbols to ensure type safety and unique identification.
 */

import type { Router } from "express";
import type { CommandRepository } from "../contracts/index.js";
import type { CommandService } from "../service/index.js";

// ============================================================================
// Configuration Types
// ============================================================================

export interface ServerConfig {
	readonly databasePath: string;
	readonly port: number;
}

// ============================================================================
// Injection Tokens
// ============================================================================

export const TYPES = {
	// Configuration
	Config: Symbol.for("Config"),
	Clock: Symbol.for("Clock"),

	// Infrastructure
	Database: Symbol.for("Database"),
	CommandRepository: Symbol.for("CommandRepository"),

	// Services
	CommandService: Symbol.for("CommandService"),

	// HTTP Layer
	CommandRouter: Symbol.for("CommandRouter"),
} as const;

// ============================================================================
// Type aliases for backwards compatibility
// ============================================================================

/** @deprecated Use TYPES.Config instead */
export const CONFIG = TYPES.Config;

/** @deprecated Use TYPES.Clock instead */
export const CLOCK = TYPES.Clock;

/** @deprecated Use TYPES.Database instead */
export const DATABASE = TYPES.Database;

/** @deprecated Use TYPES.CommandRepository instead */
export const COMMAND_REPOSITORY = TYPES.CommandRepository;

/** @deprecated Use TYPES.CommandService instead */
export const COMMAND_SERVICE = TYPES.CommandService;

/** @deprecated Use TYPES.CommandRouter instead */
export const COMMAND_ROUTER = TYPES.CommandRouter;

// ============================================================================
// Container interface for type inference
// ============================================================================

export interface ContainerBindings {
	[TYPES.Config]: ServerConfig;
	[TYPES.Clock]: () => number;
	[TYPES.Database]: unknown;
	[TYPES.CommandRepository]: CommandRepository;
	[TYPES.CommandService]: CommandService;
	[TYPES.CommandRouter]: Router;
}
