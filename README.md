# vigilator-ts-sdk

[![npm](https://img.shields.io/npm/v/@vigilator/sdk)](https://www.npmjs.com/package/@vigilator/sdk)
[![Release](https://img.shields.io/github/v/release/vigilator/vigilator-ts-sdk)](https://img.shields.io/github/v/release/vigilator/vigilator-ts-sdk)
[![Build status](https://img.shields.io/github/actions/workflow/status/vigilator/vigilator-ts-sdk/main.yml?branch=main)](https://github.com/vigilator/vigilator-ts-sdk/actions/workflows/main.yml?query=branch%3Amain)
[![codecov](https://codecov.io/gh/vigilator/vigilator-ts-sdk/branch/main/graph/badge.svg)](https://codecov.io/gh/vigilator/vigilator-ts-sdk)
[![Commit activity](https://img.shields.io/github/commit-activity/m/vigilator/vigilator-ts-sdk)](https://img.shields.io/github/commit-activity/m/vigilator/vigilator-ts-sdk)
[![License](https://img.shields.io/github/license/vigilator/vigilator-ts-sdk)](https://img.shields.io/github/license/vigilator/vigilator-ts-sdk)

`@vigilator/sdk` is the TypeScript SDK for the Vigilator API.

- **Github repository**: <https://github.com/vigilator/vigilator-ts-sdk/>
- **Documentation** <https://docs.vigilator.ai/technical/typescript>

## Usage

```bash
bun add @vigilator/sdk   # or: npm install @vigilator/sdk
```

```ts
import { Client, WebhookHandler } from "@vigilator/sdk";

const client = new Client({ apiKey: "vgl_..." });

// Open an interrupt and poll for the outcome.
const interrupt = await client.createInterrupt({
  title: "Send onboarding email",
  description: "The agent wants to email a new customer.",
  actionRequests: [
    {
      name: "send_email",
      args: { to: "customer@example.com" },
      allowedDecisions: ["approve", "edit", "reject"],
    },
  ],
});
const result = await client.getInterrupt(interrupt.id);

// Or let Vigilator call you: verify and dispatch webhook deliveries.
const webhooks = new WebhookHandler({ secret: "whsec_..." });
webhooks.on("interrupt.answered", (event) => {
  console.log(event.data.actionRequests);
});
```

The SDK has no runtime dependencies: it uses the platform `fetch` and WebCrypto, so it runs on Node 20+, Bun, Deno and edge runtimes. See the [documentation](https://docs.vigilator.ai/technical/typescript) for the full guide and API reference.

## Getting started with the vigilator SDK for development

### 1. Set Up Your Development Environment

Install [Bun](https://bun.sh), then install the dependencies and the git hooks with

```bash
bun install
```

This will also generate your `bun.lock` file.

### 2. Run the checks

Lint and format, type-check, and run the tests with:

```bash
bun run check
bun run typecheck
bun run test
```

`bun run build` bundles the package into `dist/` (ESM + CJS + declarations). With `CI=true` it also runs [publint](https://publint.dev) and [Are The Types Wrong](https://arethetypeswrong.github.io) against the result.

### 3. Commit the changes

Lastly, commit the changes made by the steps above to your repository.

```bash
git add .
git commit -m 'chore: fix formatting issues'
git push origin main
```

You are now ready to start development on your project!
The CI/CD pipeline will be triggered when you open a pull request, merge to main, or when you create a new release.

## Commit messages

This project uses [commitlint](https://commitlint.js.org) to enforce the [Conventional Commits](https://www.conventionalcommits.org/) standard. A git hook (installed by `bun install` via husky) validates every commit message and rejects the commit if it does not follow the convention.

Commit messages must have the form `<type>(<optional scope>): <description>`, for example:

```
feat(client): add retry support to API requests
fix: handle empty responses from the vigilator API
docs: document the authentication flow
```

Common types are `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, and `chore`. Use `feat` for changes that should trigger a minor version bump and `fix` for a patch bump; add a `BREAKING CHANGE:` footer (or `!` after the type) for breaking changes.

## Releasing a new version

The project version lives in `package.json`. To release:

1. Add the release notes to `CHANGELOG.md`, then bump the version and create a git tag (in the form `*.*.*`, no `v` prefix - `.npmrc` configures this) in one step:

```bash
npm version minor   # or major / patch
git push --follow-tags
```

While the project is on major version `0`, breaking changes bump the minor version instead of the major version.

2. Create a [new release](https://github.com/vigilator/vigilator-ts-sdk/releases/new) on Github from the pushed tag. The release workflow builds the package and publishes it to npm with provenance.

## Generating types

The API types in `src/generated/api.d.ts` are generated from the live OpenAPI spec with [openapi-typescript](https://openapi-ts.dev). To regenerate them run `bun run generate`; it expects `http://localhost:3000/api/spec.json` to be available (a Vigilator dev server started with `bun run dev:no-auth`). Point `SPEC_URL` at another instance to use a different one.
