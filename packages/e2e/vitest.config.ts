import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["src/**/*.test.ts"],
		exclude: ["**/node_modules/**", "**/dist/**"],
		testTimeout: 120000, // 2 minutes for E2E tests
		hookTimeout: 60000, // 1 minute for setup/teardown
		// Run tests sequentially to avoid port conflicts
		pool: "forks",
		poolOptions: {
			forks: {
				singleFork: true,
			},
		},
	},
});
