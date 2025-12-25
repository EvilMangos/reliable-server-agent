/**
 * Environment variable parsing utilities for agent configuration.
 */

export function parseEnvNumber(key: string): number | undefined {
	const value = process.env[key];
	if (value === undefined) {
		return undefined;
	}
	const parsed = parseInt(value, 10);
	return isNaN(parsed) ? undefined : parsed;
}

export interface ParsedEnv {
	agentId?: string;
	serverUrl?: string;
	stateDir?: string;
	maxLeaseMs?: number;
	heartbeatIntervalMs?: number;
	pollIntervalMs?: number;
}

export function parseEnvVars(): ParsedEnv {
	return {
		agentId: process.env.AGENT_ID,
		serverUrl: process.env.SERVER_URL,
		stateDir: process.env.AGENT_STATE_DIR,
		maxLeaseMs: parseEnvNumber("MAX_LEASE_MS"),
		heartbeatIntervalMs: parseEnvNumber("HEARTBEAT_INTERVAL_MS"),
		pollIntervalMs: parseEnvNumber("POLL_INTERVAL_MS"),
	};
}
