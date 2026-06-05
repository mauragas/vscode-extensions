# Contributing

Thanks for contributing to `vscode-extensions`.

## Prerequisites

- Node.js 18+ for local development
- Node.js 20+ recommended for creating `.vsix` packages
- Visual Studio Code 1.85+

## Getting started

From the repository root:

```bash
npm install
npm run build
npm run lint
npm test
npm run test:coverage
```

Press `F5` in VS Code to launch the Extension Development Host for the current extension.

## Repository structure

- `extensions/<extension-name>/` — publishable VS Code extensions
- `.vscode/` — shared launch and task configuration
- `eslint.config.mjs` and `tsconfig.base.json` — shared tooling configuration

## Common commands

From the repository root:

```bash
npm run build
npm run lint
npm test
npm run test:coverage
npm run package:git-branches-panel
```

From `extensions/git-branches-panel/`:

```bash
npm run compile
npm run lint
npm run test
npm run test:coverage
npm run package
```

## Pull request checklist

Before opening a pull request:

1. Run build, lint, and test successfully.
2. Run `npm run test:coverage` when you add or change core logic.
3. Update documentation for user-facing changes.
4. Update `CHANGELOG.md` for notable extension changes.
5. Avoid committing generated output unless it is intentionally required.

## Adding a new extension

1. Create `extensions/<extension-name>/`.
2. Add the extension's `package.json`, `README.md`, `CHANGELOG.md`,
   `LICENSE`, `src/`, `resources/`, `test/`, and `tsconfig.json`.
3. Wire root scripts and `.vscode` launch/tasks to the new extension.
4. Keep runtime assets and publishable metadata inside the extension folder.
