/**
 * CLI entry point for the agent.
 * This module handles command-line execution of the agent.
 */

import { loadConfig } from "./config/index.js";
import { createAgent } from "./di/index.js";

/**
 * Check if this module is being run directly (as CLI entry point).
 * This is more robust than checking filename endings.
 */
function isMainModule(): boolean {
	const scriptPath = process.argv[1];
	if (!scriptPath) {
		return false;
	}
	// Check if the script path contains our module name
	// Works for both .js (compiled) and .ts (tsx) execution
	return scriptPath.includes("packages/agent") && (
		scriptPath.endsWith("cli.js") ||
		scriptPath.endsWith("cli.ts") ||
		scriptPath.endsWith("index.js") ||
		scriptPath.endsWith("index.ts")
	);
}

// CLI entry point
if (isMainModule()) {
	const config = loadConfig(process.argv.slice(2));
	const agent = createAgent(config);
	agent.start().catch((err: Error) => {
		console.error("Agent failed:", err);
		process.exit(1);
	});
}
