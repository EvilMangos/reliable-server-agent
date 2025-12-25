/**
 * Agent configuration module.
 *
 * Load agent configuration from CLI arguments, environment variables, and defaults.
 * Priority: CLI > Environment > Defaults
 */

import type { AgentConfig } from "../types/index.js";
import { parseCliArgs } from "./cli-parser.js";
import { getDefaultConfig } from "./defaults.js";
import { parseEnvVars } from "./env-parser.js";

/**
 * Load agent configuration from CLI arguments, environment variables, and defaults.
 * Priority: CLI > Environment > Defaults
 */
export function loadConfig(args: string[]): AgentConfig {
	const cli = parseCliArgs(args);
	const env = parseEnvVars();
	const defaults = getDefaultConfig();

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
