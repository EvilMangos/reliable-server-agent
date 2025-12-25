/**
 * CLI argument parsing for agent configuration.
 */

export interface ParsedArgs {
	agentId?: string;
	serverUrl?: string;
	stateDir?: string;
	maxLeaseMs?: number;
	heartbeatIntervalMs?: number;
	pollIntervalMs?: number;
	killAfterSeconds?: number;
	randomFailures?: boolean;
}

export function parseCliArgs(args: string[]): ParsedArgs {
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
