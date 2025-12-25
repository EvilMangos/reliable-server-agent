import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMAND_STATUS, COMMAND_TYPE, type CommandRecord, type CommandType } from "@reliable-server-agent/shared";

import { CommandService } from "../command-service.js";
import {
	CommandNotFoundError,
	InvalidCommandTypeError,
	InvalidPayloadError,
	LeaseConflictError,
} from "../errors/index.js";
import type { CommandRepository } from "../../contracts/index.js";

/**
 * Unit tests for CommandService
 *
 * These tests verify the service layer's behavior in isolation by mocking the database.
 * The service layer is responsible for:
 * - UUID generation for commands and leases
 * - Timestamp generation (via injectable clock)
 * - Payload validation
 * - JSON parsing/serialization
 * - Throwing typed domain errors for controllers to map to HTTP responses
 */

// Mock database factory
function createMockDatabase(): {
	createCommand: Mock;
	getCommand: Mock;
	claimCommand: Mock;
	heartbeat: Mock;
	completeCommand: Mock;
	failCommand: Mock;
	resetExpiredLeases: Mock;
	close: Mock;
} {
	return {
		createCommand: vi.fn(),
		getCommand: vi.fn(),
		claimCommand: vi.fn(),
		heartbeat: vi.fn(),
		completeCommand: vi.fn(),
		failCommand: vi.fn(),
		resetExpiredLeases: vi.fn(),
		close: vi.fn(),
	};
}

// Helper to create a mock command record
function createMockCommandRecord(overrides: Partial<CommandRecord> = {}): CommandRecord {
	return {
		id: "test-cmd-id",
		type: COMMAND_TYPE.DELAY,
		payloadJson: JSON.stringify({ ms: 5000 }),
		status: COMMAND_STATUS.PENDING,
		resultJson: null,
		error: null,
		agentId: null,
		leaseId: null,
		leaseExpiresAt: null,
		createdAt: 1000000,
		startedAt: null,
		attempt: 0,
		scheduledEndAt: null,
		...overrides,
	};
}

describe("CommandService", () => {
	let mockDb: ReturnType<typeof createMockDatabase>;
	let service: CommandService;
	let mockClock: Mock;
	const fixedTimestamp = 1700000000000; // Fixed timestamp for deterministic tests

	beforeEach(() => {
		mockDb = createMockDatabase();
		mockClock = vi.fn().mockReturnValue(fixedTimestamp);
		service = new CommandService(mockDb as unknown as CommandRepository, mockClock);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("constructor", () => {
		it("accepts database and optional clock dependencies", () => {
			const service1 = new CommandService(mockDb as unknown as CommandRepository);
			expect(service1).toBeInstanceOf(CommandService);

			const customClock = () => 123456;
			const service2 = new CommandService(mockDb as unknown as CommandRepository, customClock);
			expect(service2).toBeInstanceOf(CommandService);
		});

		it("uses Date.now as default clock when not provided", () => {
			const serviceWithDefaultClock = new CommandService(mockDb as unknown as CommandRepository);
			const expectedRecord = createMockCommandRecord({ id: "generated-id" });
			mockDb.createCommand.mockReturnValue(expectedRecord);

			// The service should use Date.now internally - we can verify by checking
			// that createCommand is called with a timestamp close to now
			const beforeCall = Date.now();
			serviceWithDefaultClock.createCommand(COMMAND_TYPE.DELAY, { ms: 1000 });
			const afterCall = Date.now();

			expect(mockDb.createCommand).toHaveBeenCalled();
			const calledTimestamp = mockDb.createCommand.mock.calls[0][3];
			expect(calledTimestamp).toBeGreaterThanOrEqual(beforeCall);
			expect(calledTimestamp).toBeLessThanOrEqual(afterCall);
		});
	});

	describe("createCommand", () => {
		describe("normal paths", () => {
			it("creates a DELAY command with generated UUID and timestamp", () => {
				const expectedRecord = createMockCommandRecord({ id: "generated-id" });
				mockDb.createCommand.mockReturnValue(expectedRecord);

				const result = service.createCommand(COMMAND_TYPE.DELAY, { ms: 5000 });

				expect(result).toBe("generated-id");
				expect(mockDb.createCommand).toHaveBeenCalledWith(
					expect.any(String), // UUID
					COMMAND_TYPE.DELAY,
					{ ms: 5000 },
					fixedTimestamp,
				);
				// Verify UUID format (v4 UUID)
				const passedId = mockDb.createCommand.mock.calls[0][0];
				expect(passedId).toMatch(
					/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
				);
			});

			it("creates an HTTP_GET_JSON command with generated UUID and timestamp", () => {
				const expectedRecord = createMockCommandRecord({
					id: "generated-id",
					type: COMMAND_TYPE.HTTP_GET_JSON,
					payloadJson: JSON.stringify({ url: "https://example.com/api" }),
				});
				mockDb.createCommand.mockReturnValue(expectedRecord);

				const result = service.createCommand(COMMAND_TYPE.HTTP_GET_JSON, { url: "https://example.com/api" });

				expect(result).toBe("generated-id");
				expect(mockDb.createCommand).toHaveBeenCalledWith(
					expect.any(String),
					COMMAND_TYPE.HTTP_GET_JSON,
					{ url: "https://example.com/api" },
					fixedTimestamp,
				);
			});

			it("uses the injected clock for timestamp", () => {
				const customTimestamp = 9999999999999;
				mockClock.mockReturnValue(customTimestamp);
				const expectedRecord = createMockCommandRecord({ id: "test-id" });
				mockDb.createCommand.mockReturnValue(expectedRecord);

				service.createCommand(COMMAND_TYPE.DELAY, { ms: 1000 });

				expect(mockDb.createCommand).toHaveBeenCalledWith(
					expect.any(String),
					COMMAND_TYPE.DELAY,
					{ ms: 1000 },
					customTimestamp,
				);
			});
		});

		describe("error conditions", () => {
			it("throws InvalidCommandTypeError for invalid command type", () => {
				expect(() => {
					service.createCommand("INVALID_TYPE" as CommandType, { ms: 1000 });
				}).toThrow(InvalidCommandTypeError);
			});

			it("throws InvalidCommandTypeError for empty command type", () => {
				expect(() => {
					service.createCommand("" as CommandType, { ms: 1000 });
				}).toThrow(InvalidCommandTypeError);
			});

			it("throws InvalidPayloadError when DELAY payload is missing ms field", () => {
				expect(() => {
					service.createCommand(COMMAND_TYPE.DELAY, {} as { ms: number });
				}).toThrow(InvalidPayloadError);
			});

			it("throws InvalidPayloadError when DELAY payload ms is not a number", () => {
				expect(() => {
					service.createCommand(COMMAND_TYPE.DELAY, { ms: "5000" } as unknown as { ms: number });
				}).toThrow(InvalidPayloadError);
			});

			it("throws InvalidPayloadError when HTTP_GET_JSON payload is missing url field", () => {
				expect(() => {
					service.createCommand(COMMAND_TYPE.HTTP_GET_JSON, {} as { url: string });
				}).toThrow(InvalidPayloadError);
			});

			it("throws InvalidPayloadError when HTTP_GET_JSON payload url is not a string", () => {
				expect(() => {
					service.createCommand(COMMAND_TYPE.HTTP_GET_JSON, { url: 123 } as unknown as { url: string });
				}).toThrow(InvalidPayloadError);
			});

			it("throws InvalidPayloadError when payload is null", () => {
				expect(() => {
					service.createCommand(COMMAND_TYPE.DELAY, null as unknown as { ms: number });
				}).toThrow(InvalidPayloadError);
			});

			it("throws InvalidPayloadError when payload is undefined", () => {
				expect(() => {
					service.createCommand(COMMAND_TYPE.DELAY, undefined as unknown as { ms: number });
				}).toThrow(InvalidPayloadError);
			});
		});

		describe("edge cases", () => {
			it("accepts DELAY command with ms value of 0", () => {
				const expectedRecord = createMockCommandRecord({ id: "test-id" });
				mockDb.createCommand.mockReturnValue(expectedRecord);

				const result = service.createCommand(COMMAND_TYPE.DELAY, { ms: 0 });

				expect(result).toBe("test-id");
				expect(mockDb.createCommand).toHaveBeenCalledWith(
					expect.any(String),
					COMMAND_TYPE.DELAY,
					{ ms: 0 },
					fixedTimestamp,
				);
			});

			it("accepts DELAY command with very large ms value", () => {
				const expectedRecord = createMockCommandRecord({ id: "test-id" });
				mockDb.createCommand.mockReturnValue(expectedRecord);

				const result = service.createCommand(COMMAND_TYPE.DELAY, { ms: Number.MAX_SAFE_INTEGER });

				expect(result).toBe("test-id");
			});
		});
	});

	describe("getCommand", () => {
		describe("normal paths", () => {
			it("returns command details for existing command", () => {
				const mockRecord = createMockCommandRecord({
					id: "cmd-1",
					status: COMMAND_STATUS.PENDING,
					agentId: null,
				});
				mockDb.getCommand.mockReturnValue(mockRecord);

				const result = service.getCommand("cmd-1");

				expect(result.status).toBe(COMMAND_STATUS.PENDING);
				expect(result.agentId).toBeUndefined();
				expect(result.result).toBeUndefined();
				expect(mockDb.getCommand).toHaveBeenCalledWith("cmd-1");
			});

			it("includes agentId when command is assigned", () => {
				const mockRecord = createMockCommandRecord({
					id: "cmd-1",
					status: COMMAND_STATUS.RUNNING,
					agentId: "agent-1",
				});
				mockDb.getCommand.mockReturnValue(mockRecord);

				const result = service.getCommand("cmd-1");

				expect(result.status).toBe(COMMAND_STATUS.RUNNING);
				expect(result.agentId).toBe("agent-1");
			});

			it("parses resultJson and includes result for completed command", () => {
				const mockResult = { ok: true, tookMs: 5034 };
				const mockRecord = createMockCommandRecord({
					id: "cmd-1",
					status: COMMAND_STATUS.COMPLETED,
					resultJson: JSON.stringify(mockResult),
				});
				mockDb.getCommand.mockReturnValue(mockRecord);

				const result = service.getCommand("cmd-1");

				expect(result.status).toBe(COMMAND_STATUS.COMPLETED);
				expect(result.result).toEqual(mockResult);
			});

			it("parses resultJson for HTTP_GET_JSON result", () => {
				const mockResult = {
					status: 200,
					body: { data: "test" },
					truncated: false,
					bytesReturned: 100,
					error: null,
				};
				const mockRecord = createMockCommandRecord({
					id: "cmd-1",
					type: COMMAND_TYPE.HTTP_GET_JSON,
					status: COMMAND_STATUS.COMPLETED,
					resultJson: JSON.stringify(mockResult),
				});
				mockDb.getCommand.mockReturnValue(mockRecord);

				const result = service.getCommand("cmd-1");

				expect(result.result).toEqual(mockResult);
			});
		});

		describe("error conditions", () => {
			it("throws CommandNotFoundError when command does not exist", () => {
				mockDb.getCommand.mockReturnValue(null);

				expect(() => {
					service.getCommand("nonexistent-id");
				}).toThrow(CommandNotFoundError);
			});
		});

		describe("edge cases", () => {
			it("handles command with null resultJson", () => {
				const mockRecord = createMockCommandRecord({
					id: "cmd-1",
					status: COMMAND_STATUS.PENDING,
					resultJson: null,
				});
				mockDb.getCommand.mockReturnValue(mockRecord);

				const result = service.getCommand("cmd-1");

				expect(result.result).toBeUndefined();
			});

			it("handles failed command with error field", () => {
				const mockRecord = createMockCommandRecord({
					id: "cmd-1",
					status: COMMAND_STATUS.FAILED,
					error: "Connection timeout",
					resultJson: null,
				});
				mockDb.getCommand.mockReturnValue(mockRecord);

				const result = service.getCommand("cmd-1");

				expect(result.status).toBe(COMMAND_STATUS.FAILED);
			});
		});
	});

	describe("claimNextCommand", () => {
		describe("normal paths", () => {
			it("claims the oldest pending command and returns claim response", () => {
				const mockRecord = createMockCommandRecord({
					id: "cmd-1",
					type: COMMAND_TYPE.DELAY,
					payloadJson: JSON.stringify({ ms: 5000 }),
					status: COMMAND_STATUS.RUNNING,
					agentId: "agent-1",
					leaseId: "lease-123",
					leaseExpiresAt: fixedTimestamp + 30000,
					startedAt: fixedTimestamp,
					scheduledEndAt: fixedTimestamp + 5000,
				});
				mockDb.claimCommand.mockReturnValue(mockRecord);

				const result = service.claimNextCommand("agent-1", 30000);

				expect(result).not.toBeNull();
				expect(result!.commandId).toBe("cmd-1");
				expect(result!.type).toBe(COMMAND_TYPE.DELAY);
				expect(result!.payload).toEqual({ ms: 5000 });
				expect(result!.leaseId).toBe("lease-123");
				expect(result!.leaseExpiresAt).toBe(fixedTimestamp + 30000);
				expect(result!.startedAt).toBe(fixedTimestamp);
				expect(result!.scheduledEndAt).toBe(fixedTimestamp + 5000);
			});

			it("claims HTTP_GET_JSON command with parsed payload", () => {
				const mockRecord = createMockCommandRecord({
					id: "cmd-2",
					type: COMMAND_TYPE.HTTP_GET_JSON,
					payloadJson: JSON.stringify({ url: "https://api.example.com" }),
					status: COMMAND_STATUS.RUNNING,
					agentId: "agent-1",
					leaseId: "lease-456",
					leaseExpiresAt: fixedTimestamp + 30000,
					startedAt: fixedTimestamp,
					scheduledEndAt: null,
				});
				mockDb.claimCommand.mockReturnValue(mockRecord);

				const result = service.claimNextCommand("agent-1", 30000);

				expect(result).not.toBeNull();
				expect(result!.type).toBe(COMMAND_TYPE.HTTP_GET_JSON);
				expect(result!.payload).toEqual({ url: "https://api.example.com" });
				expect(result!.scheduledEndAt).toBeNull();
			});

			it("generates leaseId and uses injected clock for timestamp", () => {
				const mockRecord = createMockCommandRecord({
					id: "cmd-1",
					leaseId: "will-be-replaced",
					leaseExpiresAt: fixedTimestamp + 30000,
					startedAt: fixedTimestamp,
				});
				mockDb.claimCommand.mockReturnValue(mockRecord);

				service.claimNextCommand("agent-1", 30000);

				expect(mockDb.claimCommand).toHaveBeenCalledWith(
					"agent-1",
					expect.any(String), // Generated leaseId (UUID)
					30000,
					fixedTimestamp,
				);
				// Verify UUID format for leaseId
				const passedLeaseId = mockDb.claimCommand.mock.calls[0][1];
				expect(passedLeaseId).toMatch(
					/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
				);
			});
		});

		describe("edge cases", () => {
			it("returns null when no commands are available", () => {
				mockDb.claimCommand.mockReturnValue(null);

				const result = service.claimNextCommand("agent-1", 30000);

				expect(result).toBeNull();
			});

			it("handles command with empty payload object", () => {
				const mockRecord = createMockCommandRecord({
					id: "cmd-1",
					payloadJson: JSON.stringify({}),
				});
				mockDb.claimCommand.mockReturnValue(mockRecord);

				const result = service.claimNextCommand("agent-1", 30000);

				expect(result!.payload).toEqual({});
			});
		});
	});

	describe("recordHeartbeat", () => {
		describe("normal paths", () => {
			it("extends lease successfully when lease is current", () => {
				mockDb.heartbeat.mockReturnValue(true);

				// Should not throw
				expect(() => {
					service.recordHeartbeat("cmd-1", "agent-1", "lease-123", 30000);
				}).not.toThrow();

				expect(mockDb.heartbeat).toHaveBeenCalledWith(
					"cmd-1",
					"agent-1",
					"lease-123",
					30000,
					fixedTimestamp,
				);
			});

			it("uses injected clock for timestamp", () => {
				const customTimestamp = 8888888888888;
				mockClock.mockReturnValue(customTimestamp);
				mockDb.heartbeat.mockReturnValue(true);

				service.recordHeartbeat("cmd-1", "agent-1", "lease-123", 15000);

				expect(mockDb.heartbeat).toHaveBeenCalledWith(
					"cmd-1",
					"agent-1",
					"lease-123",
					15000,
					customTimestamp,
				);
			});
		});

		describe("error conditions", () => {
			it("throws LeaseConflictError when lease is not current", () => {
				mockDb.heartbeat.mockReturnValue(false);

				expect(() => {
					service.recordHeartbeat("cmd-1", "agent-1", "stale-lease", 30000);
				}).toThrow(LeaseConflictError);
			});

			it("throws LeaseConflictError when command does not exist", () => {
				mockDb.heartbeat.mockReturnValue(false);

				expect(() => {
					service.recordHeartbeat("nonexistent-cmd", "agent-1", "lease-123", 30000);
				}).toThrow(LeaseConflictError);
			});

			it("throws LeaseConflictError when agent does not match", () => {
				mockDb.heartbeat.mockReturnValue(false);

				expect(() => {
					service.recordHeartbeat("cmd-1", "wrong-agent", "lease-123", 30000);
				}).toThrow(LeaseConflictError);
			});
		});
	});

	describe("completeCommand", () => {
		describe("normal paths", () => {
			it("completes command successfully when lease is current", () => {
				mockDb.completeCommand.mockReturnValue(true);
				const result = { ok: true, tookMs: 5034 };

				// Should not throw
				expect(() => {
					service.completeCommand("cmd-1", "agent-1", "lease-123", result);
				}).not.toThrow();

				expect(mockDb.completeCommand).toHaveBeenCalledWith(
					"cmd-1",
					"agent-1",
					"lease-123",
					result,
				);
			});

			it("completes HTTP_GET_JSON command with result", () => {
				mockDb.completeCommand.mockReturnValue(true);
				const result = {
					status: 200,
					body: { data: "test" },
					truncated: false,
					bytesReturned: 50,
					error: null,
				};

				service.completeCommand("cmd-1", "agent-1", "lease-123", result);

				expect(mockDb.completeCommand).toHaveBeenCalledWith(
					"cmd-1",
					"agent-1",
					"lease-123",
					result,
				);
			});
		});

		describe("error conditions", () => {
			it("throws LeaseConflictError when lease is not current", () => {
				mockDb.completeCommand.mockReturnValue(false);

				expect(() => {
					service.completeCommand("cmd-1", "agent-1", "stale-lease", { ok: true, tookMs: 100 });
				}).toThrow(LeaseConflictError);
			});

			it("throws LeaseConflictError when command is already completed", () => {
				mockDb.completeCommand.mockReturnValue(false);

				expect(() => {
					service.completeCommand("cmd-1", "agent-1", "lease-123", { ok: true, tookMs: 100 });
				}).toThrow(LeaseConflictError);
			});
		});
	});

	describe("failCommand", () => {
		describe("normal paths", () => {
			it("fails command successfully with error message", () => {
				mockDb.failCommand.mockReturnValue(true);

				// Should not throw
				expect(() => {
					service.failCommand("cmd-1", "agent-1", "lease-123", "Connection timeout");
				}).not.toThrow();

				expect(mockDb.failCommand).toHaveBeenCalledWith(
					"cmd-1",
					"agent-1",
					"lease-123",
					"Connection timeout",
					undefined,
				);
			});

			it("fails command with error and optional result", () => {
				mockDb.failCommand.mockReturnValue(true);
				const partialResult = { status: 500, body: null, truncated: false, bytesReturned: 0, error: "Server error" };

				service.failCommand("cmd-1", "agent-1", "lease-123", "HTTP error", partialResult);

				expect(mockDb.failCommand).toHaveBeenCalledWith(
					"cmd-1",
					"agent-1",
					"lease-123",
					"HTTP error",
					partialResult,
				);
			});
		});

		describe("error conditions", () => {
			it("throws LeaseConflictError when lease is not current", () => {
				mockDb.failCommand.mockReturnValue(false);

				expect(() => {
					service.failCommand("cmd-1", "agent-1", "stale-lease", "Error message");
				}).toThrow(LeaseConflictError);
			});
		});

		describe("edge cases", () => {
			it("handles empty error message", () => {
				mockDb.failCommand.mockReturnValue(true);

				service.failCommand("cmd-1", "agent-1", "lease-123", "");

				expect(mockDb.failCommand).toHaveBeenCalledWith(
					"cmd-1",
					"agent-1",
					"lease-123",
					"",
					undefined,
				);
			});
		});
	});

	describe("resetExpiredLeases", () => {
		describe("normal paths", () => {
			it("returns count of reset commands", () => {
				mockDb.resetExpiredLeases.mockReturnValue(5);

				const count = service.resetExpiredLeases();

				expect(count).toBe(5);
				expect(mockDb.resetExpiredLeases).toHaveBeenCalledWith(fixedTimestamp);
			});

			it("returns 0 when no expired leases exist", () => {
				mockDb.resetExpiredLeases.mockReturnValue(0);

				const count = service.resetExpiredLeases();

				expect(count).toBe(0);
			});

			it("uses injected clock for timestamp", () => {
				const customTimestamp = 7777777777777;
				mockClock.mockReturnValue(customTimestamp);
				mockDb.resetExpiredLeases.mockReturnValue(3);

				service.resetExpiredLeases();

				expect(mockDb.resetExpiredLeases).toHaveBeenCalledWith(customTimestamp);
			});
		});
	});

	describe("error classes", () => {
		it("CommandNotFoundError has correct properties", () => {
			const error = new CommandNotFoundError("cmd-123");

			expect(error).toBeInstanceOf(Error);
			expect(error.name).toBe("CommandNotFoundError");
			expect(error.message).toContain("cmd-123");
		});

		it("LeaseConflictError has correct properties", () => {
			const error = new LeaseConflictError("cmd-123", "lease-456");

			expect(error).toBeInstanceOf(Error);
			expect(error.name).toBe("LeaseConflictError");
			expect(error.message).toMatch(/lease|conflict/i);
		});

		it("InvalidCommandTypeError has correct properties", () => {
			const error = new InvalidCommandTypeError("INVALID");

			expect(error).toBeInstanceOf(Error);
			expect(error.name).toBe("InvalidCommandTypeError");
			expect(error.message).toContain("INVALID");
		});

		it("InvalidPayloadError has correct properties", () => {
			const error = new InvalidPayloadError("Missing required field: ms");

			expect(error).toBeInstanceOf(Error);
			expect(error.name).toBe("InvalidPayloadError");
			expect(error.message).toContain("ms");
		});
	});
});
