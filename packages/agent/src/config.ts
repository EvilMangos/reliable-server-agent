import { randomBytes } from "node:crypto";

/**
 * Agent configuration used throughout the agent lifecycle.
 * Values are populated from CLI arguments, environment variables, or defaults.
 */
export interface AgentConfig {
	agentId: string;
	serverUrl: string;
	stateDir: string;
	maxLeaseMs: number;
	heartbeatIntervalMs: number;
	pollIntervalMs: number;
	killAfterSeconds: number | null;
	randomFailures: boolean;
}

interface ParsedArgs {
	agentId?: string;
	serverUrl?: string;
	stateDir?: string;
	maxLeaseMs?: number;
	heartbeatIntervalMs?: number;
	pollIntervalMs?: number;
	killAfterSeconds?: number;
	randomFailures?: boolean;
}

function parseCliArgs(args: string[]): ParsedArgs {
	const parsed: ParsedArgs = {};

	for (const arg of args) {
		if (arg.startsWith("--agent-id=")) {
			parsed.agentId = arg.slice("--agent-id=".length);
		} else if (arg.startsWith("--server-url=")) {
			parsed.serverUrl = arg.slice("--server-url=".length);
		} else if (arg.startsWith("--state-dir=")) {
			parsed.stateDir = arg.slice("--state-dir=".length);
		} else if (arg.startsWith("--max-lease-ms=")) {
			const value = parseInt(arg.slice("--max-lease-ms=".length), 10);
			if (!isNaN(value)) {
				parsed.maxLeaseMs = value;
			}
		} else if (arg.startsWith("--heartbeat-interval-ms=")) {
			const value = parseInt(arg.slice("--heartbeat-interval-ms=".length), 10);
			if (!isNaN(value)) {
				parsed.heartbeatIntervalMs = value;
			}
		} else if (arg.startsWith("--poll-interval-ms=")) {
			const value = parseInt(arg.slice("--poll-interval-ms=".length), 10);
			if (!isNaN(value)) {
				parsed.pollIntervalMs = value;
			}
		} else if (arg.startsWith("--kill-after=")) {
			const value = parseInt(arg.slice("--kill-after=".length), 10);
			if (!isNaN(value)) {
				parsed.killAfterSeconds = value;
			}
		} else if (arg === "--random-failures") {
			parsed.randomFailures = true;
		}
	}

	return parsed;
}

function parseEnvNumber(key: string): number | undefined {
	const value = process.env[key];
	if (value === undefined) {
		return undefined;
	}
	const parsed = parseInt(value, 10);
	return isNaN(parsed) ? undefined : parsed;
}

function generateAgentId(): string {
	return `agent-${randomBytes(4).toString("hex")}`;
}

/**
 * Load agent configuration from CLI arguments, environment variables, and defaults.
 * Priority: CLI > Environment > Defaults
 */
export function loadConfig(args: string[]): AgentConfig {
	const cli = parseCliArgs(args);

	// Defaults
	const defaults: AgentConfig = {
		agentId: generateAgentId(),
		serverUrl: "http://localhost:3000",
		stateDir: ".agent-state",
		maxLeaseMs: 30000,
		heartbeatIntervalMs: 10000,
		pollIntervalMs: 1000,
		killAfterSeconds: null,
		randomFailures: false,
	};

	// Environment variables
	const env = {
		agentId: process.env.AGENT_ID,
		serverUrl: process.env.SERVER_URL,
		stateDir: process.env.AGENT_STATE_DIR,
		maxLeaseMs: parseEnvNumber("MAX_LEASE_MS"),
		heartbeatIntervalMs: parseEnvNumber("HEARTBEAT_INTERVAL_MS"),
		pollIntervalMs: parseEnvNumber("POLL_INTERVAL_MS"),
	};

	// Merge with priority: CLI > Environment > Defaults
	return {
		agentId: cli.agentId ?? env.agentId ?? defaults.agentId,
		serverUrl: cli.serverUrl ?? env.serverUrl ?? defaults.serverUrl,
		stateDir: cli.stateDir ?? env.stateDir ?? defaults.stateDir,
		maxLeaseMs: cli.maxLeaseMs ?? env.maxLeaseMs ?? defaults.maxLeaseMs,
		heartbeatIntervalMs: cli.heartbeatIntervalMs ?? env.heartbeatIntervalMs ?? defaults.heartbeatIntervalMs,
		pollIntervalMs: cli.pollIntervalMs ?? env.pollIntervalMs ?? defaults.pollIntervalMs,
		killAfterSeconds: cli.killAfterSeconds ?? defaults.killAfterSeconds,
		randomFailures: cli.randomFailures ?? defaults.randomFailures,
	};
}
