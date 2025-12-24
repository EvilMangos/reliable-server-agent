import { describe, it } from "vitest";

describe("Agent", () => {
	describe("Command Polling", () => {
		it.todo("should poll server for work");
		it.todo("should respect poll interval");
		it.todo("should handle server unavailability gracefully");
	});

	describe("DELAY Command", () => {
		it.todo("should execute delay for specified ms");
		it.todo("should return result with tookMs");
		it.todo("should handle crash during delay");
	});

	describe("HTTP_GET_JSON Command", () => {
		it.todo("should fetch JSON from URL");
		it.todo("should return status and body");
		it.todo("should truncate large responses");
		it.todo("should handle HTTP errors gracefully");
		it.todo("should handle invalid URLs");
	});

	describe("Result Reporting", () => {
		it.todo("should send results back to server");
		it.todo("should retry on network failure");
	});

	describe("Crash Recovery", () => {
		it.todo("should sync correctly with server after restart");
		it.todo("should detect unfinished command after crash");
		it.todo("should prevent double execution");
	});

	describe("Failure Simulation", () => {
		it.todo("should crash after N seconds with --kill-after flag");
		it.todo("should crash randomly with --random-failures flag");
	});
});
