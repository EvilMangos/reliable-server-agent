/**
 * Journal Helpers for E2E Tests
 *
 * Provides utilities for reading, writing, and manipulating agent journals.
 * Used for testing crash recovery scenarios where we need to simulate
 * partially completed operations.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentJournal, HttpGetJsonResult, JournalStage } from "@reliable-server-agent/shared";

/**
 * Get the path to an agent's journal file
 */
export function getJournalPath(stateDir: string, agentId: string): string {
	return path.join(stateDir, `${agentId}.json`);
}

/**
 * Check if a journal file exists for an agent
 */
export function journalExists(stateDir: string, agentId: string): boolean {
	const journalPath = getJournalPath(stateDir, agentId);
	return fs.existsSync(journalPath);
}

/**
 * Read an agent's journal file
 * @returns The journal contents or null if not found
 */
export function readJournal(stateDir: string, agentId: string): AgentJournal | null {
	const journalPath = getJournalPath(stateDir, agentId);

	if (!fs.existsSync(journalPath)) {
		return null;
	}

	try {
		const content = fs.readFileSync(journalPath, "utf-8");
		return JSON.parse(content) as AgentJournal;
	} catch {
		return null;
	}
}

/**
 * Write an agent's journal file atomically (temp file + rename)
 */
export function writeJournal(stateDir: string, agentId: string, journal: AgentJournal): void {
	// Ensure state directory exists
	fs.mkdirSync(stateDir, { recursive: true });

	const journalPath = getJournalPath(stateDir, agentId);
	const tempPath = `${journalPath}.${Date.now()}.tmp`;

	// Write to temp file first
	fs.writeFileSync(tempPath, JSON.stringify(journal, null, 2), "utf-8");

	// Atomic rename
	fs.renameSync(tempPath, journalPath);
}

/**
 * Delete an agent's journal file
 */
export function deleteJournal(stateDir: string, agentId: string): void {
	const journalPath = getJournalPath(stateDir, agentId);

	if (fs.existsSync(journalPath)) {
		fs.unlinkSync(journalPath);
	}
}

/**
 * Create a journal entry for testing crash recovery scenarios
 */
export function createTestJournal(options: {
	commandId: string;
	leaseId: string;
	type: "DELAY" | "HTTP_GET_JSON";
	startedAt?: number;
	scheduledEndAt?: number | null;
	httpSnapshot?: HttpGetJsonResult | null;
	stage: JournalStage;
}): AgentJournal {
	return {
		commandId: options.commandId,
		leaseId: options.leaseId,
		type: options.type,
		startedAt: options.startedAt ?? Date.now(),
		scheduledEndAt: options.scheduledEndAt ?? null,
		httpSnapshot: options.httpSnapshot ?? null,
		stage: options.stage,
	};
}

/**
 * Create a journal with a saved HTTP result (simulates crash after fetch but before complete)
 */
export function createHttpResultSavedJournal(options: {
	commandId: string;
	leaseId: string;
	startedAt?: number;
	httpResult: HttpGetJsonResult;
}): AgentJournal {
	return createTestJournal({
		commandId: options.commandId,
		leaseId: options.leaseId,
		type: "HTTP_GET_JSON",
		startedAt: options.startedAt,
		httpSnapshot: options.httpResult,
		stage: "RESULT_SAVED",
	});
}

/**
 * Create a journal for a DELAY command in progress
 */
export function createDelayInProgressJournal(options: {
	commandId: string;
	leaseId: string;
	startedAt: number;
	scheduledEndAt: number;
}): AgentJournal {
	return createTestJournal({
		commandId: options.commandId,
		leaseId: options.leaseId,
		type: "DELAY",
		startedAt: options.startedAt,
		scheduledEndAt: options.scheduledEndAt,
		stage: "IN_PROGRESS",
	});
}

/**
 * Wait for a journal to appear with a specific stage
 */
export async function waitForJournalStage(
	stateDir: string,
	agentId: string,
	expectedStage: JournalStage,
	timeoutMs: number = 10000,
): Promise<AgentJournal> {
	const startTime = Date.now();

	while (Date.now() - startTime < timeoutMs) {
		const journal = readJournal(stateDir, agentId);
		if (journal && journal.stage === expectedStage) {
			return journal;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}

	throw new Error(`Timeout waiting for journal stage ${expectedStage} after ${timeoutMs}ms`);
}

/**
 * Wait for a journal to be deleted (indicates successful completion)
 */
export async function waitForJournalDeleted(
	stateDir: string,
	agentId: string,
	timeoutMs: number = 10000,
): Promise<void> {
	const startTime = Date.now();

	while (Date.now() - startTime < timeoutMs) {
		if (!journalExists(stateDir, agentId)) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}

	throw new Error(`Timeout waiting for journal deletion after ${timeoutMs}ms`);
}
