import { describe, expect, it } from "vitest";
import {
	DEFAULT_AGENT_STATE_DIR,
	DEFAULT_HEARTBEAT_INTERVAL_MS,
	DEFAULT_LEASE_MS,
	HTTP_BODY_MAX_CHARS,
	HTTP_REQUEST_TIMEOUT_MS,
} from "../constants.js";

describe("shared constants", () => {
	describe("lease defaults", () => {
		it("DEFAULT_LEASE_MS equals 30000 milliseconds", () => {
			expect(DEFAULT_LEASE_MS).toBe(30000);
		});

		it("DEFAULT_HEARTBEAT_INTERVAL_MS equals 10000 milliseconds", () => {
			expect(DEFAULT_HEARTBEAT_INTERVAL_MS).toBe(10000);
		});
	});

	describe("HTTP_GET_JSON constraints", () => {
		it("HTTP_REQUEST_TIMEOUT_MS equals 30000 milliseconds", () => {
			expect(HTTP_REQUEST_TIMEOUT_MS).toBe(30000);
		});

		it("HTTP_BODY_MAX_CHARS equals 10240 characters", () => {
			expect(HTTP_BODY_MAX_CHARS).toBe(10240);
		});
	});

	describe("agent configuration", () => {
		it("DEFAULT_AGENT_STATE_DIR equals '.agent-state'", () => {
			expect(DEFAULT_AGENT_STATE_DIR).toBe(".agent-state");
		});
	});
});
