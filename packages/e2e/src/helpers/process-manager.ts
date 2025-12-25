/**
 * Process Manager for E2E Tests
 *
 * Spawns and manages server and agent processes as child processes.
 * Provides methods for starting, stopping, and killing processes.
 */

import { type ChildProcess, spawn } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Go up: helpers -> src -> e2e -> packages
const PACKAGES_DIR = path.resolve(__dirname, "../../..");

/**
 * Get the tsx executable path for a package.
 * Falls back to system tsx if package-local tsx is not found.
 */
function getTsxPath(packageDir: string): string {
	// Try package-local tsx first
	const localTsx = path.join(packageDir, "node_modules", ".bin", "tsx");
	if (fs.existsSync(localTsx)) {
		return localTsx;
	}
	// Fall back to system tsx (should be in PATH)
	return "tsx";
}

export interface ProcessOptions {
	env?: Record<string, string>;
	cwd?: string;
}

export interface ServerProcess {
	process: ChildProcess;
	port: number;
	dbPath: string;
	stop: () => Promise<void>;
	kill: () => void;
}

export interface AgentProcess {
	process: ChildProcess;
	agentId: string;
	stateDir: string;
	stop: () => Promise<void>;
	kill: () => void;
}

/**
 * Wait for a process to output a specific pattern
 */
function waitForOutput(
	proc: ChildProcess,
	pattern: RegExp,
	timeoutMs: number = 10000,
): Promise<string> {
	return new Promise((resolve, reject) => {
		let output = "";
		const timeout = setTimeout(() => {
			reject(new Error(`Timeout waiting for pattern ${pattern} in output: ${output}`));
		}, timeoutMs);

		const onData = (data: Buffer) => {
			output += data.toString();
			const match = pattern.exec(output);
			if (match) {
				clearTimeout(timeout);
				proc.stdout?.off("data", onData);
				proc.stderr?.off("data", onData);
				resolve(match[0]);
			}
		};

		proc.stdout?.on("data", onData);
		proc.stderr?.on("data", onData);

		proc.on("error", (err) => {
			clearTimeout(timeout);
			reject(err);
		});

		proc.on("exit", (code) => {
			clearTimeout(timeout);
			if (!pattern.test(output)) {
				reject(new Error(`Process exited with code ${code} before pattern found. Output: ${output}`));
			}
		});
	});
}

/**
 * Start the Control Server as a child process
 */
export async function startServer(options: {
	port?: number;
	dbPath?: string;
	tempDir: string;
}): Promise<ServerProcess> {
	const port = options.port ?? 0;
	const dbPath = options.dbPath ?? path.join(options.tempDir, "commands.db");

	// Ensure temp directory exists
	fs.mkdirSync(path.dirname(dbPath), { recursive: true });

	const serverDir = path.join(PACKAGES_DIR, "server");
	const tsxPath = getTsxPath(serverDir);
	const proc = spawn(tsxPath, ["src/index.ts"], {
		cwd: serverDir,
		env: {
			...process.env,
			PORT: String(port),
			DATABASE_PATH: dbPath,
		},
		stdio: ["pipe", "pipe", "pipe"],
	});

	// Wait for server to start and extract port
	const startupOutput = await waitForOutput(
		proc,
		/Server started on port (\d+)/,
		15000,
	);

	const portMatch = /port (\d+)/.exec(startupOutput);
	const actualPort = portMatch ? parseInt(portMatch[1], 10) : port;

	const stop = async (): Promise<void> => {
		if (proc.killed) return;
		proc.kill("SIGTERM");
		await Promise.race([
			new Promise<void>((resolve) => proc.on("exit", () => resolve())),
			new Promise<void>((resolve) => setTimeout(resolve, 2000)),
		]);
	};

	const kill = (): void => {
		if (!proc.killed) {
			proc.kill("SIGKILL");
		}
	};

	return {
		process: proc,
		port: actualPort,
		dbPath,
		stop,
		kill,
	};
}

/**
 * Start an Agent as a child process
 */
export async function startAgent(options: {
	agentId: string;
	serverUrl: string;
	stateDir: string;
	pollIntervalMs?: number;
	heartbeatIntervalMs?: number;
	maxLeaseMs?: number;
	killAfterSeconds?: number;
	randomFailures?: boolean;
}): Promise<AgentProcess> {
	const agentDir = path.join(PACKAGES_DIR, "agent");
	const tsxPath = getTsxPath(agentDir);

	// Ensure state directory exists
	fs.mkdirSync(options.stateDir, { recursive: true });

	const args = [
		"src/index.ts",
		`--agent-id=${options.agentId}`,
		`--server-url=${options.serverUrl}`,
		`--state-dir=${options.stateDir}`,
	];

	if (options.pollIntervalMs !== undefined) {
		args.push(`--poll-interval-ms=${options.pollIntervalMs}`);
	}
	if (options.heartbeatIntervalMs !== undefined) {
		args.push(`--heartbeat-interval-ms=${options.heartbeatIntervalMs}`);
	}
	if (options.maxLeaseMs !== undefined) {
		args.push(`--max-lease-ms=${options.maxLeaseMs}`);
	}
	if (options.killAfterSeconds !== undefined) {
		args.push(`--kill-after=${options.killAfterSeconds}`);
	}
	if (options.randomFailures) {
		args.push("--random-failures");
	}

	const proc = spawn(tsxPath, args, {
		cwd: agentDir,
		env: process.env,
		stdio: ["pipe", "pipe", "pipe"],
	});

	// Wait for agent to start
	await waitForOutput(proc, /Agent .* starting/, 10000);

	const stop = async (): Promise<void> => {
		// Check if process already exited
		if (proc.killed || proc.exitCode !== null) {
			return;
		}
		try {
			proc.kill("SIGTERM");
			await Promise.race([
				new Promise<void>((resolve) => proc.on("exit", () => resolve())),
				new Promise<void>((resolve) => setTimeout(resolve, 2000)),
			]);
		} catch {
			// Process may have already exited between check and kill
			// This is expected in crash/failure tests
		}
	};

	const kill = (): void => {
		// Check if process already exited
		if (proc.killed || proc.exitCode !== null) {
			return;
		}
		try {
			proc.kill("SIGKILL");
		} catch {
			// Process may have already exited between check and kill
		}
	};

	return {
		process: proc,
		agentId: options.agentId,
		stateDir: options.stateDir,
		stop,
		kill,
	};
}

/**
 * Create a temporary directory for test isolation
 */
export function createTempDir(prefix: string): string {
	const baseDir = path.join(PACKAGES_DIR, "..", ".e2e-temp");
	fs.mkdirSync(baseDir, { recursive: true });
	return fs.mkdtempSync(path.join(baseDir, `${prefix}-`));
}

/**
 * Clean up a temporary directory
 */
export function cleanupTempDir(dir: string): void {
	try {
		fs.rmSync(dir, { recursive: true, force: true });
	} catch {
		// Ignore cleanup errors
	}
}
