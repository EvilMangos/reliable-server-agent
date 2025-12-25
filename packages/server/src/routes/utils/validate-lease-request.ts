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
