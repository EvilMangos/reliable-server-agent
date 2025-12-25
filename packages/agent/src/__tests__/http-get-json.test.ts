/**
 * Tests for HTTP_GET_JSON executor
 *
 * Covers:
 * - Redirect handling (do not follow, return error)
 * - Timeout handling (30s timeout returns "Request timeout")
 * - Body truncation at 10,240 chars with truncated flag
 * - JSON parsing with fallback to raw string
 * - httpSnapshot journaling before reporting
 * - Random failure injection
 * - Non-JSON response handling
 * - Status code capture
 * - Replay from saved httpSnapshot (idempotency)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HttpGetJsonPayload, HttpGetJsonResult } from "@reliable-server-agent/shared";
import { COMMAND_TYPE, HTTP_BODY_MAX_CHARS } from "@reliable-server-agent/shared";
import {
	type FetchMockContext,
	captureFetchContext,
	createMockJournalManager,
	createMockLogger,
	createTestHttpExecutor,
	createTestJournal,
	withMockedRandom,
} from "./test-utils.js";
import { HttpGetJsonExecutor } from "../executors/index.js";

describe("HTTP_GET_JSON Executor", () => {
	let fetchContext: FetchMockContext;

	beforeEach(() => {
		fetchContext = captureFetchContext();
	});

	afterEach(() => {
		fetchContext.restore();
		vi.restoreAllMocks();
	});

	/**
	 * Creates a mock Response object for fetch.
	 */
	function createMockResponse(options: {
		status: number;
		body?: string;
		headers?: Record<string, string>;
	}): Response {
		return {
			status: options.status,
			ok: options.status >= 200 && options.status < 300,
			headers: new Headers(options.headers),
			text: () => Promise.resolve(options.body ?? ""),
		} as unknown as Response;
	}

	describe("successful requests", () => {
		it("captures HTTP status code from response", async () => {
			const journal = createTestJournal({
				type: COMMAND_TYPE.HTTP_GET_JSON,
				httpSnapshot: null,
			});
			const { executor } = createTestHttpExecutor(journal);

			global.fetch = vi.fn().mockResolvedValue(createMockResponse({
				status: 200,
				body: '{"data": "test"}',
			}));

			const payload: HttpGetJsonPayload = { url: "http://example.com/api" };
			const result = await executor.execute(payload, { journal, checkLeaseValid: () => true });

			expect(result.status).toBe(200);
		});

		it("parses valid JSON response into object body", async () => {
			const journal = createTestJournal({
				type: COMMAND_TYPE.HTTP_GET_JSON,
				httpSnapshot: null,
			});
			const { executor } = createTestHttpExecutor(journal);

			global.fetch = vi.fn().mockResolvedValue(createMockResponse({
				status: 200,
				body: '{"key": "value", "number": 42}',
			}));

			const payload: HttpGetJsonPayload = { url: "http://example.com/api" };
			const result = await executor.execute(payload, { journal, checkLeaseValid: () => true });

			expect(result.body).toEqual({ key: "value", number: 42 });
			expect(result.error).toBeNull();
		});

		it("returns bytesReturned for response body length", async () => {
			const journal = createTestJournal({
				type: COMMAND_TYPE.HTTP_GET_JSON,
				httpSnapshot: null,
			});
			const { executor } = createTestHttpExecutor(journal);

			const bodyText = '{"message": "hello"}';
			global.fetch = vi.fn().mockResolvedValue(createMockResponse({
				status: 200,
				body: bodyText,
			}));

			const payload: HttpGetJsonPayload = { url: "http://example.com/api" };
			const result = await executor.execute(payload, { journal, checkLeaseValid: () => true });

			expect(result.bytesReturned).toBe(bodyText.length);
			expect(result.truncated).toBe(false);
		});
	});

	describe("redirect handling", () => {
		it("returns error for 301 redirect without following", async () => {
			const journal = createTestJournal({
				type: COMMAND_TYPE.HTTP_GET_JSON,
				httpSnapshot: null,
			});
			const { executor } = createTestHttpExecutor(journal);

			global.fetch = vi.fn().mockResolvedValue(createMockResponse({
				status: 301,
				body: "",
			}));

			const payload: HttpGetJsonPayload = { url: "http://example.com/redirect" };
			const result = await executor.execute(payload, { journal, checkLeaseValid: () => true });

			expect(result.status).toBe(301);
			expect(result.error).toBe("Redirects not followed");
			expect(result.body).toBeNull();
			expect(result.bytesReturned).toBe(0);
		});

		it("returns error for 302 redirect without following", async () => {
			const journal = createTestJournal({
				type: COMMAND_TYPE.HTTP_GET_JSON,
				httpSnapshot: null,
			});
			const { executor } = createTestHttpExecutor(journal);

			global.fetch = vi.fn().mockResolvedValue(createMockResponse({
				status: 302,
				body: "",
			}));

			const payload: HttpGetJsonPayload = { url: "http://example.com/temp-redirect" };
			const result = await executor.execute(payload, { journal, checkLeaseValid: () => true });

			expect(result.status).toBe(302);
			expect(result.error).toBe("Redirects not followed");
		});

		it("returns error for 307 redirect without following", async () => {
			const journal = createTestJournal({
				type: COMMAND_TYPE.HTTP_GET_JSON,
				httpSnapshot: null,
			});
			const { executor } = createTestHttpExecutor(journal);

			global.fetch = vi.fn().mockResolvedValue(createMockResponse({
				status: 307,
				body: "",
			}));

			const payload: HttpGetJsonPayload = { url: "http://example.com/temp-redirect" };
			const result = await executor.execute(payload, { journal, checkLeaseValid: () => true });

			expect(result.status).toBe(307);
			expect(result.error).toBe("Redirects not followed");
		});

		it("uses redirect: manual in fetch options", async () => {
			const journal = createTestJournal({
				type: COMMAND_TYPE.HTTP_GET_JSON,
				httpSnapshot: null,
			});
			const { executor } = createTestHttpExecutor(journal);

			const fetchMock = vi.fn().mockResolvedValue(createMockResponse({
				status: 200,
				body: "{}",
			}));
			global.fetch = fetchMock;

			const payload: HttpGetJsonPayload = { url: "http://example.com/api" };
			await executor.execute(payload, { journal, checkLeaseValid: () => true });

			expect(fetchMock).toHaveBeenCalledWith(
				"http://example.com/api",
				expect.objectContaining({
					redirect: "manual",
				}),
			);
		});
	});

	describe("timeout handling", () => {
		it("returns Request timeout error when fetch is aborted", async () => {
			const journal = createTestJournal({
				type: COMMAND_TYPE.HTTP_GET_JSON,
				httpSnapshot: null,
			});
			const { executor } = createTestHttpExecutor(journal);

			// Simulate AbortError
			const abortError = new Error("The operation was aborted");
			abortError.name = "AbortError";
			global.fetch = vi.fn().mockRejectedValue(abortError);

			const payload: HttpGetJsonPayload = { url: "http://slow-server.com/api" };
			const result = await executor.execute(payload, { journal, checkLeaseValid: () => true });

			expect(result.status).toBe(0);
			expect(result.error).toBe("Request timeout");
			expect(result.body).toBeNull();
			expect(result.truncated).toBe(false);
			expect(result.bytesReturned).toBe(0);
		});

		it("passes AbortController signal to fetch", async () => {
			const journal = createTestJournal({
				type: COMMAND_TYPE.HTTP_GET_JSON,
				httpSnapshot: null,
			});
			const { executor } = createTestHttpExecutor(journal);

			const fetchMock = vi.fn().mockResolvedValue(createMockResponse({
				status: 200,
				body: "{}",
			}));
			global.fetch = fetchMock;

			const payload: HttpGetJsonPayload = { url: "http://example.com/api" };
			await executor.execute(payload, { journal, checkLeaseValid: () => true });

			expect(fetchMock).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					signal: expect.any(AbortSignal),
				}),
			);
		});
	});

	describe("body truncation", () => {
		it("truncates body at 10,240 characters and sets truncated flag", async () => {
			const journal = createTestJournal({
				type: COMMAND_TYPE.HTTP_GET_JSON,
				httpSnapshot: null,
			});
			const { executor } = createTestHttpExecutor(journal);

			// Create a body larger than HTTP_BODY_MAX_CHARS (10,240)
			const largeBody = "x".repeat(HTTP_BODY_MAX_CHARS + 500);
			global.fetch = vi.fn().mockResolvedValue(createMockResponse({
				status: 200,
				body: largeBody,
			}));

			const payload: HttpGetJsonPayload = { url: "http://example.com/large" };
			const result = await executor.execute(payload, { journal, checkLeaseValid: () => true });

			expect(result.truncated).toBe(true);
			expect(result.bytesReturned).toBe(HTTP_BODY_MAX_CHARS);
			expect((result.body as string).length).toBe(HTTP_BODY_MAX_CHARS);
		});

		it("does not truncate body under 10,240 characters", async () => {
			const journal = createTestJournal({
				type: COMMAND_TYPE.HTTP_GET_JSON,
				httpSnapshot: null,
			});
			const { executor } = createTestHttpExecutor(journal);

			const smallBody = "x".repeat(100);
			global.fetch = vi.fn().mockResolvedValue(createMockResponse({
				status: 200,
				body: smallBody,
			}));

			const payload: HttpGetJsonPayload = { url: "http://example.com/small" };
			const result = await executor.execute(payload, { journal, checkLeaseValid: () => true });

			expect(result.truncated).toBe(false);
			expect(result.bytesReturned).toBe(100);
		});

		it("truncates at exactly 10,240 boundary", async () => {
			const journal = createTestJournal({
				type: COMMAND_TYPE.HTTP_GET_JSON,
				httpSnapshot: null,
			});
			const { executor } = createTestHttpExecutor(journal);

			// Create body exactly at boundary
			const exactBody = "x".repeat(HTTP_BODY_MAX_CHARS);
			global.fetch = vi.fn().mockResolvedValue(createMockResponse({
				status: 200,
				body: exactBody,
			}));

			const payload: HttpGetJsonPayload = { url: "http://example.com/exact" };
			const result = await executor.execute(payload, { journal, checkLeaseValid: () => true });

			expect(result.truncated).toBe(false);
			expect(result.bytesReturned).toBe(HTTP_BODY_MAX_CHARS);
		});
	});

	describe("non-JSON response handling", () => {
		it("returns raw string body for plain text response", async () => {
			const journal = createTestJournal({
				type: COMMAND_TYPE.HTTP_GET_JSON,
				httpSnapshot: null,
			});
			const { executor } = createTestHttpExecutor(journal);

			global.fetch = vi.fn().mockResolvedValue(createMockResponse({
				status: 200,
				body: "This is plain text, not JSON",
			}));

			const payload: HttpGetJsonPayload = { url: "http://example.com/text" };
			const result = await executor.execute(payload, { journal, checkLeaseValid: () => true });

			expect(result.body).toBe("This is plain text, not JSON");
			expect(result.error).toBeNull();
			expect(result.status).toBe(200);
		});

		it("returns raw string body for malformed JSON", async () => {
			const journal = createTestJournal({
				type: COMMAND_TYPE.HTTP_GET_JSON,
				httpSnapshot: null,
			});
			const { executor } = createTestHttpExecutor(journal);

			global.fetch = vi.fn().mockResolvedValue(createMockResponse({
				status: 200,
				body: '{invalid json: "missing quotes}',
			}));

			const payload: HttpGetJsonPayload = { url: "http://example.com/bad-json" };
			const result = await executor.execute(payload, { journal, checkLeaseValid: () => true });

			expect(result.body).toBe('{invalid json: "missing quotes}');
			expect(result.error).toBeNull();
		});

		it("returns empty string body for empty response", async () => {
			const journal = createTestJournal({
				type: COMMAND_TYPE.HTTP_GET_JSON,
				httpSnapshot: null,
			});
			const { executor } = createTestHttpExecutor(journal);

			global.fetch = vi.fn().mockResolvedValue(createMockResponse({
				status: 204,
				body: "",
			}));

			const payload: HttpGetJsonPayload = { url: "http://example.com/empty" };
			const result = await executor.execute(payload, { journal, checkLeaseValid: () => true });

			expect(result.body).toBe("");
			expect(result.bytesReturned).toBe(0);
		});

		it("returns HTML body as string", async () => {
			const journal = createTestJournal({
				type: COMMAND_TYPE.HTTP_GET_JSON,
				httpSnapshot: null,
			});
			const { executor } = createTestHttpExecutor(journal);

			const htmlBody = "<html><body>Hello</body></html>";
			global.fetch = vi.fn().mockResolvedValue(createMockResponse({
				status: 200,
				body: htmlBody,
			}));

			const payload: HttpGetJsonPayload = { url: "http://example.com/html" };
			const result = await executor.execute(payload, { journal, checkLeaseValid: () => true });

			expect(result.body).toBe(htmlBody);
			expect(result.error).toBeNull();
		});
	});

	describe("httpSnapshot journaling", () => {
		it("updates journal with httpSnapshot before returning result", async () => {
			const journal = createTestJournal({
				type: COMMAND_TYPE.HTTP_GET_JSON,
				httpSnapshot: null,
				stage: "CLAIMED",
			});
			const { executor, journalManager } = createTestHttpExecutor(journal);

			global.fetch = vi.fn().mockResolvedValue(createMockResponse({
				status: 200,
				body: '{"saved": true}',
			}));

			const payload: HttpGetJsonPayload = { url: "http://example.com/api" };
			const result = await executor.execute(payload, { journal, checkLeaseValid: () => true });

			expect(journalManager.updateHttpSnapshot).toHaveBeenCalledWith(journal, result);
		});

		it("updates journal stage to IN_PROGRESS before fetching", async () => {
			const journal = createTestJournal({
				type: COMMAND_TYPE.HTTP_GET_JSON,
				httpSnapshot: null,
				stage: "CLAIMED",
			});
			const { executor, journalManager } = createTestHttpExecutor(journal);

			global.fetch = vi.fn().mockResolvedValue(createMockResponse({
				status: 200,
				body: "{}",
			}));

			const payload: HttpGetJsonPayload = { url: "http://example.com/api" };
			await executor.execute(payload, { journal, checkLeaseValid: () => true });

			expect(journalManager.updateStage).toHaveBeenCalledWith(journal, "IN_PROGRESS");
		});

		it("saves httpSnapshot before any random failure can occur", async () => {
			const journal = createTestJournal({
				type: COMMAND_TYPE.HTTP_GET_JSON,
				httpSnapshot: null,
				stage: "CLAIMED",
			});

			let snapshotSavedBeforeFailure = false;
			const journalManager = createMockJournalManager(journal);
			journalManager.updateHttpSnapshot = vi.fn(() => {
				snapshotSavedBeforeFailure = true;
			});

			const onRandomFailure = vi.fn(() => {
				// Verify snapshot was saved before failure callback
				if (!snapshotSavedBeforeFailure) {
					throw new Error("Snapshot not saved before failure");
				}
			});

			const logger = createMockLogger();
			const executor = new HttpGetJsonExecutor(logger, journalManager, onRandomFailure);

			global.fetch = vi.fn().mockResolvedValue(createMockResponse({
				status: 200,
				body: '{"data": "test"}',
			}));

			const payload: HttpGetJsonPayload = { url: "http://example.com/api" };

			// With random value below threshold, random failure will be triggered
			await withMockedRandom(0.05, async () => {
				await executor.execute(payload, { journal, checkLeaseValid: () => true });
			});

			// Verify snapshot was saved (happens before random failure check in implementation)
			expect(journalManager.updateHttpSnapshot).toHaveBeenCalled();
		});
	});

	describe("replay from saved httpSnapshot", () => {
		it("returns saved httpSnapshot without fetching when present", async () => {
			const savedSnapshot: HttpGetJsonResult = {
				status: 200,
				body: { cached: true },
				truncated: false,
				bytesReturned: 14,
				error: null,
			};

			const journal = createTestJournal({
				type: COMMAND_TYPE.HTTP_GET_JSON,
				httpSnapshot: savedSnapshot,
				stage: "RESULT_SAVED",
			});
			const { executor } = createTestHttpExecutor(journal);

			const fetchMock = vi.fn();
			global.fetch = fetchMock;

			const payload: HttpGetJsonPayload = { url: "http://example.com/api" };
			const result = await executor.execute(payload, { journal, checkLeaseValid: () => true });

			expect(result).toEqual(savedSnapshot);
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it("does not update journal when replaying from httpSnapshot", async () => {
			const savedSnapshot: HttpGetJsonResult = {
				status: 200,
				body: { replayed: true },
				truncated: false,
				bytesReturned: 16,
				error: null,
			};

			const journal = createTestJournal({
				type: COMMAND_TYPE.HTTP_GET_JSON,
				httpSnapshot: savedSnapshot,
				stage: "RESULT_SAVED",
			});
			const { executor, journalManager } = createTestHttpExecutor(journal);

			const payload: HttpGetJsonPayload = { url: "http://example.com/api" };
			await executor.execute(payload, { journal, checkLeaseValid: () => true });

			expect(journalManager.updateStage).not.toHaveBeenCalled();
			expect(journalManager.updateHttpSnapshot).not.toHaveBeenCalled();
		});
	});

	describe("random failure injection", () => {
		it("triggers onRandomFailure callback when random value is below threshold", async () => {
			const journal = createTestJournal({
				type: COMMAND_TYPE.HTTP_GET_JSON,
				httpSnapshot: null,
			});

			const onRandomFailure = vi.fn();
			const { executor } = createTestHttpExecutor(journal, { onRandomFailure });

			global.fetch = vi.fn().mockResolvedValue(createMockResponse({
				status: 200,
				body: "{}",
			}));

			const payload: HttpGetJsonPayload = { url: "http://example.com/api" };

			// 0.05 is below RANDOM_FAILURE_PROBABILITY (0.1)
			await withMockedRandom(0.05, async () => {
				await executor.execute(payload, { journal, checkLeaseValid: () => true });
			});

			expect(onRandomFailure).toHaveBeenCalled();
		});

		it("does not trigger onRandomFailure when random value is above threshold", async () => {
			const journal = createTestJournal({
				type: COMMAND_TYPE.HTTP_GET_JSON,
				httpSnapshot: null,
			});

			const onRandomFailure = vi.fn();
			const { executor } = createTestHttpExecutor(journal, { onRandomFailure });

			global.fetch = vi.fn().mockResolvedValue(createMockResponse({
				status: 200,
				body: "{}",
			}));

			const payload: HttpGetJsonPayload = { url: "http://example.com/api" };

			// 0.5 is above RANDOM_FAILURE_PROBABILITY (0.1)
			await withMockedRandom(0.5, async () => {
				await executor.execute(payload, { journal, checkLeaseValid: () => true });
			});

			expect(onRandomFailure).not.toHaveBeenCalled();
		});

		it("does not check random failure when no callback is provided", async () => {
			const journal = createTestJournal({
				type: COMMAND_TYPE.HTTP_GET_JSON,
				httpSnapshot: null,
			});
			const { executor } = createTestHttpExecutor(journal); // No onRandomFailure

			global.fetch = vi.fn().mockResolvedValue(createMockResponse({
				status: 200,
				body: "{}",
			}));

			const payload: HttpGetJsonPayload = { url: "http://example.com/api" };

			// Even with low random value, should complete successfully
			await withMockedRandom(0.01, async () => {
				const result = await executor.execute(payload, { journal, checkLeaseValid: () => true });
				expect(result.error).toBeNull();
			});
		});
	});

	describe("error handling", () => {
		it("captures network errors in result", async () => {
			const journal = createTestJournal({
				type: COMMAND_TYPE.HTTP_GET_JSON,
				httpSnapshot: null,
			});
			const { executor } = createTestHttpExecutor(journal);

			global.fetch = vi.fn().mockRejectedValue(new Error("Network unreachable"));

			const payload: HttpGetJsonPayload = { url: "http://example.com/api" };
			const result = await executor.execute(payload, { journal, checkLeaseValid: () => true });

			expect(result.status).toBe(0);
			expect(result.error).toBe("Network unreachable");
			expect(result.body).toBeNull();
		});

		it("captures non-Error thrown values as string", async () => {
			const journal = createTestJournal({
				type: COMMAND_TYPE.HTTP_GET_JSON,
				httpSnapshot: null,
			});
			const { executor } = createTestHttpExecutor(journal);

			global.fetch = vi.fn().mockRejectedValue("String error");

			const payload: HttpGetJsonPayload = { url: "http://example.com/api" };
			const result = await executor.execute(payload, { journal, checkLeaseValid: () => true });

			expect(result.error).toBe("String error");
		});

		it("handles HTTP error status codes without throwing", async () => {
			const journal = createTestJournal({
				type: COMMAND_TYPE.HTTP_GET_JSON,
				httpSnapshot: null,
			});
			const { executor } = createTestHttpExecutor(journal);

			global.fetch = vi.fn().mockResolvedValue(createMockResponse({
				status: 500,
				body: '{"error": "Internal Server Error"}',
			}));

			const payload: HttpGetJsonPayload = { url: "http://example.com/api" };
			const result = await executor.execute(payload, { journal, checkLeaseValid: () => true });

			expect(result.status).toBe(500);
			expect(result.body).toEqual({ error: "Internal Server Error" });
			expect(result.error).toBeNull();
		});

		it("handles 404 error response", async () => {
			const journal = createTestJournal({
				type: COMMAND_TYPE.HTTP_GET_JSON,
				httpSnapshot: null,
			});
			const { executor } = createTestHttpExecutor(journal);

			global.fetch = vi.fn().mockResolvedValue(createMockResponse({
				status: 404,
				body: "Not Found",
			}));

			const payload: HttpGetJsonPayload = { url: "http://example.com/missing" };
			const result = await executor.execute(payload, { journal, checkLeaseValid: () => true });

			expect(result.status).toBe(404);
			expect(result.body).toBe("Not Found");
			expect(result.error).toBeNull();
		});
	});
});
