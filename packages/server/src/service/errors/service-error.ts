/**
 * Base class for service layer errors
 *
 * Includes HTTP statusCode for centralized error handling in middleware.
 */
export class ServiceError extends Error {
	readonly statusCode: number;

	constructor(message: string, statusCode: number = 500) {
		super(message);
		this.name = this.constructor.name;
		this.statusCode = statusCode;
	}
}
