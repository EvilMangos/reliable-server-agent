/**
 * Default configuration values for the agent.
 */

import type { AgentConfig } from "../types/index.js";
import { generateAgentId } from "./agent-id.js";

export function getDefaultConfig(): AgentConfig {
	return {
		agentId: generateAgentId(),
		serverUrl: "http://localhost:3000",
		stateDir: ".agent-state",
		maxLeaseMs: 30000,
		heartbeatIntervalMs: 10000,
		pollIntervalMs: 1000,
		killAfterSeconds: null,
		randomFailures: false,
	};
}
