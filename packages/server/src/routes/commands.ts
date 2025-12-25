import { type Request, type Response, Router } from "express";
import type {
	ClaimCommandRequest,
	ClaimCommandResponse,
	CompleteRequest,
	CreateCommandRequest,
	CreateCommandResponse,
	FailRequest,
	GetCommandResponse,
	HeartbeatRequest,
} from "@reliable-server-agent/shared";
import type { CommandService } from "../service/index.js";
import {
	CommandNotFoundError,
	InvalidCommandTypeError,
	InvalidPayloadError,
	LeaseConflictError,
} from "../service/index.js";
import { sendInternalError, sendLeaseConflict, validateLeaseRequest } from "./utils/index.js";

/**
 * Create command routes using the service layer
 */
export function createCommandRoutes(service: CommandService): Router {
	const router = Router();

	// POST /commands - Create a new command
	router.post("/", (req: Request, res: Response): void => {
		const body = req.body as CreateCommandRequest;

		if (!body.type || !body.payload) {
			res.status(400).json({ error: "Missing type or payload" });
			return;
		}

		try {
			const commandId = service.createCommand(body.type, body.payload);
			const response: CreateCommandResponse = { commandId };
			res.status(201).json(response);
		} catch (error) {
			if (error instanceof InvalidCommandTypeError) {
				res.status(400).json({ error: "Invalid command type" });
				return;
			}
			if (error instanceof InvalidPayloadError) {
				res.status(400).json({ error: error.message });
				return;
			}
			sendInternalError(res, "create command", error);
		}
	});

	// GET /commands/:id - Get command status and result
	router.get("/:id", (req: Request, res: Response): void => {
		const { id } = req.params;

		try {
			const command = service.getCommand(id);

			const response: GetCommandResponse = {
				status: command.status,
			};

			if (command.result) {
				response.result = command.result;
			}

			if (command.agentId) {
				response.agentId = command.agentId;
			}

			res.json(response);
		} catch (error) {
			if (error instanceof CommandNotFoundError) {
				res.status(404).json({ error: "Command not found" });
				return;
			}
			sendInternalError(res, "get command", error);
		}
	});

	// POST /commands/claim - Agent claims a command
	router.post("/claim", (req: Request, res: Response): void => {
		const body = req.body as Partial<ClaimCommandRequest>;

		if (!body.agentId || typeof body.maxLeaseMs !== "number") {
			res.status(400).json({ error: "Missing agentId or maxLeaseMs" });
			return;
		}

		try {
			const claim = service.claimNextCommand(body.agentId, body.maxLeaseMs);

			if (!claim) {
				res.status(204).send();
				return;
			}

			const response: ClaimCommandResponse = {
				commandId: claim.commandId,
				type: claim.type,
				payload: claim.payload,
				leaseId: claim.leaseId,
				leaseExpiresAt: claim.leaseExpiresAt,
				startedAt: claim.startedAt,
				scheduledEndAt: claim.scheduledEndAt,
			};

			res.json(response);
		} catch (error) {
			sendInternalError(res, "claim command", error);
		}
	});

	// POST /commands/:id/heartbeat - Extend lease
	router.post("/:id/heartbeat", (req: Request, res: Response): void => {
		const { id } = req.params;
		const leaseRequest = validateLeaseRequest(req.body);
		const body = req.body as Partial<HeartbeatRequest>;

		if (!leaseRequest || typeof body.extendMs !== "number") {
			res.status(400).json({ error: "Missing agentId, leaseId, or extendMs" });
			return;
		}

		try {
			service.recordHeartbeat(id, leaseRequest.agentId, leaseRequest.leaseId, body.extendMs);
			res.status(204).send();
		} catch (error) {
			if (error instanceof LeaseConflictError) {
				sendLeaseConflict(res);
				return;
			}
			sendInternalError(res, "heartbeat", error);
		}
	});

	// POST /commands/:id/complete - Complete command with result
	router.post("/:id/complete", (req: Request, res: Response): void => {
		const { id } = req.params;
		const leaseRequest = validateLeaseRequest(req.body);
		const body = req.body as CompleteRequest;

		if (!leaseRequest || !body.result) {
			res.status(400).json({ error: "Missing agentId, leaseId, or result" });
			return;
		}

		try {
			service.completeCommand(id, leaseRequest.agentId, leaseRequest.leaseId, body.result);
			res.status(204).send();
		} catch (error) {
			if (error instanceof LeaseConflictError) {
				sendLeaseConflict(res);
				return;
			}
			sendInternalError(res, "complete command", error);
		}
	});

	// POST /commands/:id/fail - Fail command with error
	router.post("/:id/fail", (req: Request, res: Response): void => {
		const { id } = req.params;
		const leaseRequest = validateLeaseRequest(req.body);
		const body = req.body as FailRequest;

		if (!leaseRequest || !body.error) {
			res.status(400).json({ error: "Missing agentId, leaseId, or error" });
			return;
		}

		try {
			service.failCommand(id, leaseRequest.agentId, leaseRequest.leaseId, body.error, body.result);
			res.status(204).send();
		} catch (error) {
			if (error instanceof LeaseConflictError) {
				sendLeaseConflict(res);
				return;
			}
			sendInternalError(res, "fail command", error);
		}
	});

	return router;
}
