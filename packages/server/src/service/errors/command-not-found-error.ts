import { ServiceError } from "./service-error.js";

/**
 * Thrown when a command is not found in the database
 */
export class CommandNotFoundError extends ServiceError {
	constructor(commandId: string) {
		super(`Command not found: ${commandId}`);
	}
}
