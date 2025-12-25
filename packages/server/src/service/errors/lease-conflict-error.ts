import { ServiceError } from "./service-error.js";

/**
 * Thrown when a lease operation fails due to stale or invalid lease
 */
export class LeaseConflictError extends ServiceError {
	constructor(commandId: string, leaseId: string) {
		super(`Lease conflict for command ${commandId} with lease ${leaseId}`);
	}
}
