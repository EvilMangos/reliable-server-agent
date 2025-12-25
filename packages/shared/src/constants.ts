/**
 * Shared constants for server and agent.
 *
 * Constants are organized into domain-specific groups for easier discovery.
 * Individual exports are maintained for backward compatibility.
 */

// =============================================================================
// Lease Defaults
// =============================================================================

/** Default lease duration in milliseconds */
export const DEFAULT_LEASE_MS = 30_000;
/** Default heartbeat interval in milliseconds */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * Grouped lease-related constants.
 * Prefer using this object for new code.
 */
export const LEASE_DEFAULTS = {
	/** Default lease duration in milliseconds */
	DEFAULT_LEASE_MS: 30_000,
	/** Default heartbeat interval in milliseconds */
	DEFAULT_HEARTBEAT_INTERVAL_MS: 10_000,
} as const;

// =============================================================================
// HTTP Constraints
// =============================================================================

/** Request timeout for HTTP_GET_JSON in milliseconds */
export const HTTP_REQUEST_TIMEOUT_MS = 30_000;
/** Maximum body size for HTTP_GET_JSON responses in characters */
export const HTTP_BODY_MAX_CHARS = 10_240;

/**
 * Grouped HTTP-related constraints.
 * Prefer using this object for new code.
 */
export const HTTP_CONSTRAINTS = {
	/** Request timeout in milliseconds */
	REQUEST_TIMEOUT_MS: 30_000,
	/** Maximum body size in characters */
	BODY_MAX_CHARS: 10_240,
} as const;

// =============================================================================
// Agent Configuration
// =============================================================================

/** Default directory for agent state/journal files */
export const DEFAULT_AGENT_STATE_DIR = ".agent-state";

/**
 * Grouped agent configuration constants.
 * Prefer using this object for new code.
 */
export const AGENT_CONFIG = {
	/** Default directory for agent state/journal files */
	DEFAULT_STATE_DIR: ".agent-state",
} as const;
