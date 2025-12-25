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
