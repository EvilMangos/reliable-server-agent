import type { HttpGetJsonPayload, HttpGetJsonResult } from "@reliable-server-agent/shared";
import { HTTP_BODY_MAX_CHARS, HTTP_REQUEST_TIMEOUT_MS } from "@reliable-server-agent/shared";
import type { Executor, ExecutorContext, JournalManager, Logger } from "../types/index.js";
import { RANDOM_FAILURE_PROBABILITY } from "../constants.js";

/**
 * Executor for HTTP_GET_JSON commands.
 * Fetches JSON from a URL with idempotent behavior via journal snapshots.
 */
export class HttpGetJsonExecutor implements Executor<HttpGetJsonPayload, HttpGetJsonResult> {
	constructor(
		private readonly logger: Logger,
		private readonly journalManager: JournalManager,
		private readonly onRandomFailure?: () => void,
	) {}

	/**
	 * Execute HTTP_GET_JSON command with idempotent behavior.
	 * If httpSnapshot exists in journal, returns it without refetching.
	 */
	async execute(payload: HttpGetJsonPayload, context: ExecutorContext): Promise<HttpGetJsonResult> {
		const { journal } = context;

		// Check if we already have a saved result (replay scenario)
		if (journal.httpSnapshot !== null) {
			this.logger.info(`HTTP_GET_JSON: replaying saved snapshot for ${payload.url}`);
			return journal.httpSnapshot;
		}

		// Update stage to IN_PROGRESS
		this.journalManager.updateStage(journal, "IN_PROGRESS");

		this.logger.info(`HTTP_GET_JSON: fetching ${payload.url}`);

		let result: HttpGetJsonResult;

		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), HTTP_REQUEST_TIMEOUT_MS);

			const response = await fetch(payload.url, {
				method: "GET",
				signal: controller.signal,
				redirect: "manual", // Do not follow redirects
			});

			clearTimeout(timeoutId);

			// Check for redirect
			if (response.status >= 300 && response.status < 400) {
				result = {
					status: response.status,
					body: null,
					truncated: false,
					bytesReturned: 0,
					error: "Redirects not followed",
				};
			} else {
				// Read body
				const bodyText = await response.text();
				let body: object | string | null = bodyText;
				let truncated = false;
				let bytesReturned = bodyText.length;

				// Truncate if too long
				if (bodyText.length > HTTP_BODY_MAX_CHARS) {
					body = bodyText.slice(0, HTTP_BODY_MAX_CHARS);
					truncated = true;
					bytesReturned = HTTP_BODY_MAX_CHARS;
				}

				// Try to parse as JSON
				try {
					body = JSON.parse(body as string);
				} catch {
					// Keep as string if not valid JSON
				}

				result = {
					status: response.status,
					body,
					truncated,
					bytesReturned,
					error: null,
				};
			}
		} catch (err) {
			if (err instanceof Error && err.name === "AbortError") {
				result = {
					status: 0,
					body: null,
					truncated: false,
					bytesReturned: 0,
					error: "Request timeout",
				};
			} else {
				result = {
					status: 0,
					body: null,
					truncated: false,
					bytesReturned: 0,
					error: err instanceof Error ? err.message : String(err),
				};
			}
		}

		this.logger.info(`HTTP_GET_JSON: status=${result.status}, error=${result.error}, bytesReturned=${result.bytesReturned}`);

		// Save snapshot to journal BEFORE any failure point (idempotency)
		this.journalManager.updateHttpSnapshot(journal, result);

		// Simulate random failure after saving snapshot but before reporting
		if (this.onRandomFailure && Math.random() < RANDOM_FAILURE_PROBABILITY) {
			this.logger.warn("Random failure triggered after saving snapshot, before reporting");
			this.onRandomFailure();
		}

		return result;
	}
}
