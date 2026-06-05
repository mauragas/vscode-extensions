# Git Branches Panel

`Git Branches Panel` is a Visual Studio Code extension that shows local and
remote Git branches plus tags in a dedicated tree view with folder grouping,
sync status, current-branch context, and quick actions.

This extension lives in the [`vscode-extensions`](../..) repository under `extensions/git-branches-panel/`.

## Overview

The panel keeps the active branch visible at the top, groups slash-separated
branch names into folders, and separates Local, Remote, and Tags into their own
sections so common Git navigation feels fast and tidy.

![Git Branches Panel overview showing the current branch summary plus Local, Remote, and Tags sections.](https://raw.githubusercontent.com/mauragas/vscode-extensions/main/extensions/git-branches-panel/resources/git-branches-panel-overview.png)

## Features

- 🌿 **Folder grouping** — branches like `feature/auth` or `feature/payments/stripe` are nested into folders automatically
- 🧭 **Local and remote sections** — local branches are shown first, with remote branches listed in a separate group below them
- 🏷️ **Tags section** — tags are shown in their own section below remote branches
- 📁 **Folders first** — folders are listed before branch leaves inside each section
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
| Checkout Branch | Switch to the selected local or remote branch |
| Checkout Tag | Check out the selected tag in detached HEAD state |
| Sync Branch | Pull and/or push the branch with its remote, even when it is not checked out |
| Rename Branch | Rename the selected branch |
| Merge into Current Branch | Merge the selected branch into the current branch |
| Copy Branch Name | Copy the branch name to the clipboard |
| Copy Tag Name | Copy the selected tag name to the clipboard |
| Delete Branch | Delete the selected branch with merge safety checks |
| Delete Tag | Delete the selected local tag |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `gitBranchesPanel.groupByFolder` | `true` | Group branches by `/`-separated prefix |
| `gitBranchesPanel.sortOrder` | `alphabetical` | `alphabetical` or `recent` |

## Development

### Requirements

- Node.js 18+ for local development
- Node.js 20+ recommended for creating `.vsix` packages
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

## Contributing

Contributions are welcome. See the repository-level [`CONTRIBUTING.md`](../../CONTRIBUTING.md) for development workflow and quality checks.

## Support

For bug reports, feature requests, and usage questions, see [`SUPPORT.md`](../../SUPPORT.md).

## License

This project is licensed under the MIT License. See [`LICENSE`](LICENSE).
