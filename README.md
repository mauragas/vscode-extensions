# VS Code Extensions

This repository hosts multiple Visual Studio Code extensions in one place. Each extension lives under `extensions/<extension-name>/`, keeps its own Marketplace metadata, and can be built or published independently while sharing root development tooling.

## Extensions

- [`extensions/git-branches-panel`](extensions/git-branches-panel) — tree view for local Git branches with folder grouping, sync status, and quick branch actions.

## Repository layout

- `extensions/` — individual publishable VS Code extensions
- `.vscode/` — shared launch and task configuration for local extension development
- `eslint.config.mjs` — shared lint rules
- `tsconfig.base.json` — shared TypeScript compiler defaults

## Development

### Requirements

- Node.js 18+ for local development
- Node.js 20+ recommended for packaging and publishing
- Visual Studio Code 1.85+

### Setup

```bash
npm install
npm run build
npm run lint
npm test
```

Open the repository in VS Code and press `F5` to launch the Extension Development Host for `git-branches-panel`.

### Create a `.vsix` package

To create the Marketplace upload file for the current extension, run from the repository root:

```bash
npm run package:git-branches-panel
```

This creates a versioned `.vsix` file inside `extensions/git-branches-panel/`.

## Contributing

Contributions are welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup, workflow, and quality checks.

## Support

For bug reports, feature requests, and usage questions, see [`SUPPORT.md`](SUPPORT.md).

## Adding a new extension

1. Create a new folder under `extensions/<extension-name>/`.
2. Add the extension's own `package.json`, `tsconfig.json`, `README.md`, `CHANGELOG.md`, `LICENSE`, `src/`, `resources/`, and `test/`.
3. Add root build, lint, test, and launch wiring for the new extension.
4. Keep publishable assets inside the extension folder so it can be packaged independently.

## License

This repository is licensed under the MIT License. See [`LICENSE`](LICENSE).
