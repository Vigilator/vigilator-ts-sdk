import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["tests/**/*.test.ts"],
		restoreMocks: true,
		coverage: {
			provider: "v8",
			include: ["src/**"],
			exclude: ["src/generated/**"],
			reporter: ["text", "lcov"],
		},
	},
});
