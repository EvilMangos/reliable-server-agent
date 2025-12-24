import * as http from "http";

/**
 * Helper to make HTTP requests to a server during tests.
 * Provides a simple interface for making HTTP requests without external dependencies.
 */
export async function httpRequest(
	server: http.Server,
	method: string,
	path: string,
	body?: object,
): Promise<{ status: number; body: unknown }> {
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Server not listening");
	}

	return new Promise((resolve, reject) => {
		const data = body ? JSON.stringify(body) : undefined;
		const req = http.request(
			{
				hostname: "localhost",
				port: address.port,
				path,
				method,
				headers: {
					"Content-Type": "application/json",
					...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
				},
			},
			(res) => {
				let responseBody = "";
				res.on("data", (chunk) => (responseBody += chunk));
				res.on("end", () => {
					let parsedBody: unknown = responseBody;
					try {
						if (responseBody) {
							parsedBody = JSON.parse(responseBody);
						}
					} catch {
						// Keep as string if not JSON
					}
					resolve({ status: res.statusCode ?? 0, body: parsedBody });
				});
			},
		);
		req.on("error", reject);
		if (data) {
			req.write(data);
		}
		req.end();
	});
}
