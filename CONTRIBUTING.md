# Contributing to `@vigilator/sdk`

Contributions are welcome, and they are greatly appreciated!
Every little bit helps, and credit will always be given.

You can contribute in many ways:

# Types of Contributions

## Report Bugs

Report bugs at https://github.com/vigilator/vigilator-ts-sdk/issues

If you are reporting a bug, please include:

- Your operating system name and version, and the runtime (Node, Bun, Deno, ...) and its version.
- Any details about your local setup that might be helpful in troubleshooting.
- Detailed steps to reproduce the bug.

## Fix Bugs

Look through the GitHub issues for bugs.
Anything tagged with "bug" and "help wanted" is open to whoever wants to implement a fix for it.
Be sure to let others know when you start working on an issue to ensure organisation.

## Implement Features

Look through the GitHub issues for features.
Anything tagged with "enhancement" and "help wanted" is open to whoever wants to implement it.
Be sure to let others know when you start working on an issue to ensure organisation.

## Write Documentation

`@vigilator/sdk` could always use more documentation, whether as part of the official docs, in doc comments, or even on the web in blog posts, articles, and such.

## Submit Feedback

The best way to send feedback is to file an issue at https://github.com/vigilator/vigilator-ts-sdk/issues.

If you are proposing a new feature:

- Explain in detail how it would work.
- Keep the scope as narrow as possible, to make it easier to implement.
- Remember that this is a volunteer-driven project, and that contributions
  are welcome :)

# Get Started!

Ready to contribute? Here's how to set up `@vigilator/sdk` for local development.
Please note this documentation assumes you already have [Bun](https://bun.sh) and `Git` installed and ready to go.

1. Fork the `vigilator-ts-sdk` repo on GitHub.

2. Clone your fork locally:

```bash
cd <directory_in_which_repo_should_be_created>
git clone git@github.com:YOUR_NAME/vigilator-ts-sdk.git
```

3. Now we need to install the dependencies. Navigate into the directory

```bash
cd vigilator-ts-sdk
```

Then install them with:

```bash
bun install
```

This also installs the git hooks (via husky) that run the linter, formatter and type checker at commit time.

4. Create a branch for local development:

```bash
git checkout -b name-of-your-bugfix-or-feature
```

Now you can make your changes locally.

5. Don't forget to add test cases for your added functionality to the `tests` directory.

6. When you're done making changes, check that your changes pass the formatting and type checks.

```bash
bun run check
bun run typecheck
```

Now, validate that all unit tests are passing:

```bash
bun run test
```

7. Before raising a pull request, make sure the package still builds and passes the package-shape checks:

```bash
CI=true bun run build
```

This step is also triggered in the CI/CD pipeline (on Node 20, 22 and 24), so you could also choose to skip this step locally.

8. Commit your changes and push your branch to GitHub.
   Commit messages must follow the [Conventional Commits](https://www.conventionalcommits.org/) standard (see the "Commit messages" section in `README.md`); they are validated by commitlint at commit time:

```bash
git add .
git commit -m "feat: your detailed description of your changes"
git push origin name-of-your-bugfix-or-feature
```

9. Submit a pull request through the GitHub website.

# Pull Request Guidelines

Before you submit a pull request, check that it meets these guidelines:

1. The pull request should include tests.

2. If the pull request adds functionality, the docs should be updated.
   Put your new functionality into a function with a doc comment, and add the feature to the list in `README.md`.
