/**
 * API Client for E2E Tests
 *
 * Provides typed HTTP client for interacting with the Control Server API.
 */

import type {
	ClaimCommandRequest,
	ClaimCommandResponse,
	CompleteRequest,
	CreateCommandRequest,
	CreateCommandResponse,
	FailRequest,
	GetCommandResponse,
	HeartbeatRequest,
} from "@reliable-server-agent/shared";

export interface ApiClient {
	baseUrl: string;

	// Public API
	createCommand(request: CreateCommandRequest): Promise<CreateCommandResponse>;
	getCommand(commandId: string): Promise<GetCommandResponse>;

	// Internal Agent API
	claimCommand(request: ClaimCommandRequest): Promise<ClaimCommandResponse | null>;
	heartbeat(commandId: string, request: HeartbeatRequest): Promise<boolean>;
	completeCommand(commandId: string, request: CompleteRequest): Promise<boolean>;
	failCommand(commandId: string, request: FailRequest): Promise<boolean>;
}

/**
 * Create an API client for the Control Server
 */
export function createApiClient(baseUrl: string): ApiClient {
	async function createCommand(request: CreateCommandRequest): Promise<CreateCommandResponse> {
		const response = await fetch(`${baseUrl}/commands`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(request),
		});

		if (!response.ok) {
			throw new Error(`Failed to create command: ${response.status} ${response.statusText}`);
		}

		return response.json() as Promise<CreateCommandResponse>;
	}

	async function getCommand(commandId: string): Promise<GetCommandResponse> {
		const response = await fetch(`${baseUrl}/commands/${encodeURIComponent(commandId)}`, {
			method: "GET",
		});

		if (!response.ok) {
			throw new Error(`Failed to get command: ${response.status} ${response.statusText}`);
		}

		return response.json() as Promise<GetCommandResponse>;
	}

	async function claimCommand(request: ClaimCommandRequest): Promise<ClaimCommandResponse | null> {
		const response = await fetch(`${baseUrl}/commands/claim`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(request),
		});

		if (response.status === 204) {
			return null;
		}

		if (!response.ok) {
			throw new Error(`Failed to claim command: ${response.status} ${response.statusText}`);
		}

		return response.json() as Promise<ClaimCommandResponse>;
	}

	async function heartbeat(commandId: string, request: HeartbeatRequest): Promise<boolean> {
		const response = await fetch(`${baseUrl}/commands/${encodeURIComponent(commandId)}/heartbeat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(request),
		});

		return response.status === 204;
	}

	async function completeCommand(commandId: string, request: CompleteRequest): Promise<boolean> {
		const response = await fetch(`${baseUrl}/commands/${encodeURIComponent(commandId)}/complete`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(request),
		});

		return response.status === 204;
	}

	async function failCommand(commandId: string, request: FailRequest): Promise<boolean> {
		const response = await fetch(`${baseUrl}/commands/${encodeURIComponent(commandId)}/fail`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(request),
		});

		return response.status === 204;
	}

	return {
		baseUrl,
		createCommand,
		getCommand,
		claimCommand,
		heartbeat,
		completeCommand,
		failCommand,
	};
}
