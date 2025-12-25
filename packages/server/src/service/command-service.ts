import { randomUUID } from "crypto";
import { injectable } from "inversify";
import { COMMAND_TYPE, type CommandPayload, type CommandResult, type CommandType } from "@reliable-server-agent/shared";
import type { ClaimCommandServiceResponse, CommandRepository, GetCommandServiceResponse } from "../contracts/index.js";
import {
	CommandNotFoundError,
	InvalidCommandTypeError,
	InvalidPayloadError,
	LeaseConflictError,
} from "./errors/index.js";

/**
 * Service layer for command operations
 *
 * Encapsulates business logic including:
 * - UUID generation for commands and leases
 * - Timestamp management via injectable clock
 * - Payload validation
 * - JSON parsing/serialization
 * - Domain error handling
 */
@injectable()
export class CommandService {
	private db: CommandRepository;
	private clock: () => number;

	constructor(db: CommandRepository, clock?: () => number) {
		this.db = db;
		this.clock = clock ?? (() => Date.now());
	}

	/**
	 * Create a new command
	 * @throws InvalidCommandTypeError if type is invalid
	 * @throws InvalidPayloadError if payload is invalid
	 */
	createCommand(type: CommandType, payload: CommandPayload): string {
		// Validate command type
		if (type !== COMMAND_TYPE.DELAY && type !== COMMAND_TYPE.HTTP_GET_JSON) {
			throw new InvalidCommandTypeError(type);
		}

		// Validate payload exists
		if (payload === null || payload === undefined) {
			throw new InvalidPayloadError("Payload is required");
		}

		// Validate payload fields based on type
		if (type === COMMAND_TYPE.DELAY) {
			const delayPayload = payload as { ms?: unknown };
			if (typeof delayPayload.ms !== "number") {
				throw new InvalidPayloadError("DELAY command requires 'ms' field as a number");
			}
		} else if (type === COMMAND_TYPE.HTTP_GET_JSON) {
			const httpPayload = payload as { url?: unknown };
			if (typeof httpPayload.url !== "string") {
				throw new InvalidPayloadError("HTTP_GET_JSON command requires 'url' field as a string");
			}
		}

		const commandId = randomUUID();
		const now = this.clock();

		const record = this.db.createCommand(commandId, type, payload, now);
		return record.id;
	}

	/**
	 * Get command details by ID
	 * @throws CommandNotFoundError if command does not exist
	 */
	getCommand(id: string): GetCommandServiceResponse {
		const command = this.db.getCommand(id);

		if (!command) {
			throw new CommandNotFoundError(id);
		}

		const response: GetCommandServiceResponse = {
			status: command.status,
		};

		if (command.resultJson) {
			response.result = JSON.parse(command.resultJson);
		}

		if (command.agentId) {
			response.agentId = command.agentId;
		}

		return response;
	}

	/**
	 * Claim the next available command for an agent
	 * @returns Claim response or null if no commands available
	 */
	claimNextCommand(agentId: string, maxLeaseMs: number): ClaimCommandServiceResponse | null {
		const leaseId = randomUUID();
		const now = this.clock();

		const command = this.db.claimCommand(agentId, leaseId, maxLeaseMs, now);

		if (!command) {
			return null;
		}

		const payload = JSON.parse(command.payloadJson) as CommandPayload;

		return {
			commandId: command.id,
			type: command.type,
			payload,
			leaseId: command.leaseId!,
			leaseExpiresAt: command.leaseExpiresAt!,
			startedAt: command.startedAt!,
			scheduledEndAt: command.scheduledEndAt,
		};
	}

	/**
	 * Record a heartbeat to extend a command's lease
	 * @throws LeaseConflictError if lease is not current
	 */
	recordHeartbeat(commandId: string, agentId: string, leaseId: string, extendMs: number): void {
		const now = this.clock();

		const success = this.db.heartbeat(commandId, agentId, leaseId, extendMs, now);

		if (!success) {
			throw new LeaseConflictError(commandId, leaseId);
		}
	}

	/**
	 * Complete a command with a result
	 * @throws LeaseConflictError if lease is not current
	 */
	completeCommand(commandId: string, agentId: string, leaseId: string, result: CommandResult): void {
		const success = this.db.completeCommand(commandId, agentId, leaseId, result);

		if (!success) {
			throw new LeaseConflictError(commandId, leaseId);
		}
	}

	/**
	 * Fail a command with an error
	 * @throws LeaseConflictError if lease is not current
	 */
	failCommand(commandId: string, agentId: string, leaseId: string, error: string, result?: CommandResult): void {
		const success = this.db.failCommand(commandId, agentId, leaseId, error, result);

		if (!success) {
			throw new LeaseConflictError(commandId, leaseId);
		}
	}

	/**
	 * Reset expired leases back to PENDING status
	 * @returns Number of commands reset
	 */
	resetExpiredLeases(): number {
		const now = this.clock();
		return this.db.resetExpiredLeases(now);
	}
}
