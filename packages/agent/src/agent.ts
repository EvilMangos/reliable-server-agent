import type {
	ClaimCommandResponse,
	CommandPayload,
	CommandResult,
	DelayResult,
} from "@reliable-server-agent/shared";
import { COMMAND_TYPE } from "@reliable-server-agent/shared";
import type { Agent, AgentConfig, HeartbeatManager, JournalManager, Logger, ServerClient } from "./types";
import type { ExecutorRegistry } from "./di";
import { HeartbeatManagerImpl } from "./heartbeat";
import { JournalManagerImpl } from "./journal";
import { LoggerImpl } from "./logger";
import { formatError, sleep } from "./utils";
import { ServerClientImpl } from "./server-client";
import { DelayExecutor, HttpGetJsonExecutor } from "./executors";

/**
 * Agent implementation that polls for work and executes commands.
 */
export class AgentImpl implements Agent {
	private readonly logger: Logger;
	private readonly serverClient: ServerClient;
	private readonly journalManager: JournalManager;
	private readonly heartbeatManager: HeartbeatManager;
	private readonly executorRegistry: ExecutorRegistry;
	private running = false;
	private killTimeout: ReturnType<typeof setTimeout> | null = null;

	/**
	 * Create a new agent with injected dependencies.
	 * For backwards compatibility, dependencies are optional and will be created if not provided.
	 */
	constructor(
		private readonly config: AgentConfig,
		logger?: Logger,
		serverClient?: ServerClient,
		journalManager?: JournalManager,
		heartbeatManager?: HeartbeatManager,
		executorRegistry?: ExecutorRegistry,
	) {
		this.logger = logger ?? new LoggerImpl("agent");
		this.serverClient = serverClient ?? new ServerClientImpl(config);
		this.journalManager = journalManager ?? new JournalManagerImpl(config.stateDir, config.agentId);
		this.heartbeatManager = heartbeatManager ?? new HeartbeatManagerImpl(
			this.serverClient,
			config.heartbeatIntervalMs,
		);

		// Build executor registry if not provided
		if (executorRegistry) {
			this.executorRegistry = executorRegistry;
		} else {
			const onRandomFailure = config.randomFailures ? this.simulateRandomFailure.bind(this) : undefined;
			this.executorRegistry = new Map();
			this.executorRegistry.set(
				COMMAND_TYPE.DELAY,
				new DelayExecutor(this.logger, this.journalManager, onRandomFailure),
			);
			this.executorRegistry.set(
				COMMAND_TYPE.HTTP_GET_JSON,
				new HttpGetJsonExecutor(this.logger, this.journalManager, onRandomFailure),
			);
		}
	}

	/**
	 * Recover from any saved journal state on startup.
	 */
	async recoverFromJournal(): Promise<void> {
		const journal = this.journalManager.load();
		if (!journal) {
			this.logger.debug("No journal found, starting fresh");
			return;
		}

		this.logger.info(`Recovering from journal: command=${journal.commandId}, stage=${journal.stage}`);

		// Start heartbeat for the saved command
		this.heartbeatManager.start(journal.commandId, journal.leaseId);

		try {
			if (journal.stage === "RESULT_SAVED") {
				// We have a saved result, try to report it
				const result = journal.type === COMMAND_TYPE.HTTP_GET_JSON && journal.httpSnapshot
					? journal.httpSnapshot
					: this.computeDelayResult(journal);

				await this.reportCompletion(journal.commandId, journal.leaseId, result);
			} else if (journal.type === COMMAND_TYPE.DELAY && journal.scheduledEndAt !== null) {
				// Resume DELAY command
				const executor = this.executorRegistry.get(COMMAND_TYPE.DELAY);
				if (!executor) {
					this.logger.error("No executor registered for DELAY command type");
					this.journalManager.delete();
					return;
				}
				try {
					const result = await executor.execute(
						{ ms: journal.scheduledEndAt - journal.startedAt },
						{ journal, checkLeaseValid: () => this.heartbeatManager.isLeaseValid() },
					);
					// Save stage to RESULT_SAVED before reporting (idempotency)
					this.journalManager.updateStage(journal, "RESULT_SAVED");
					await this.reportCompletion(journal.commandId, journal.leaseId, result);
				} catch (err) {
					// Lease expired or other error - delete journal and move on
					this.logger.warn(`Recovery failed: ${formatError(err)}`);
					this.journalManager.delete();
				}
			} else {
				// Unknown state, delete journal and move on
				this.logger.warn("Unknown journal state, deleting and moving on");
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
			this.logger.error(`Claim failed: ${formatError(err)}`);
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
			// Get executor for command type
			const executor = this.executorRegistry.get(type);
			if (!executor) {
				throw new Error(`No executor registered for command type: ${type}`);
			}

			// Execute the command
			const result = await executor.execute(
				payload as CommandPayload,
				{ journal, checkLeaseValid: () => this.heartbeatManager.isLeaseValid() },
			);

			// For DELAY commands, save stage to RESULT_SAVED before reporting (idempotency)
			// HTTP_GET_JSON executor already saves httpSnapshot with RESULT_SAVED stage
			if (type === COMMAND_TYPE.DELAY) {
				this.journalManager.updateStage(journal, "RESULT_SAVED");
			}

			// Stop heartbeat before reporting
			this.heartbeatManager.stop();

			// Report completion
			await this.reportCompletion(commandId, leaseId, result);
		} catch (err) {
			this.heartbeatManager.stop();
			this.logger.error(`Command ${commandId} execution failed: ${formatError(err)}`);
			// Don't report failure for lease expiry - just delete journal and move on
			if (err instanceof Error && err.message.includes("lease")) {
				this.journalManager.delete();
			} else {
				// For unexpected errors, log and delete journal to prevent getting stuck
				// Agent continues running - this is more fault-tolerant than crashing
				this.logger.error(`Unexpected error, deleting journal and continuing: ${formatError(err)}`);
				this.journalManager.delete();
			}
		}
	}

	/**
	 * Start the agent's main loop.
	 */
	async start(): Promise<void> {
		this.running = true;
		this.logger.info(`Agent ${this.config.agentId} starting`);

		// Set up kill timeout if configured
		if (this.config.killAfterSeconds !== null) {
			this.killTimeout = setTimeout(() => {
				this.logger.info(`Kill timeout reached after ${this.config.killAfterSeconds} seconds`);
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
				this.logger.error(`Unexpected error in main loop: ${formatError(err)}`);
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
		this.logger.info("Agent stopped");
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
			this.logger.info(`Command ${commandId} completed successfully`);
		} else {
			this.logger.warn(`Command ${commandId} completion rejected (409 or error)`);
		}
		// Delete journal regardless of success (409 means lease is stale)
		this.journalManager.delete();
	}

	/**
	 * Simulate a random failure by exiting the process.
	 */
	private simulateRandomFailure(): void {
		this.logger.warn("Random failure triggered - exiting process");
		process.exit(1);
	}
}
