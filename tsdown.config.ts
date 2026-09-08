import { defineConfig } from "tsdown";

export default defineConfig({
	entry: "src/index.ts",
	format: ["esm", "cjs"],
	// Runs on Node, Bun, Deno and edge runtimes alike: only web-standard APIs
	// (fetch, WebCrypto, TextEncoder) are used, never node: builtins.
	platform: "neutral",
	target: "es2022",
	// The build config turns on isolatedDeclarations, so declaration files
	// are emitted without a full type-check pass.
	tsconfig: "tsconfig.build.json",
	dts: true,
	clean: true,
	// Package-shape checks (exports map, type resolution) run in CI only so a
	// local build stays fast.
	publint: "ci-only",
	attw: "ci-only",
	failOnWarn: "ci-only",
});
