# Git Branches Panel

`Git Branches Panel` is a Visual Studio Code extension that shows local Git branches in a dedicated tree view with folder grouping, sync status, and quick branch actions.

This extension lives in the [`vscode-extensions`](../..) repository under `extensions/git-branches-panel/`.

## Features

- 🌿 **Folder grouping** — branches like `feature/auth` or `feature/payments/stripe` are nested into folders automatically
- ✅ **Current branch first** — highlighted with a `●` prefix and a green icon
- 🕐 **Last commit time** — shown as a relative description and in the tooltip
- 🔄 **Sync state badges** — incoming and outgoing commits are shown as `↓` and `↑` counts in the branch description
- ☁️ **Inline sync button** — every branch gets a small sync button, including branches that are not currently checked out
- 🚀 **Non-current branch sync** — sync a branch with its upstream without checking it out first
- ⚡ **Double-click checkout** — double-click a branch to switch instantly
- 🔀 **Merge into current** — merge a selected branch into the current branch from the context menu
- 🧰 **Context menu actions** — checkout, sync, rename, merge into current, copy branch name, and delete with merge-safety handling
- ➕ **Toolbar quick actions** — create a new branch, sync the current branch, fetch all remotes, and refresh from the panel title bar
- 🔄 **Auto-refresh** — updates when `.git/HEAD`, `.git/FETCH_HEAD`, `.git/refs/heads/`, `.git/refs/remotes/`, workspace folders, or settings change

## Commands

| Command | Description |
| --- | --- |
| Refresh | Refresh the branch tree and remote sync state |
| Fetch All | Fetch and prune all remotes, then refresh the tree |
| Sync Current Branch | Sync the currently checked out branch with its upstream |
| Checkout Branch | Switch to the selected branch |
| Sync Branch | Pull and/or push the branch with its remote, even when it is not checked out |
| Rename Branch | Rename the selected branch |
| Merge into Current Branch | Merge the selected branch into the current branch |
| Copy Branch Name | Copy the branch name to the clipboard |
| Delete Branch | Delete the selected branch with merge safety checks |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `gitBranchesPanel.groupByFolder` | `true` | Group branches by `/`-separated prefix |
| `gitBranchesPanel.sortOrder` | `alphabetical` | `alphabetical` or `recent` |

## Development

### Requirements

- Node.js 18+ for local development
- Node.js 20+ recommended for packaging and future marketplace publishing
- Visual Studio Code 1.85+

### Run locally

From the repository root:

```bash
npm install
npm run test:git-branches-panel
code .
```

Then press `F5` in VS Code to launch the Extension Development Host using the shared workspace launch configuration.

You can also run `npm run compile`, `npm run lint`, or `npm run test` from this folder; those scripts delegate to the repository root tooling.

### Create a `.vsix` file

Quickest option from the repository root:

```bash
npm run package:git-branches-panel
```

Or from this extension folder directly:

```bash
npm run package
```

The generated file is written to this folder as `git-branches-panel-<version>.vsix` and can then be uploaded to the Visual Studio Marketplace.

## Publishing preparation

This repository is ready for open-source development and close to marketplace publishing. Before the first public release, the remaining publishing steps are:

1. Create or configure the `karolis-mauragas` VS Code Marketplace publisher
2. Add a dedicated marketplace icon (PNG recommended)
3. Run a package/publish flow from Node.js 20+
4. Publish the extension to the Visual Studio Code Marketplace

## License

This project is licensed under the MIT License. See [`LICENSE`](LICENSE).
