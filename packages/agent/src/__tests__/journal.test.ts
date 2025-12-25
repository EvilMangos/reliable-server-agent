/**
 * Tests for JournalManagerImpl
 *
 * Covers:
 * - Atomic write pattern (temp file + rename)
 * - Journal persistence and recovery
 * - Journal deletion
 * - Stage and snapshot updates
 * - Error handling during write operations
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentJournal } from "@reliable-server-agent/shared";
import { COMMAND_TYPE } from "@reliable-server-agent/shared";
import { JournalManagerImpl } from "../journal.js";
import {
	cleanupTempDir,
	createMockLogger,
	createTempDir,
} from "./test-utils.js";

describe("JournalManagerImpl", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = createTempDir("journal-test-");
	});

	afterEach(() => {
		cleanupTempDir(tempDir);
		vi.restoreAllMocks();
	});

	describe("atomic write pattern", () => {
		it("saves journal to final path successfully", () => {
			const logger = createMockLogger();
			const manager = new JournalManagerImpl(tempDir, "test-agent", logger);

			const journal: AgentJournal = {
				commandId: "cmd-123",
				leaseId: "lease-456",
				type: COMMAND_TYPE.DELAY,
				startedAt: Date.now(),
				scheduledEndAt: Date.now() + 5000,
				httpSnapshot: null,
				stage: "CLAIMED",
			};

			manager.save(journal);

			// Verify the final file exists with correct content
			const journalPath = manager.getJournalPath();
			expect(fs.existsSync(journalPath)).toBe(true);

			const content = JSON.parse(fs.readFileSync(journalPath, "utf-8"));
			expect(content.commandId).toBe("cmd-123");
			expect(content.leaseId).toBe("lease-456");
		});

		it("does not leave temp files after successful save", () => {
			const logger = createMockLogger();
			const agentId = "no-temp-files";
			const manager = new JournalManagerImpl(tempDir, agentId, logger);

			const journal: AgentJournal = {
				commandId: "cmd-123",
				leaseId: "lease-456",
				type: COMMAND_TYPE.DELAY,
				startedAt: Date.now(),
				scheduledEndAt: Date.now() + 5000,
				httpSnapshot: null,
				stage: "CLAIMED",
			};

			manager.save(journal);

			// Check for any .tmp files in the directory
			const files = fs.readdirSync(tempDir);
			const tempFiles = files.filter((f) => f.endsWith(".tmp"));
			expect(tempFiles.length).toBe(0);
		});

		it("can save multiple times without file conflicts", () => {
			const logger = createMockLogger();
			const manager = new JournalManagerImpl(tempDir, "test-agent", logger);

			const journal1: AgentJournal = {
				commandId: "cmd-1",
				leaseId: "lease-1",
				type: COMMAND_TYPE.DELAY,
				startedAt: Date.now(),
				scheduledEndAt: Date.now() + 5000,
				httpSnapshot: null,
				stage: "CLAIMED",
			};

			const journal2: AgentJournal = {
				commandId: "cmd-2",
				leaseId: "lease-2",
				type: COMMAND_TYPE.DELAY,
				startedAt: Date.now(),
				scheduledEndAt: Date.now() + 5000,
				httpSnapshot: null,
				stage: "IN_PROGRESS",
			};

			// Save twice - should not throw
			manager.save(journal1);
			manager.save(journal2);

			// Last write wins
			const loaded = manager.load();
			expect(loaded?.commandId).toBe("cmd-2");
			expect(loaded?.stage).toBe("IN_PROGRESS");
		});
	});

	describe("journal persistence", () => {
		it("saves and loads journal correctly", () => {
			const logger = createMockLogger();
			const manager = new JournalManagerImpl(tempDir, "test-agent", logger);

			const journal: AgentJournal = {
				commandId: "cmd-persist",
				leaseId: "lease-persist",
				type: COMMAND_TYPE.HTTP_GET_JSON,
				startedAt: 1234567890,
				scheduledEndAt: null,
				httpSnapshot: {
					status: 200,
					body: { test: true },
					truncated: false,
					bytesReturned: 12,
					error: null,
				},
				stage: "RESULT_SAVED",
			};

			manager.save(journal);
			const loaded = manager.load();

			expect(loaded).toEqual(journal);
		});

		it("returns null when no journal file exists", () => {
			const logger = createMockLogger();
			const manager = new JournalManagerImpl(tempDir, "nonexistent-agent", logger);

			const loaded = manager.load();

			expect(loaded).toBeNull();
		});

		it("returns null when journal file is corrupted", () => {
			const logger = createMockLogger();
			const agentId = "corrupted-agent";
			const manager = new JournalManagerImpl(tempDir, agentId, logger);

			// Write corrupted content directly
			const journalPath = path.join(tempDir, `${agentId}.json`);
			fs.mkdirSync(tempDir, { recursive: true });
			fs.writeFileSync(journalPath, "{ not valid json");

			const loaded = manager.load();

			expect(loaded).toBeNull();
			expect(logger.error).toHaveBeenCalled();
		});

		it("creates state directory if it does not exist", () => {
			const nestedDir = path.join(tempDir, "nested", "state", "dir");
			const logger = createMockLogger();
			const manager = new JournalManagerImpl(nestedDir, "test-agent", logger);

			const journal: AgentJournal = {
				commandId: "cmd-123",
				leaseId: "lease-456",
				type: COMMAND_TYPE.DELAY,
				startedAt: Date.now(),
				scheduledEndAt: Date.now() + 5000,
				httpSnapshot: null,
				stage: "CLAIMED",
			};

			manager.save(journal);

			expect(fs.existsSync(nestedDir)).toBe(true);
			expect(logger.info).toHaveBeenCalledWith(
				expect.stringContaining("Created state directory"),
			);
		});
	});

	describe("journal deletion", () => {
		it("deletes journal file when it exists", () => {
			const logger = createMockLogger();
			const manager = new JournalManagerImpl(tempDir, "delete-test", logger);

			const journal: AgentJournal = {
				commandId: "cmd-delete",
				leaseId: "lease-delete",
				type: COMMAND_TYPE.DELAY,
				startedAt: Date.now(),
				scheduledEndAt: Date.now() + 5000,
				httpSnapshot: null,
				stage: "CLAIMED",
			};

			manager.save(journal);
			expect(fs.existsSync(manager.getJournalPath())).toBe(true);

			manager.delete();
			expect(fs.existsSync(manager.getJournalPath())).toBe(false);
		});

		it("does not throw when deleting non-existent journal", () => {
			const logger = createMockLogger();
			const manager = new JournalManagerImpl(tempDir, "no-journal", logger);

			expect(() => manager.delete()).not.toThrow();
		});

		it("handles delete of existing file", () => {
			const logger = createMockLogger();
			const manager = new JournalManagerImpl(tempDir, "delete-success", logger);

			// Create journal first
			const journal: AgentJournal = {
				commandId: "cmd-del",
				leaseId: "lease-del",
				type: COMMAND_TYPE.DELAY,
				startedAt: Date.now(),
				scheduledEndAt: Date.now() + 5000,
				httpSnapshot: null,
				stage: "CLAIMED",
			};
			manager.save(journal);

			// Verify file exists before delete
			expect(fs.existsSync(manager.getJournalPath())).toBe(true);

			// Delete should succeed and log info
			manager.delete();
			expect(fs.existsSync(manager.getJournalPath())).toBe(false);
			expect(logger.info).toHaveBeenCalledWith("Deleted journal");
		});
	});

	describe("createClaimed", () => {
		it("creates and saves a CLAIMED stage journal", () => {
			const logger = createMockLogger();
			const manager = new JournalManagerImpl(tempDir, "create-test", logger);

			const journal = manager.createClaimed(
				"cmd-new",
				"lease-new",
				COMMAND_TYPE.DELAY,
				Date.now(),
				Date.now() + 5000,
			);

			expect(journal.commandId).toBe("cmd-new");
			expect(journal.leaseId).toBe("lease-new");
			expect(journal.type).toBe(COMMAND_TYPE.DELAY);
			expect(journal.stage).toBe("CLAIMED");
			expect(journal.httpSnapshot).toBeNull();

			// Verify it was saved
			const loaded = manager.load();
			expect(loaded).toEqual(journal);
		});

		it("creates journal with null scheduledEndAt for HTTP_GET_JSON", () => {
			const logger = createMockLogger();
			const manager = new JournalManagerImpl(tempDir, "http-create", logger);

			const journal = manager.createClaimed(
				"cmd-http",
				"lease-http",
				COMMAND_TYPE.HTTP_GET_JSON,
				Date.now(),
				null,
			);

			expect(journal.scheduledEndAt).toBeNull();
			expect(journal.type).toBe(COMMAND_TYPE.HTTP_GET_JSON);
		});
	});

	describe("updateStage", () => {
		it("updates stage and saves journal", () => {
			const logger = createMockLogger();
			const manager = new JournalManagerImpl(tempDir, "stage-test", logger);

			const journal = manager.createClaimed(
				"cmd-stage",
				"lease-stage",
				COMMAND_TYPE.DELAY,
				Date.now(),
				Date.now() + 5000,
			);

			expect(journal.stage).toBe("CLAIMED");

			manager.updateStage(journal, "IN_PROGRESS");

			expect(journal.stage).toBe("IN_PROGRESS");

			// Verify it was persisted
			const loaded = manager.load();
			expect(loaded?.stage).toBe("IN_PROGRESS");
		});
	});

	describe("updateHttpSnapshot", () => {
		it("updates httpSnapshot and sets stage to RESULT_SAVED", () => {
			const logger = createMockLogger();
			const manager = new JournalManagerImpl(tempDir, "snapshot-test", logger);

			const journal = manager.createClaimed(
				"cmd-snap",
				"lease-snap",
				COMMAND_TYPE.HTTP_GET_JSON,
				Date.now(),
				null,
			);

			const snapshot = {
				status: 200,
				body: { data: "test" },
				truncated: false,
				bytesReturned: 15,
				error: null,
			};

			manager.updateHttpSnapshot(journal, snapshot);

			expect(journal.httpSnapshot).toEqual(snapshot);
			expect(journal.stage).toBe("RESULT_SAVED");

			// Verify it was persisted
			const loaded = manager.load();
			expect(loaded?.httpSnapshot).toEqual(snapshot);
			expect(loaded?.stage).toBe("RESULT_SAVED");
		});
	});

	describe("getJournalPath", () => {
		it("returns correct path for agent journal file", () => {
			const logger = createMockLogger();
			const manager = new JournalManagerImpl(tempDir, "path-test", logger);

			const expectedPath = path.join(tempDir, "path-test.json");
			expect(manager.getJournalPath()).toBe(expectedPath);
		});
	});

	describe("journal file integrity", () => {
		it("preserves valid JSON structure after multiple saves", () => {
			const logger = createMockLogger();
			const manager = new JournalManagerImpl(tempDir, "integrity-test", logger);

			// Save initial valid state
			const journal: AgentJournal = {
				commandId: "cmd-initial",
				leaseId: "lease-initial",
				type: COMMAND_TYPE.DELAY,
				startedAt: Date.now(),
				scheduledEndAt: Date.now() + 5000,
				httpSnapshot: null,
				stage: "CLAIMED",
			};
			manager.save(journal);

			// Update stage multiple times
			manager.updateStage(journal, "IN_PROGRESS");
			manager.updateStage(journal, "RESULT_SAVED");

			// File should still contain valid JSON
			const journalPath = manager.getJournalPath();
			const content = fs.readFileSync(journalPath, "utf-8");
			expect(() => JSON.parse(content)).not.toThrow();

			// Should be able to load the updated data
			const loaded = manager.load();
			expect(loaded?.stage).toBe("RESULT_SAVED");
			expect(loaded?.commandId).toBe("cmd-initial");
		});

		it("temp files do not interfere with journal loading", () => {
			const logger = createMockLogger();
			const agentId = "temp-interference-test";
			const manager = new JournalManagerImpl(tempDir, agentId, logger);

			// Create the proper journal
			const journal: AgentJournal = {
				commandId: "cmd-proper",
				leaseId: "lease-proper",
				type: COMMAND_TYPE.DELAY,
				startedAt: Date.now(),
				scheduledEndAt: Date.now() + 5000,
				httpSnapshot: null,
				stage: "CLAIMED",
			};
			manager.save(journal);

			// Create orphaned temp files that might exist from crashes
			const tempPath1 = path.join(tempDir, `${agentId}.json.abc123.tmp`);
			const tempPath2 = path.join(tempDir, `${agentId}.json.def456.tmp`);
			fs.writeFileSync(tempPath1, '{"commandId": "bad-temp-1"}');
			fs.writeFileSync(tempPath2, '{"commandId": "bad-temp-2"}');

			// Should still load the correct journal
			const loaded = manager.load();
			expect(loaded?.commandId).toBe("cmd-proper");
		});
	});
});
