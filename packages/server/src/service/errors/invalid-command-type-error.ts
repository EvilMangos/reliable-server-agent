import { ServiceError } from "./service-error.js";

/**
 * Thrown when an invalid command type is provided
 */
export class InvalidCommandTypeError extends ServiceError {
	constructor(type: string) {
		super(`Invalid command type: ${type}`, 400);
	}
}
