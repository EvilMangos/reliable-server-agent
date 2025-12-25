/**
 * Base class for service layer errors
 */
export class ServiceError extends Error {
	constructor(message: string) {
		super(message);
		this.name = this.constructor.name;
	}
}
