import type {
	ClaimCommandResponse,
	CommandResult,
	DelayPayload,
	DelayResult,
	HttpGetJsonPayload,
} from "@reliable-server-agent/shared";
import type { AgentConfig } from "./config.js";
import { createHeartbeatManager } from "./heartbeat.js";
import { createJournalManager } from "./journal.js";
import { createLogger } from "./logger.js";
import { createServerClient } from "./server-client.js";
import { type DelayExecutionContext, executeDelay } from "./executors/delay.js";
import { type HttpGetJsonExecutionContext, executeHttpGetJson } from "./executors/http-get-json.js";

export { loadConfig, type AgentConfig } from "./config.js";

const logger = createLogger("agent");

/**
 * Agent instance that processes commands from the server.
 */
export interface Agent {
	recoverFromJournal(): Promise<void>;
	runOneIteration(): Promise<void>;
	start(): Promise<void>;
	stop(): void;
}

/**
 * Create an agent that polls for work and executes commands.
 */
export function createAgent(config: AgentConfig): Agent {
	const serverClient = createServerClient(config);
	const journalManager = createJournalManager(config.stateDir, config.agentId);
	const heartbeatManager = createHeartbeatManager(serverClient, config.heartbeatIntervalMs);

	let running = false;
	let killTimeout: ReturnType<typeof setTimeout> | null = null;

	/**
	 * Recover from any saved journal state on startup.
	 */
	async function recoverFromJournal(): Promise<void> {
		const journal = journalManager.load();
		if (!journal) {
			logger.debug("No journal found, starting fresh");
			return;
		}

		logger.info(`Recovering from journal: command=${journal.commandId}, stage=${journal.stage}`);

		// Start heartbeat for the saved command
		heartbeatManager.start(journal.commandId, journal.leaseId);

		try {
			if (journal.stage === "RESULT_SAVED") {
				// We have a saved result, try to report it
				const result = journal.type === "HTTP_GET_JSON" && journal.httpSnapshot
					? journal.httpSnapshot
					: computeDelayResult(journal);

				await reportCompletion(journal.commandId, journal.leaseId, result);
			} else if (journal.type === "DELAY" && journal.scheduledEndAt !== null) {
				// Resume DELAY command
				const context: DelayExecutionContext = {
					journal,
					journalManager,
					checkLeaseValid: () => heartbeatManager.isLeaseValid(),
					onRandomFailure: config.randomFailures ? simulateRandomFailure : undefined,
				};

				try {
					const result = await executeDelay({ ms: journal.scheduledEndAt - journal.startedAt }, context);
					// Save stage to RESULT_SAVED before reporting (idempotency)
					journalManager.updateStage(journal, "RESULT_SAVED");
					await reportCompletion(journal.commandId, journal.leaseId, result);
				} catch (err) {
					// Lease expired or other error - delete journal and move on
					logger.warn(`Recovery failed: ${err instanceof Error ? err.message : String(err)}`);
					journalManager.delete();
				}
			} else {
				// Unknown state, delete journal and move on
				logger.warn("Unknown journal state, deleting and moving on");
				journalManager.delete();
			}
		} finally {
			heartbeatManager.stop();
		}
	}

	/**
	 * Compute a DELAY result from journal state.
	 */
	function computeDelayResult(journal: { startedAt: number; scheduledEndAt: number | null }): DelayResult {
		const tookMs = journal.scheduledEndAt
			? journal.scheduledEndAt - journal.startedAt
			: Date.now() - journal.startedAt;
		return { ok: true, tookMs };
	}

	/**
	 * Report completion to the server and handle the response.
	 */
	async function reportCompletion(commandId: string, leaseId: string, result: CommandResult): Promise<void> {
		const success = await serverClient.complete(commandId, leaseId, result);
		if (success) {
			logger.info(`Command ${commandId} completed successfully`);
		} else {
			logger.warn(`Command ${commandId} completion rejected (409 or error)`);
		}
		// Delete journal regardless of success (409 means lease is stale)
		journalManager.delete();
	}

	/**
	 * Run one iteration of the claim-execute-report cycle.
	 */
	async function runOneIteration(): Promise<void> {
		// Try to claim a command
		let claimed: ClaimCommandResponse | null;
		try {
			claimed = await serverClient.claim();
		} catch (err) {
			logger.error(`Claim failed: ${err instanceof Error ? err.message : String(err)}`);
			return;
		}

		if (!claimed) {
			// No work available (204)
			return;
		}

		const { commandId, type, payload, leaseId, startedAt, scheduledEndAt } = claimed;

		// Create journal entry
		const journal = journalManager.createClaimed(commandId, leaseId, type, startedAt, scheduledEndAt);

		// Start heartbeat
		heartbeatManager.start(commandId, leaseId);

		try {
			let result: CommandResult;

			if (type === "DELAY") {
				const context: DelayExecutionContext = {
					journal,
					journalManager,
					checkLeaseValid: () => heartbeatManager.isLeaseValid(),
					onRandomFailure: config.randomFailures ? simulateRandomFailure : undefined,
				};
				result = await executeDelay(payload as DelayPayload, context);
				// Save stage to RESULT_SAVED before reporting (idempotency)
				journalManager.updateStage(journal, "RESULT_SAVED");
			} else if (type === "HTTP_GET_JSON") {
				const context: HttpGetJsonExecutionContext = {
					journal,
					journalManager,
					onRandomFailure: config.randomFailures ? simulateRandomFailure : undefined,
				};
				result = await executeHttpGetJson(payload as HttpGetJsonPayload, context);
				// Note: HTTP_GET_JSON executor already saves httpSnapshot with RESULT_SAVED stage
			} else {
				throw new Error(`Unknown command type: ${type}`);
			}

			// Stop heartbeat before reporting
			heartbeatManager.stop();

			// Report completion
			await reportCompletion(commandId, leaseId, result);
		} catch (err) {
			heartbeatManager.stop();
			logger.error(`Command ${commandId} execution failed: ${err instanceof Error ? err.message : String(err)}`);
			// Don't report failure for lease expiry - just delete journal and move on
			if (err instanceof Error && err.message.includes("lease")) {
				journalManager.delete();
			} else {
				// For unexpected errors, log and delete journal to prevent getting stuck
				// Agent continues running - this is more fault-tolerant than crashing
				logger.error(`Unexpected error, deleting journal and continuing: ${err instanceof Error ? err.message : String(err)}`);
				journalManager.delete();
			}
		}
	}

	/**
	 * Simulate a random failure by exiting the process.
	 */
	function simulateRandomFailure(): void {
		logger.warn("Random failure triggered - exiting process");
		process.exit(1);
	}

	/**
	 * Start the agent's main loop.
	 */
	async function start(): Promise<void> {
		running = true;
		logger.info(`Agent ${config.agentId} starting`);

		// Set up kill timeout if configured
		if (config.killAfterSeconds !== null) {
			killTimeout = setTimeout(() => {
				logger.info(`Kill timeout reached after ${config.killAfterSeconds} seconds`);
				process.exit(0);
			}, config.killAfterSeconds * 1000);
		}

		// Try to recover from journal
		await recoverFromJournal();

		// Main polling loop
		while (running) {
			try {
				await runOneIteration();
			} catch (err) {
				// Catch any unexpected errors to prevent agent crash
				logger.error(`Unexpected error in main loop: ${err instanceof Error ? err.message : String(err)}`);
				// Continue running - agent should be fault-tolerant
			}
			await sleep(config.pollIntervalMs);
		}
	}

	/**
	 * Stop the agent.
	 */
	function stop(): void {
		running = false;
		heartbeatManager.stop();
		if (killTimeout !== null) {
			clearTimeout(killTimeout);
			killTimeout = null;
		}
		logger.info("Agent stopped");
	}

	return {
		recoverFromJournal,
		runOneIteration,
		start,
		stop,
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

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
		scriptPath.endsWith("index.js") ||
		scriptPath.endsWith("index.ts")
	);
}

// CLI entry point
if (isMainModule()) {
	const { loadConfig } = await import("./config.js");
	const config = loadConfig(process.argv.slice(2));
	const agent = createAgent(config);
	agent.start().catch(err => {
		console.error("Agent failed:", err);
		process.exit(1);
	});
}
