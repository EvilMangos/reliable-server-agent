/**
 * Thrown when request validation fails (missing or invalid fields)
 */
export class ValidationError extends Error {
	readonly statusCode = 400;

	constructor(message: string) {
		super(message);
		this.name = "ValidationError";
	}
}
