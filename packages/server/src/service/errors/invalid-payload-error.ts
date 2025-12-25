import { ServiceError } from "./service-error.js";

/**
 * Thrown when a command payload is invalid or missing required fields
 */
export class InvalidPayloadError extends ServiceError {
	constructor(message: string) {
		super(`Invalid payload: ${message}`);
	}
}
