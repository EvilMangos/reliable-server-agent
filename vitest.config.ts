import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["packages/**/*.test.ts", "packages/**/*.spec.ts"],
		exclude: ["**/node_modules/**", "**/dist/**"],
		pool: "forks",
		poolOptions: {
			forks: {
				singleFork: true, // Run all tests in a single fork to share process
			},
		},
		// Run tests sequentially to avoid port conflicts and signal handler interference
		sequence: {
			concurrent: false,
		},
		// Disable file parallelism - run test files sequentially
		// fileParallelism: false,
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
			include: ["packages/*/src/**/*.ts"],
			exclude: ["**/*.test.ts", "**/*.spec.ts", "**/index.ts"],
		},
		testTimeout: 30000,
		hookTimeout: 30000,
	},
});
