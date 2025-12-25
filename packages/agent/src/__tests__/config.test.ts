/**
 * Tests for agent configuration module
 *
 * Covers:
 * - CLI argument parsing
 * - Environment variable support
 * - Default value application
 * - Failure simulation flags
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfigFresh } from "./test-utils";

describe("Agent Config", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		vi.resetModules();
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	describe("loadConfig", () => {
		describe("with CLI arguments", () => {
			it("parses --agent-id flag", async () => {
				const config = await loadConfigFresh(["--agent-id=test-agent-123"]);
				expect(config.agentId).toBe("test-agent-123");
			});

			it("parses --server-url flag", async () => {
				const config = await loadConfigFresh(["--server-url=http://custom:8080"]);
				expect(config.serverUrl).toBe("http://custom:8080");
			});

			it("parses --state-dir flag", async () => {
				const config = await loadConfigFresh(["--state-dir=/custom/state"]);
				expect(config.stateDir).toBe("/custom/state");
			});

			it("parses --max-lease-ms flag", async () => {
				const config = await loadConfigFresh(["--max-lease-ms=60000"]);
				expect(config.maxLeaseMs).toBe(60000);
			});

			it("parses --heartbeat-interval-ms flag", async () => {
				const config = await loadConfigFresh(["--heartbeat-interval-ms=5000"]);
				expect(config.heartbeatIntervalMs).toBe(5000);
			});

			it("parses --poll-interval-ms flag", async () => {
				const config = await loadConfigFresh(["--poll-interval-ms=2000"]);
				expect(config.pollIntervalMs).toBe(2000);
			});

			it("parses multiple CLI arguments together", async () => {
				const config = await loadConfigFresh([
					"--agent-id=multi-arg-agent",
					"--server-url=http://multi:3000",
					"--max-lease-ms=45000",
				]);
				expect(config.agentId).toBe("multi-arg-agent");
				expect(config.serverUrl).toBe("http://multi:3000");
				expect(config.maxLeaseMs).toBe(45000);
			});
		});

		describe("with environment variables", () => {
			it("reads AGENT_ID from environment", async () => {
				process.env.AGENT_ID = "env-agent-456";
				const config = await loadConfigFresh([]);
				expect(config.agentId).toBe("env-agent-456");
			});

			it("reads SERVER_URL from environment", async () => {
				process.env.SERVER_URL = "http://env-server:9000";
				const config = await loadConfigFresh([]);
				expect(config.serverUrl).toBe("http://env-server:9000");
			});

			it("reads AGENT_STATE_DIR from environment", async () => {
				process.env.AGENT_STATE_DIR = "/env/state/dir";
				const config = await loadConfigFresh([]);
				expect(config.stateDir).toBe("/env/state/dir");
			});

			it("reads MAX_LEASE_MS from environment", async () => {
				process.env.MAX_LEASE_MS = "90000";
				const config = await loadConfigFresh([]);
				expect(config.maxLeaseMs).toBe(90000);
			});

			it("reads HEARTBEAT_INTERVAL_MS from environment", async () => {
				process.env.HEARTBEAT_INTERVAL_MS = "15000";
				const config = await loadConfigFresh([]);
				expect(config.heartbeatIntervalMs).toBe(15000);
			});

			it("reads POLL_INTERVAL_MS from environment", async () => {
				process.env.POLL_INTERVAL_MS = "3000";
				const config = await loadConfigFresh([]);
				expect(config.pollIntervalMs).toBe(3000);
			});
		});

		describe("CLI precedence over environment", () => {
			it("CLI --agent-id takes precedence over AGENT_ID env", async () => {
				process.env.AGENT_ID = "env-agent";
				const config = await loadConfigFresh(["--agent-id=cli-agent"]);
				expect(config.agentId).toBe("cli-agent");
			});

			it("CLI --server-url takes precedence over SERVER_URL env", async () => {
				process.env.SERVER_URL = "http://env:1000";
				const config = await loadConfigFresh(["--server-url=http://cli:2000"]);
				expect(config.serverUrl).toBe("http://cli:2000");
			});
		});

		describe("default values", () => {
			it("uses sensible defaults when no config provided", async () => {
				const config = await loadConfigFresh([]);

				// agentId should be auto-generated with format agent-xxxxxxxx
				expect(config.agentId).toMatch(/^agent-[a-f0-9]{8}$/);
				expect(config.serverUrl).toBe("http://localhost:3000");
				expect(config.stateDir).toBe(".agent-state");
				expect(config.maxLeaseMs).toBe(30000);
				expect(config.heartbeatIntervalMs).toBe(10000);
				expect(config.pollIntervalMs).toBe(1000);
				expect(config.killAfterSeconds).toBeNull();
				expect(config.randomFailures).toBe(false);
			});
		});

		describe("failure simulation flags", () => {
			it("parses --kill-after flag as seconds", async () => {
				const config = await loadConfigFresh(["--kill-after=30"]);
				expect(config.killAfterSeconds).toBe(30);
			});

			it("--kill-after is null when not provided", async () => {
				const config = await loadConfigFresh([]);
				expect(config.killAfterSeconds).toBeNull();
			});

			it("parses --random-failures as boolean flag", async () => {
				const config = await loadConfigFresh(["--random-failures"]);
				expect(config.randomFailures).toBe(true);
			});

			it("--random-failures is false when not provided", async () => {
				const config = await loadConfigFresh([]);
				expect(config.randomFailures).toBe(false);
			});

			it("handles both failure simulation flags together", async () => {
				const config = await loadConfigFresh(["--kill-after=60", "--random-failures"]);
				expect(config.killAfterSeconds).toBe(60);
				expect(config.randomFailures).toBe(true);
			});
		});

		describe("edge cases", () => {
			it("handles empty args array", async () => {
				const config = await loadConfigFresh([]);
				expect(config).toBeDefined();
				expect(config.agentId).toBeDefined();
			});

			it("ignores unknown flags", async () => {
				const config = await loadConfigFresh(["--unknown-flag=value", "--agent-id=test"]);
				expect(config.agentId).toBe("test");
			});

			it("handles malformed numeric values with fallback to defaults", async () => {
				const config = await loadConfigFresh(["--max-lease-ms=not-a-number"]);
				expect(config.maxLeaseMs).toBe(30000); // Should fall back to default
			});
		});
	});

	describe("AgentConfig interface", () => {
		it("exports AgentConfig type with all required fields", async () => {
			const config = await loadConfigFresh([]);

			// Type checking - all fields must exist
			const requiredFields: (keyof typeof config)[] = [
				"agentId",
				"serverUrl",
				"stateDir",
				"maxLeaseMs",
				"heartbeatIntervalMs",
				"pollIntervalMs",
				"killAfterSeconds",
				"randomFailures",
			];

			for (const field of requiredFields) {
				expect(config).toHaveProperty(field);
			}
		});
	});
});
