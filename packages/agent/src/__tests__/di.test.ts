import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	AGENT,
	CONFIG,
	EXECUTOR_REGISTRY,
	HEARTBEAT_MANAGER,
	JOURNAL_MANAGER,
	LOGGER,
	SERVER_CLIENT,
	createAgent,
	createAgentContainer,
	createContainer,
	createToken,
} from "../di";
import type { Container } from "../di";
import type { AgentConfig } from "../types";
import { cleanupTempDir, createDefaultAgentConfig, createTempDir, createUniqueTokenName } from "./test-utils";

describe("DI Container", () => {
	let container: Container;

	beforeEach(() => {
		container = createContainer();
	});

	describe("createToken", () => {
		it("should create tokens with description", () => {
			const token1 = createToken<string>("Test1");
			const token2 = createToken<string>("Test2");

			// With Symbol.for, same description creates same symbol
			expect(token1.toString()).toContain("Test1");
			expect(token2.toString()).toContain("Test2");
		});

		it("should create same token for same description", () => {
			const token1 = createToken<string>("SameToken");
			const token2 = createToken<string>("SameToken");

			// Symbol.for returns the same symbol for the same key
			expect(token1).toBe(token2);
		});

		it("should create different tokens for different descriptions", () => {
			const token1 = createToken<string>("Token1");
			const token2 = createToken<string>("Token2");

			expect(token1).not.toBe(token2);
		});
	});

	describe("singleton registration", () => {
		it("should return same instance for singleton", () => {
			const token = createToken<{ value: number }>(createUniqueTokenName("TestSingleton"));
			let callCount = 0;

			container.singleton(token, () => {
				callCount++;
				return { value: callCount };
			});

			const first = container.resolve(token);
			const second = container.resolve(token);

			expect(first).toBe(second);
			expect(first.value).toBe(1);
			expect(callCount).toBe(1);
		});
	});

	describe("transient registration", () => {
		it("should return new instance for transient", () => {
			const token = createToken<{ value: number }>(createUniqueTokenName("TestTransient"));
			let callCount = 0;

			container.transient(token, () => {
				callCount++;
				return { value: callCount };
			});

			const first = container.resolve(token);
			const second = container.resolve(token);

			expect(first).not.toBe(second);
			expect(first.value).toBe(1);
			expect(second.value).toBe(2);
			expect(callCount).toBe(2);
		});
	});

	describe("instance registration", () => {
		it("should return registered instance", () => {
			const token = createToken<{ name: string }>(createUniqueTokenName("TestInstance"));
			const instance = { name: "test" };

			container.instance(token, instance);

			expect(container.resolve(token)).toBe(instance);
		});
	});

	describe("has", () => {
		it("should return true for registered token", () => {
			const token = createToken<string>(createUniqueTokenName("TestHas"));
			container.instance(token, "test");

			expect(container.has(token)).toBe(true);
		});

		it("should return false for unregistered token", () => {
			const token = createToken<string>(createUniqueTokenName("TestHasUnregistered"));

			expect(container.has(token)).toBe(false);
		});
	});

	describe("resolve", () => {
		it("should throw for unregistered token", () => {
			const token = createToken<string>(createUniqueTokenName("Unknown"));

			expect(() => container.resolve(token)).toThrow(/No registration found/);
		});

		it("should resolve dependencies from factory", () => {
			const configToken = createToken<{ url: string }>(createUniqueTokenName("Config"));
			const clientToken = createToken<{ config: { url: string } }>(createUniqueTokenName("Client"));

			container.instance(configToken, { url: "http://test" });
			container.singleton(clientToken, (c) => ({
				config: c.resolve(configToken),
			}));

			const client = container.resolve(clientToken);
			expect(client.config.url).toBe("http://test");
		});
	});

	describe("createChild", () => {
		it("should inherit from parent", () => {
			const token = createToken<string>(createUniqueTokenName("ParentToken"));
			container.instance(token, "parent-value");

			const child = container.createChild();

			expect(child.resolve(token)).toBe("parent-value");
		});

		it("should override parent registrations", () => {
			const token = createToken<string>(createUniqueTokenName("OverrideToken"));
			container.instance(token, "parent-value");

			const child = container.createChild();
			child.instance(token, "child-value");

			expect(child.resolve(token)).toBe("child-value");
			expect(container.resolve(token)).toBe("parent-value");
		});

		it("should check parent with has", () => {
			const token = createToken<string>(createUniqueTokenName("ParentHasToken"));
			container.instance(token, "value");

			const child = container.createChild();

			expect(child.has(token)).toBe(true);
		});
	});
});

describe("Composition Root", () => {
	let config: AgentConfig;
	let tempDir: string;

	beforeEach(() => {
		tempDir = createTempDir("di-test-");
		config = createDefaultAgentConfig(tempDir);
	});

	afterEach(() => {
		cleanupTempDir(tempDir);
	});

	describe("createAgentContainer", () => {
		it("should create container with all required dependencies", () => {
			const container = createAgentContainer(config);

			expect(container.has(CONFIG)).toBe(true);
			expect(container.has(LOGGER)).toBe(true);
			expect(container.has(SERVER_CLIENT)).toBe(true);
			expect(container.has(JOURNAL_MANAGER)).toBe(true);
			expect(container.has(HEARTBEAT_MANAGER)).toBe(true);
			expect(container.has(EXECUTOR_REGISTRY)).toBe(true);
			expect(container.has(AGENT)).toBe(true);
		});

		it("should return same config that was provided", () => {
			const container = createAgentContainer(config);

			expect(container.resolve(CONFIG)).toBe(config);
		});

		it("should resolve executor registry with DELAY and HTTP_GET_JSON executors", () => {
			const container = createAgentContainer(config);
			const registry = container.resolve(EXECUTOR_REGISTRY);

			expect(registry.has("DELAY")).toBe(true);
			expect(registry.has("HTTP_GET_JSON")).toBe(true);
		});
	});

	describe("createAgent", () => {
		it("should create agent instance", () => {
			const agent = createAgent(config);

			expect(agent).toBeDefined();
			expect(typeof agent.start).toBe("function");
			expect(typeof agent.stop).toBe("function");
		});
	});
});
