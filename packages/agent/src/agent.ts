import type {
	ClaimCommandResponse,
	CommandResult,
	DelayPayload,
	DelayResult,
	HttpGetJsonPayload,
} from "@reliable-server-agent/shared";
import type { Agent, AgentConfig, DelayExecutionContext, HttpGetJsonExecutionContext } from "./types";
import { HeartbeatManagerImpl } from "./heartbeat";
import { JournalManagerImpl } from "./journal";
import { LoggerImpl } from "./logger";
import { formatError } from "./utils";
import { ServerClientImpl } from "./server-client";
import { executeDelay } from "./executors";
import { executeHttpGetJson } from "./executors";
import { sleep } from "./utils";
import type { HeartbeatManager } from "./types";
import type { JournalManager } from "./types";
import type { ServerClient } from "./types";

const logger = new LoggerImpl("agent");

/**
 * Agent implementation that polls for work and executes commands.
 */
export class AgentImpl implements Agent {
	private readonly serverClient: ServerClient;
	private readonly journalManager: JournalManager;
	private readonly heartbeatManager: HeartbeatManager;
	private running = false;
	private killTimeout: ReturnType<typeof setTimeout> | null = null;

	constructor(private readonly config: AgentConfig) {
		this.serverClient = new ServerClientImpl(config);
		this.journalManager = new JournalManagerImpl(config.stateDir, config.agentId);
		this.heartbeatManager = new HeartbeatManagerImpl(this.serverClient, config.heartbeatIntervalMs);
	}

	/**
	 * Recover from any saved journal state on startup.
	 */
	async recoverFromJournal(): Promise<void> {
		const journal = this.journalManager.load();
		if (!journal) {
			logger.debug("No journal found, starting fresh");
			return;
		}

		logger.info(`Recovering from journal: command=${journal.commandId}, stage=${journal.stage}`);

		// Start heartbeat for the saved command
		this.heartbeatManager.start(journal.commandId, journal.leaseId);

		try {
			if (journal.stage === "RESULT_SAVED") {
				// We have a saved result, try to report it
				const result = journal.type === "HTTP_GET_JSON" && journal.httpSnapshot
					? journal.httpSnapshot
					: this.computeDelayResult(journal);

				await this.reportCompletion(journal.commandId, journal.leaseId, result);
			} else if (journal.type === "DELAY" && journal.scheduledEndAt !== null) {
				// Resume DELAY command
				const context: DelayExecutionContext = {
					journal,
					journalManager: this.journalManager,
					checkLeaseValid: () => this.heartbeatManager.isLeaseValid(),
					onRandomFailure: this.config.randomFailures ? this.simulateRandomFailure : undefined,
				};

				try {
					const result = await executeDelay({ ms: journal.scheduledEndAt - journal.startedAt }, context);
					// Save stage to RESULT_SAVED before reporting (idempotency)
					this.journalManager.updateStage(journal, "RESULT_SAVED");
					await this.reportCompletion(journal.commandId, journal.leaseId, result);
				} catch (err) {
					// Lease expired or other error - delete journal and move on
					logger.warn(`Recovery failed: ${formatError(err)}`);
					this.journalManager.delete();
				}
			} else {
				// Unknown state, delete journal and move on
				logger.warn("Unknown journal state, deleting and moving on");
				this.journalManager.delete();
			}
		} finally {
			this.heartbeatManager.stop();
		}
	}

	/**
	 * Run one iteration of the claim-execute-report cycle.
	 */
	async runOneIteration(): Promise<void> {
		// Try to claim a command
		let claimed: ClaimCommandResponse | null;
		try {
			claimed = await this.serverClient.claim();
		} catch (err) {
			logger.error(`Claim failed: ${formatError(err)}`);
			return;
		}

		if (!claimed) {
			// No work available (204)
			return;
		}

		const { commandId, type, payload, leaseId, startedAt, scheduledEndAt } = claimed;

		// Create journal entry
		const journal = this.journalManager.createClaimed(commandId, leaseId, type, startedAt, scheduledEndAt);

		// Start heartbeat
		this.heartbeatManager.start(commandId, leaseId);

		try {
			let result: CommandResult;

			if (type === "DELAY") {
				const context: DelayExecutionContext = {
					journal,
					journalManager: this.journalManager,
					checkLeaseValid: () => this.heartbeatManager.isLeaseValid(),
					onRandomFailure: this.config.randomFailures ? this.simulateRandomFailure : undefined,
				};
				result = await executeDelay(payload as DelayPayload, context);
				// Save stage to RESULT_SAVED before reporting (idempotency)
				this.journalManager.updateStage(journal, "RESULT_SAVED");
			} else if (type === "HTTP_GET_JSON") {
				const context: HttpGetJsonExecutionContext = {
					journal,
					journalManager: this.journalManager,
					onRandomFailure: this.config.randomFailures ? this.simulateRandomFailure : undefined,
				};
				result = await executeHttpGetJson(payload as HttpGetJsonPayload, context);
				// Note: HTTP_GET_JSON executor already saves httpSnapshot with RESULT_SAVED stage
			} else {
				throw new Error(`Unknown command type: ${type}`);
			}

			// Stop heartbeat before reporting
			this.heartbeatManager.stop();

			// Report completion
			await this.reportCompletion(commandId, leaseId, result);
		} catch (err) {
			this.heartbeatManager.stop();
			logger.error(`Command ${commandId} execution failed: ${formatError(err)}`);
			// Don't report failure for lease expiry - just delete journal and move on
			if (err instanceof Error && err.message.includes("lease")) {
				this.journalManager.delete();
			} else {
				// For unexpected errors, log and delete journal to prevent getting stuck
				// Agent continues running - this is more fault-tolerant than crashing
				logger.error(`Unexpected error, deleting journal and continuing: ${formatError(err)}`);
				this.journalManager.delete();
			}
		}
	}

	/**
	 * Start the agent's main loop.
	 */
	async start(): Promise<void> {
		this.running = true;
		logger.info(`Agent ${this.config.agentId} starting`);

		// Set up kill timeout if configured
		if (this.config.killAfterSeconds !== null) {
			this.killTimeout = setTimeout(() => {
				logger.info(`Kill timeout reached after ${this.config.killAfterSeconds} seconds`);
				process.exit(0);
			}, this.config.killAfterSeconds * 1000);
		}

		// Try to recover from journal
		await this.recoverFromJournal();

		// Main polling loop
		while (this.running) {
			try {
				await this.runOneIteration();
			} catch (err) {
				// Catch any unexpected errors to prevent agent crash
				logger.error(`Unexpected error in main loop: ${formatError(err)}`);
				// Continue running - agent should be fault-tolerant
			}
			await sleep(this.config.pollIntervalMs);
		}
	}

	/**
	 * Stop the agent.
	 */
	stop(): void {
		this.running = false;
		this.heartbeatManager.stop();
		if (this.killTimeout !== null) {
			clearTimeout(this.killTimeout);
			this.killTimeout = null;
		}
		logger.info("Agent stopped");
	}

	/**
	 * Compute a DELAY result from journal state.
	 */
	private computeDelayResult(journal: { startedAt: number; scheduledEndAt: number | null }): DelayResult {
		const tookMs = journal.scheduledEndAt
			? journal.scheduledEndAt - journal.startedAt
			: Date.now() - journal.startedAt;
		return { ok: true, tookMs };
	}

	/**
	 * Report completion to the server and handle the response.
	 */
	private async reportCompletion(commandId: string, leaseId: string, result: CommandResult): Promise<void> {
		const success = await this.serverClient.complete(commandId, leaseId, result);
		if (success) {
			logger.info(`Command ${commandId} completed successfully`);
		} else {
			logger.warn(`Command ${commandId} completion rejected (409 or error)`);
		}
		// Delete journal regardless of success (409 means lease is stale)
		this.journalManager.delete();
	}

	/**
	 * Simulate a random failure by exiting the process.
	 */
	private simulateRandomFailure(): void {
		logger.warn("Random failure triggered - exiting process");
		process.exit(1);
	}
}
