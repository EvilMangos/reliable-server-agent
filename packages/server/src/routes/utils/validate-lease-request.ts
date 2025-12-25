import { ValidationError } from "../errors/index.js";

export interface LeaseRequestBody {
	agentId: string;
	leaseId: string;
}

export function validateLeaseRequest(body: unknown): LeaseRequestBody | null {
	const b = body as Record<string, unknown>;
	if (typeof b.agentId !== "string" || typeof b.leaseId !== "string") {
		return null;
	}
	return { agentId: b.agentId, leaseId: b.leaseId };
}

/**
 * Validates and extracts lease request fields, throwing on failure
 * @throws ValidationError if agentId or leaseId is missing
 */
export function requireLeaseRequest(body: unknown): LeaseRequestBody {
	const result = validateLeaseRequest(body);
	if (!result) {
		throw new ValidationError("Missing agentId or leaseId");
	}
	return result;
}
