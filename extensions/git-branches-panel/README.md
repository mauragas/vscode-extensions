# Git Branches Panel

`Git Branches Panel` is a Visual Studio Code extension that shows local and
remote Git branches, stashes, worktrees, and tags in a dedicated tree view with folder grouping,
sync status, current-branch context, and quick actions.

This extension lives in the [`vscode-extensions`](../..) repository under `extensions/git-branches-panel/`.

## Overview

The panel keeps the active branch visible at the top, groups slash-separated
branch names into folders, and separates Local, Remote, Stash, Worktree, and Tags into their own
sections so common Git navigation feels fast and tidy. The Local section opens first, while
Remote, Stash, Worktree, and Tags stay collapsed until you expand them.

![Git Branches Panel overview showing the current branch summary plus Local, Remote, and Tags sections.](https://raw.githubusercontent.com/mauragas/vscode-extensions/main/extensions/git-branches-panel/resources/git-branches-panel-overview.png)

## Features

- 🌿 **Folder grouping** — branches like `feature/auth` or `feature/payments/stripe` are nested into folders automatically
- 🧭 **Local and remote sections** — local branches are shown first, with remote branches listed in a separate group below them
- 🧺 **Stash section** — stashes are shown between remote branches and tags so parked work stays close at hand
- 🪵 **Worktree section** — worktrees are shown under stashes so additional checkouts are easy to find and manage
- 🏷️ **Tags section** — tags are shown in their own section below remote branches
- 📁 **Folders first** — folders are listed before branch leaves inside each section
- ⚡ **Faster first paint** — the tree loads Local branches first so the view opens quickly in larger repositories
- 📦 **Lazy-loaded sections** — Remote, Stash, Worktree, and Tags are loaded only when you expand them
- 🧭 **Focused default expansion** — Local starts expanded while other sections and nested folders start collapsed
- ✅ **Current branch first** — highlighted with a `●` prefix and a green icon
- 🪄 **Optional current branch banner** — keep or hide the top `Current branch: ...` summary from settings
- 🎛️ **Configurable toolbar quick actions** — show or hide each toolbar button independently from settings
- 📍 **Optional status bar branch action** — keep or hide the status bar sync/publish action for the current branch
- 🧹 **Quiet branch-name sanitization** — new branch names are cleaned up automatically to stay Git-valid, with optional lowercase kebab-case normalization that also strips extra special characters while preserving `-` and `/`
- 🕐 **Last commit time** — shown as a relative description and in the tooltip
- 🔄 **Sync state badges** — incoming and outgoing commits stay visible even when branch names are long
- ☁️ **Inline sync button** — every branch gets a small sync button, including branches that are not currently checked out
- 🚀 **Non-current branch sync** — sync a branch with its upstream without checking it out first
- ☁️ **Publish actions** — publish local branches without an upstream, including the current branch and descendant folder actions
- 🧭 **Classified remote-branch delete recovery** — remote deletion failures now distinguish local hook blocks, stale tracking refs, and remote-side rejections instead of offering a generic retry
- 🧹 **Stale remote-tracking cleanup** — branches whose remote was removed are marked as stale, skip destructive remote-delete actions, and can be cleaned up locally in one click
- ⚠️ **Missing upstream detection** — local branches whose tracked upstream no longer exists are shown with a warning color and the publish action instead of sync
- 🆚 **Compare with current branch** — compare a local or remote branch against the currently checked out branch from the context menu
- 📦 **Stash actions** — apply, pop, or drop a stash from the context menu
- 🪟 **Worktree actions** — open, reveal, copy, or remove worktrees from the context menu
- ⚡ **Double-click checkout** — double-click a branch to switch instantly
- 🔀 **Merge into current** — merge a selected branch into the current branch from the context menu
- 🧰 **Context menu actions** — checkout, sync, publish, create tags, rename, merge into current, push all tags from the Tags section, copy branch name, open a codicon-based branch actions picker, and delete with merge-safety handling
- ➕ **Toolbar quick actions** — create a new branch, stash tracked and untracked changes silently, sync or publish the current branch, fetch all remotes, fetch all with prune, refresh, open advanced actions, and open extension settings from the panel title bar
- 🔄 **Targeted auto-refresh** — updates loaded sections when `.git/HEAD`, `.git/FETCH_HEAD`, `.git/packed-refs`, `.git/refs/heads/`, `.git/refs/remotes/`, `.git/refs/tags/`, `.git/refs/stash`, `.git/logs/refs/stash`, `.git/worktrees/`, workspace folders, or settings change

## Commands

| Command | Description |
| --- | --- |
| Refresh | Refresh the loaded branch sections and remote sync state |
| Open Extension Settings | Open the extension's settings filtered in the Settings editor |
| Stash Silently | Stash all tracked and untracked files without prompting for a stash name |
| Fetch All | Fetch all remotes and refresh the tree without pruning stale refs |
| Fetch All (Prune) | Fetch all remotes, prune deleted refs, and refresh the tree |
| Sync Current Branch | Sync the currently checked out branch with its upstream |
| Publish Current Branch | Publish the currently checked out branch to its remote |
| Checkout Branch | Switch to the selected local or remote branch |
| Checkout Tag | Check out the selected tag in detached HEAD state |
| Sync Branch | Pull and/or push the branch with its remote, even when it is not checked out |
| Publish Branch | Publish the selected local branch to its remote |
| More Branch Actions... | Open a Quick Pick with iconized branch actions |
| Rename Branch | Rename the selected branch |
| Create Tag | Create a local tag on the selected local branch |
| Compare with Current Branch | Open a multi-file comparison between the selected branch and the checked out branch |
| Remove Stale Tracking Ref | Delete a stale local `refs/remotes/<remote>/...` entry without contacting any remote |
| Apply Stash | Apply the selected stash without removing it |
| Pop Stash | Apply the selected stash and remove it if successful |
| Drop Stash | Delete the selected stash |
| Drop All Stashes | Delete every stash entry from the Stash section |
| Open Worktree | Open the selected worktree in the current window |
| Open Worktree in New Window | Open the selected worktree in a new window |
| Reveal Worktree in File Explorer | Reveal the selected worktree in the OS file browser |
| Copy Worktree Path | Copy the selected worktree path to the clipboard |
| Remove Worktree | Remove the selected linked worktree |
| Push All Tags | Push all local tags to a selected remote from the Tags section context menu |
| Push Descendant Branches | Push tracked descendant branches and publish unpublished ones from a local folder |
| Sync Descendant Tracked Branches | Sync only descendant branches that already track a live upstream |
| Prune Local Branches with Missing Upstream | Delete local non-current branches whose tracked upstream no longer exists |
| Clean Repository | Remove untracked and ignored files via `git clean -fdx` after confirmation |
| Merge into Current Branch | Merge the selected branch into the current branch |
| Copy Branch Name | Copy the branch name to the clipboard |
| Copy Tag Name | Copy the selected tag name to the clipboard |
| Delete Branch | Delete the selected branch with merge safety checks and context-aware remote-delete recovery |
| Delete Tag | Delete the selected local tag |

### Remote delete behavior

- Live remote branches still use `git push <remote> --delete <branch>`.
- If a local `pre-push` hook blocks deletion, the extension offers **Retry Without Hook…** and only asks for a modal confirmation before bypassing local hooks with `--no-verify`.
- If a remote-tracking branch belongs to a remote that no longer exists locally, it is shown as a **stale remote-tracking ref** and the extension offers **Remove Stale Tracking Ref** instead of pretending a remote delete can work.
- If the remote/server rejects deletion, the extension shows details and Git output actions without offering a misleading force-delete path.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `gitBranchesPanel.groupByFolder` | `true` | Group branches by `/`-separated prefix |
| `gitBranchesPanel.normalizeNewBranchNames` | `false` | Apply extra lowercase kebab-case normalization after branch creation first sanitizes the entered text into a valid Git branch name, stripping special characters other than `-` while preserving `/` folder separators |
| `gitBranchesPanel.sortOrder` | `alphabetical` | `alphabetical` or `recent` |
| `gitBranchesPanel.showCurrentBranchInfo` | `true` | Show the current branch summary above the tree views |
| `gitBranchesPanel.showStatusBarBranchAction` | `true` | Show the status bar action that syncs or publishes the current branch |
| `gitBranchesPanel.toolbar.showNewBranch` | `true` | Show the **New Branch** toolbar quick action |
| `gitBranchesPanel.toolbar.showStashSilently` | `true` | Show the **Stash Silently** toolbar quick action |
| `gitBranchesPanel.toolbar.showCurrentBranchAction` | `true` | Show the **Sync Current Branch** or **Publish Current Branch** toolbar quick action |
| `gitBranchesPanel.toolbar.showFetchAll` | `true` | Show the **Fetch All** toolbar quick action |
| `gitBranchesPanel.toolbar.showFetchAllPrune` | `true` | Show the **Fetch All (Prune)** toolbar quick action |
| `gitBranchesPanel.toolbar.showRefresh` | `true` | Show the **Refresh** toolbar quick action |
| `gitBranchesPanel.toolbar.showAdvancedActions` | `true` | Show the **More Actions** toolbar quick action |
| `gitBranchesPanel.toolbar.showSettings` | `true` | Show the **Open Extension Settings** toolbar quick action |

### Useful configuration ideas already supported

- New branch creation always performs minimal cleanup to keep names Git-valid, for example `feature/hello world??` becomes `feature/hello-world`
- If the entered text sanitizes down to nothing useful, the prompt asks for a better name instead of silently creating a generic fallback branch
- Turn on `gitBranchesPanel.normalizeNewBranchNames` if you also want extra cleanup like lowercasing, special-character stripping, and duplicate-dash collapsing, so ` - Feature / Hello--- World!_@ - ` becomes `feature/hello-world`
- Hide any toolbar quick action you never use to keep the title bar compact
- Hide the status bar branch action if you prefer less workbench chrome
- Keep the current branch banner visible in the tree while hiding the status bar action, or vice versa
- Combine `sortOrder = recent` with folder grouping for large feature-branch heavy repositories

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
