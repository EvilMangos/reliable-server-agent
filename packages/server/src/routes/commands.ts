import { type Request, type Response, Router } from "express";
import type {
	ClaimCommandRequest,
	ClaimCommandResponse,
	CompleteRequest,
	CreateCommandRequest,
	FailRequest,
	GetCommandResponse,
	HeartbeatRequest,
} from "@reliable-server-agent/shared";
import type { CommandService } from "../service/index.js";
import { asyncHandler } from "./middleware/index.js";
import { ValidationError } from "./errors/index.js";
import { requireLeaseRequest, requireNumber, requireString } from "./utils/index.js";

/**
 * Create command routes using the service layer
 *
 * All handlers use asyncHandler wrapper which forwards errors to the
 * centralized error middleware. Validation errors throw ValidationError,
 * and service errors are propagated directly.
 */
export function createCommandRoutes(service: CommandService): Router {
	const router = Router();

	// POST /commands - Create a new command
	router.post(
		"/",
		asyncHandler((req: Request, res: Response) => {
			const { type, payload } = req.body as CreateCommandRequest;

			if (!type || !payload) {
				throw new ValidationError("Missing type or payload");
			}

			const commandId = service.createCommand(type, payload);
			res.status(201).json({ commandId });
		}),
	);

	// GET /commands/:id - Get command status and result
	router.get(
		"/:id",
		asyncHandler((req: Request, res: Response) => {
			const { id } = req.params;
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
		}),
	);

	// POST /commands/claim - Agent claims a command
	router.post(
		"/claim",
		asyncHandler((req: Request, res: Response) => {
			const body = req.body as Partial<ClaimCommandRequest>;
			const agentId = requireString(body, "agentId");
			const maxLeaseMs = requireNumber(body, "maxLeaseMs");

			const claim = service.claimNextCommand(agentId, maxLeaseMs);

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
		}),
	);

	// POST /commands/:id/heartbeat - Extend lease
	router.post(
		"/:id/heartbeat",
		asyncHandler((req: Request, res: Response) => {
			const { id } = req.params;
			const { agentId, leaseId } = requireLeaseRequest(req.body);
			const extendMs = requireNumber(req.body as HeartbeatRequest, "extendMs");

			service.recordHeartbeat(id, agentId, leaseId, extendMs);
			res.status(204).send();
		}),
	);

	// POST /commands/:id/complete - Complete command with result
	router.post(
		"/:id/complete",
		asyncHandler((req: Request, res: Response) => {
			const { id } = req.params;
			const { agentId, leaseId } = requireLeaseRequest(req.body);
			const body = req.body as CompleteRequest;

			if (!body.result) {
				throw new ValidationError("Missing agentId, leaseId, or result");
			}

			service.completeCommand(id, agentId, leaseId, body.result);
			res.status(204).send();
		}),
	);

	// POST /commands/:id/fail - Fail command with error
	router.post(
		"/:id/fail",
		asyncHandler((req: Request, res: Response) => {
			const { id } = req.params;
			const { agentId, leaseId } = requireLeaseRequest(req.body);
			const body = req.body as FailRequest;

			if (!body.error) {
				throw new ValidationError("Missing agentId, leaseId, or error");
			}

			service.failCommand(id, agentId, leaseId, body.error, body.result);
			res.status(204).send();
		}),
	);

	return router;
}
