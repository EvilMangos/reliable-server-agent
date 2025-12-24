/**
 * Shared constants for server and agent
 */

// Lease defaults
export const DEFAULT_LEASE_MS = 30_000;
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;

// HTTP_GET_JSON constraints
export const HTTP_REQUEST_TIMEOUT_MS = 30_000;
export const HTTP_BODY_MAX_CHARS = 10_240;

// Agent state directory
export const DEFAULT_AGENT_STATE_DIR = ".agent-state";
