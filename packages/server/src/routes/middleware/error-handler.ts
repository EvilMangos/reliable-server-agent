import type { ErrorRequestHandler } from "express";
import { ServiceError } from "../../service/index.js";
import { ValidationError } from "../errors/index.js";

/**
 * Map error types to user-facing messages (keep current API contract)
 */
const ERROR_MESSAGES: Record<string, string> = {
	CommandNotFoundError: "Command not found",
	LeaseConflictError: "Lease is not current",
	InvalidCommandTypeError: "Invalid command type",
};

/**
 * Express error handler middleware
 *
 * Centralizes error-to-HTTP response mapping:
 * - ValidationError → 400 with error message
 * - ServiceError subclasses → appropriate status with mapped message
 * - Unknown errors → 500 with generic message
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
	// ValidationError uses its own message (for request validation)
	if (err instanceof ValidationError) {
		res.status(400).json({ error: err.message });
		return;
	}

	// ServiceError subclasses use mapped messages to preserve API contract
	if (err instanceof ServiceError) {
		const message = ERROR_MESSAGES[err.name] ?? err.message;
		res.status(err.statusCode).json({ error: message });
		return;
	}

	// Unknown errors - log and return generic message
	console.error("Unhandled error:", err);
	res.status(500).json({ error: "Internal server error" });
};
