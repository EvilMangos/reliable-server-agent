import { type Request, type Response, Router } from "express";
import { randomUUID } from "crypto";
import type {
	ClaimCommandRequest,
	ClaimCommandResponse,
	CommandPayload,
	CompleteRequest,
	CreateCommandRequest,
	CreateCommandResponse,
	FailRequest,
	GetCommandResponse,
	HeartbeatRequest,
} from "@reliable-server-agent/shared";
import type { CommandDatabase } from "../store/database.js";

/**
 * Create command routes
 */
export function createCommandRoutes(db: CommandDatabase): Router {
	const router = Router();

	// POST /commands - Create a new command
	router.post("/", (req: Request, res: Response) => {
		const body = req.body as CreateCommandRequest;

		if (!body.type || !body.payload) {
			res.status(400).json({ error: "Missing type or payload" });
			return;
		}

		if (body.type !== "DELAY" && body.type !== "HTTP_GET_JSON") {
			res.status(400).json({ error: "Invalid command type" });
			return;
		}

		const commandId = randomUUID();
		const now = Date.now();

		try {
			db.createCommand(commandId, body.type, body.payload, now);
			const response: CreateCommandResponse = { commandId };
			res.status(201).json(response);
		} catch (error) {
			console.error("Failed to create command:", error);
			res.status(500).json({ error: "Failed to create command" });
		}
	});

	// GET /commands/:id - Get command status and result
	router.get("/:id", (req: Request, res: Response) => {
		const { id } = req.params;

		const command = db.getCommand(id);
		if (!command) {
			res.status(404).json({ error: "Command not found" });
			return;
		}

		const response: GetCommandResponse = {
			status: command.status,
		};

		if (command.resultJson) {
			response.result = JSON.parse(command.resultJson);
		}

		if (command.agentId) {
			response.agentId = command.agentId;
		}

		res.json(response);
	});

	// POST /commands/claim - Agent claims a command
	router.post("/claim", (req: Request, res: Response) => {
		const body = req.body as ClaimCommandRequest;

		if (!body.agentId || typeof body.maxLeaseMs !== "number") {
			res.status(400).json({ error: "Missing agentId or maxLeaseMs" });
			return;
		}

		const leaseId = randomUUID();
		const now = Date.now();

		try {
			const command = db.claimCommand(body.agentId, leaseId, body.maxLeaseMs, now);

			if (!command) {
				res.status(204).send();
				return;
			}

			const payload = JSON.parse(command.payloadJson) as CommandPayload;
			const response: ClaimCommandResponse = {
				commandId: command.id,
				type: command.type,
				payload,
				leaseId: command.leaseId!,
				leaseExpiresAt: command.leaseExpiresAt!,
				startedAt: command.startedAt!,
				scheduledEndAt: command.scheduledEndAt,
			};

			res.json(response);
		} catch (error) {
			console.error("Failed to claim command:", error);
			res.status(500).json({ error: "Failed to claim command" });
		}
	});

	// POST /commands/:id/heartbeat - Extend lease
	router.post("/:id/heartbeat", (req: Request, res: Response) => {
		const { id } = req.params;
		const body = req.body as HeartbeatRequest;

		if (!body.agentId || !body.leaseId || typeof body.extendMs !== "number") {
			res.status(400).json({ error: "Missing agentId, leaseId, or extendMs" });
			return;
		}

		const now = Date.now();

		try {
			const success = db.heartbeat(id, body.agentId, body.leaseId, body.extendMs, now);

			if (!success) {
				res.status(409).json({ error: "Lease is not current" });
				return;
			}

			res.status(204).send();
		} catch (error) {
			console.error("Failed to heartbeat:", error);
			res.status(500).json({ error: "Failed to heartbeat" });
		}
	});

	// POST /commands/:id/complete - Complete command with result
	router.post("/:id/complete", (req: Request, res: Response) => {
		const { id } = req.params;
		const body = req.body as CompleteRequest;

		if (!body.agentId || !body.leaseId || !body.result) {
			res.status(400).json({ error: "Missing agentId, leaseId, or result" });
			return;
		}

		try {
			const success = db.completeCommand(id, body.agentId, body.leaseId, body.result);

			if (!success) {
				res.status(409).json({ error: "Lease is not current" });
				return;
			}

			res.status(204).send();
		} catch (error) {
			console.error("Failed to complete command:", error);
			res.status(500).json({ error: "Failed to complete command" });
		}
	});

	// POST /commands/:id/fail - Fail command with error
	router.post("/:id/fail", (req: Request, res: Response) => {
		const { id } = req.params;
		const body = req.body as FailRequest;

		if (!body.agentId || !body.leaseId || !body.error) {
			res.status(400).json({ error: "Missing agentId, leaseId, or error" });
			return;
		}

		try {
			const success = db.failCommand(id, body.agentId, body.leaseId, body.error, body.result);

			if (!success) {
				res.status(409).json({ error: "Lease is not current" });
				return;
			}

			res.status(204).send();
		} catch (error) {
			console.error("Failed to fail command:", error);
			res.status(500).json({ error: "Failed to fail command" });
		}
	});

	return router;
}
