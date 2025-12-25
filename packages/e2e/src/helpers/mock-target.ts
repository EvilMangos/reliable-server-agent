/**
 * Mock Target Server for E2E Tests
 *
 * Provides a configurable HTTP server for testing HTTP_GET_JSON commands.
 * Tracks request counts and allows customizing responses.
 */

import * as http from "node:http";

export interface MockTargetConfig {
	status?: number;
	body?: unknown;
	headers?: Record<string, string>;
	delayMs?: number;
	redirect?: string;
	/** If true, the server will never respond (for testing timeouts) */
	hangForever?: boolean;
	/** If true, close the connection immediately without responding (connection reset) */
	closeImmediately?: boolean;
}

export interface MockTargetServer {
	url: string;
	port: number;
	requestCount: number;
	getRequestCount(): number;
	resetRequestCount(): void;
	setResponse(config: MockTargetConfig): void;
	close(): Promise<void>;
}

/**
 * Create a mock HTTP target server for testing HTTP_GET_JSON
 */
export async function createMockTarget(
	initialConfig: MockTargetConfig = {},
): Promise<MockTargetServer> {
	let config: MockTargetConfig = { ...initialConfig };
	let requestCount = 0;

	const server = http.createServer(async (req, res) => {
		requestCount++;

		// Handle connection reset simulation
		if (config.closeImmediately) {
			req.socket.destroy();
			return;
		}

		// Handle hang forever (for timeout testing)
		if (config.hangForever) {
			// Never respond - connection will eventually time out on client side
			return;
		}

		// Apply delay if configured
		if (config.delayMs) {
			await new Promise((resolve) => setTimeout(resolve, config.delayMs));
		}

		// Handle redirect
		if (config.redirect) {
			res.writeHead(302, { Location: config.redirect });
			res.end();
			return;
		}

		// Set custom headers
		if (config.headers) {
			for (const [key, value] of Object.entries(config.headers)) {
				res.setHeader(key, value);
			}
		}

		// Set content type to JSON by default
		if (!config.headers?.["Content-Type"]) {
			res.setHeader("Content-Type", "application/json");
		}

		const status = config.status ?? 200;
		res.writeHead(status);

		if (config.body !== undefined) {
			const bodyStr =
				typeof config.body === "string" ? config.body : JSON.stringify(config.body);
			res.end(bodyStr);
		} else {
			res.end(JSON.stringify({ success: true }));
		}
	});

	// Start server on ephemeral port
	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", () => resolve());
	});

	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Failed to get server address");
	}

	const port = address.port;
	const url = `http://127.0.0.1:${port}`;

	return {
		url,
		port,
		get requestCount() {
			return requestCount;
		},
		getRequestCount: () => requestCount,
		resetRequestCount: () => {
			requestCount = 0;
		},
		setResponse: (newConfig: MockTargetConfig) => {
			config = { ...newConfig };
		},
		close: async () => {
			await new Promise<void>((resolve, reject) => {
				server.close((err) => {
					if (err) reject(err);
					else resolve();
				});
			});
		},
	};
}
