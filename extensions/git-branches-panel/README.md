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
- 🏷️ **Tags section** — tags are shown in their own section below remote branches, with version-like tags newest-first by default
- 📁 **Folders first** — folders are listed before branch leaves inside each section
- ⚡ **Faster first paint** — the tree loads Local branches first so the view opens quickly in larger repositories
- 📦 **Lazy-loaded sections** — Remote, Stash, Worktree, and Tags are loaded only when you expand them
- 🧭 **Focused default expansion** — Local starts expanded while other sections and nested folders start collapsed
- ✅ **Current branch first** — highlighted with a `●` prefix and a green icon
- 🪄 **Optional current branch banner** — keep or hide the top `Current branch: ...` summary from settings, now off by default for a quieter tree
- 🧭 **Customizable branch right-click menu** — reorder or hide the primary branch actions from settings while **More Branch Actions...** always stays available as the full fallback picker
- 🎛️ **Configurable toolbar quick actions** — show or hide each extension-view toolbar button independently from settings
- 🧺 **Changes-view stash buttons** — surface stash shortcuts in the built-in **Changes** view title bar, with **Stash all changes silently** enabled there by default
- 🖱️ **Section hover quick actions** — hover Local, Remote, Stash, Worktree, and Tags groups to reveal section-specific inline buttons for high-frequency actions
- 🧹 **Quiet branch-name sanitization** — new branch names are cleaned up automatically to stay Git-valid, with optional lowercase kebab-case normalization that also strips extra special characters while preserving `-` and `/`
- 🕐 **Last commit time** — shown as a relative description and in the tooltip
- 🔄 **Sync state badges** — incoming and outgoing commits stay visible even when branch names are long
- ☁️ **Inline sync button** — every branch gets a small sync button, including branches that are not currently checked out
- 🌀 **Inline sync animation** — branch sync and publish actions swap to a spinning inline indicator while Git is working
- 🏷️ **Inline action buttons** — checkout, create new branch from selected and checkout, pin/unpin, and delete appear inline alongside sync/publish for quick access
- 🚀 **Non-current branch sync** — sync a branch with its upstream without checking it out first
- ☁️ **Publish actions** — publish local branches without an upstream, including the current branch and descendant folder actions
- 🧭 **Classified remote-branch delete recovery** — remote deletion failures now distinguish local hook blocks, stale tracking refs, and remote-side rejections instead of offering a generic retry
- 🧹 **Stale remote-tracking cleanup** — branches whose remote was removed are marked as stale, skip destructive remote-delete actions, and can be cleaned up locally in one click
- ⚠️ **Missing upstream detection** — local branches whose tracked upstream no longer exists are shown with a warning color and the publish action instead of sync
- 📌 **Pin starred items to the top** — pin local or remote branches, stashes, and worktrees so they stay easy to reach
- 🪵 **Create worktrees from refs** — create a linked worktree directly from a branch or a detached worktree from a tag without checking that ref out first
- 🍒 **Cherry-pick into current** — cherry-pick a selected branch into the checked out branch from the context menu
- 🛡️ **Protected branch safeguards** — block delete actions for configured branch names such as `main`, `master`, and `develop`
- 🧭 **Branch prefix picker** — optionally prefill new branch names from common folders like `feature/`, `bugfix/`, or `hotfix/`
- 🆚 **Compare with current branch** — compare a local or remote branch against the currently checked out branch from the context menu
- 📦 **Stash actions** — apply, pop, drop, or pop the latest stash from the Stash section context menu, plus stash all or staged changes from the Branches toolbar or built-in Changes view title bar
- 🏷️ **Tag hover quick actions** — checkout and delete a tag directly from the tag row hover buttons
- 📦 **Stash hover quick actions** — pop, apply, or drop a stash directly from the stash row hover buttons
- 🪟 **Worktree actions** — open, reveal, copy, or remove worktrees from the context menu, with open/open-in-new-window buttons now available directly on worktree item hover
- ⚡ **Double-click checkout** — double-click a branch to switch instantly
- 🔀 **Merge into current** — merge a selected branch into the current branch from the context menu
- 🧰 **Context menu actions** — checkout, sync, publish, create tags, rename, merge into current, cherry-pick, compare with current, copy branch name, delete/cleanup, and open a codicon-based branch actions picker, all with settings-driven branch-menu ordering and visibility
- 🧷 **Section context menu parity** — the new Local, Stash, Worktree, and Tags section hover actions are also available from those section context menus where that improves discoverability
- ➕ **Toolbar quick actions** — create a new branch, sync or publish the current branch, fetch all remotes, fetch all with prune, refresh, open advanced actions, and open extension settings from the panel title bar, with the stash shortcut moved out of the Branches toolbar by default
- 🔄 **Targeted auto-refresh** — updates loaded sections when `.git/HEAD`, `.git/FETCH_HEAD`, `.git/packed-refs`, `.git/refs/heads/`, `.git/refs/remotes/`, `.git/refs/tags/`, `.git/refs/stash`, `.git/logs/refs/stash`, `.git/worktrees/`, workspace folders, or settings change

## Commands

| Command | Description |
| --- | --- |
| Refresh | Refresh the loaded branch sections and remote sync state |
| Open Extension Settings | Open the extension's settings filtered in the Settings editor |
| Stash all changes silently | Stash all tracked and untracked files without prompting for a stash name |
| Stash staged changes silently | Stash only staged changes without prompting for a stash name |
| Stash all changes | Prompt for an optional stash name, then stash tracked and untracked files |
| Stash staged changes | Prompt for an optional stash name, then stash only staged changes |
| Sync All Branches | Sync every tracked local branch in the repository and report any branches that still need publishing |
| Pull All Branch Changes | Pull changes for every tracked local branch in the repository without pushing outgoing commits |
| Fetch All | Fetch all remotes and refresh the tree without pruning stale refs |
| Fetch All (Prune) | Fetch all remotes, prune deleted refs, and refresh the tree |
| Sync Current Branch | Sync the currently checked out branch with its upstream |
| Publish Current Branch | Publish the currently checked out branch to its remote |
| Checkout Branch | Switch to the selected local or remote branch |
| Checkout Tag | Check out the selected tag in detached HEAD state |
| Sync Branch | Pull and/or push the branch with its remote, even when it is not checked out |
| Publish Branch | Publish the selected local branch to its remote |
| More Branch Actions... | Open a Quick Pick with iconized branch actions |
| Create Worktree... | Create a linked worktree from a selected branch or a detached worktree from a selected tag |
| Rename Branch | Rename the selected branch |
| Create Tag | Create a local tag on the selected local branch |
| Cherry-pick into Current Branch | Cherry-pick the selected branch into the currently checked out branch |
| Compare with Current Branch | Open a multi-file comparison between the selected branch and the checked out branch |
| Remove Stale Tracking Ref | Delete a stale local `refs/remotes/<remote>/...` entry without contacting any remote |
| Apply Stash | Apply the selected stash without removing it |
| Apply Latest Stash | Apply the newest stash directly from the Stash section hover/context actions |
| Pop Stash | Apply the selected stash and remove it if successful |
| Pop Latest Stash | Pop the latest stash directly from the Stash section context menu |
| Drop Stash | Delete the selected stash |
| Drop All Stashes | Delete every stash entry from the Stash section |
| Open Worktree | Open the selected worktree in the current window |
| Create New Worktree... | Create a new worktree from the currently checked out branch directly from the Worktree section |
| Open Worktree in New Window | Open the selected worktree in a new window |
| Reveal Worktree in File Explorer | Reveal the selected worktree in the OS file browser |
| Copy Worktree Path | Copy the selected worktree path to the clipboard |
| Pin / Unpin Item | Toggle pinning for branches, stashes, and worktrees so pinned items stay at the top |
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

### Changes view stash placement

- The built-in **Changes** view stash buttons are contributed through the stable `scm/title` menu API.
- VS Code's stable API does **not** let extensions place custom buttons directly inside the built-in Commit button row, so the Changes view title bar is the closest supported placement.
- By default, only **Stash all changes silently** is enabled there; the staged and message-prompting variants stay off until you enable them in settings.

### Section hover actions

- **Local** — **New Branch**, **Sync All Branches**, **Pull All Branch Changes**
- **Remote** — **Fetch All**, **Fetch All (Prune)**
- **Stash** — **Pop Latest Stash**, **Apply Latest Stash**
- **Worktree** — **Create New Worktree...** (from the current branch)
- **Tags** — **Create Tag...** (on the current branch), **Push All Tags**

For the Tags and Worktree section shortcuts, the extension uses the currently checked out branch as the source ref when you trigger the action from the section itself.

### Worktree item hover actions

- Hover a specific worktree item to reveal **Open Worktree** and **Open Worktree in New Window** inline buttons.

### Tag and stash item hover actions

- Hover a specific **tag** item to reveal **Checkout Tag** and **Delete Tag**.
- Hover a specific **stash** item to reveal **Pop Stash**, **Apply Stash**, and **Drop Stash**.

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
| `gitBranchesPanel.newBranchPrefixes` | `["feature", "bugfix", "hotfix"]` | Optional prefixes to offer before the new-branch input opens; use an empty array to disable the picker |
| `gitBranchesPanel.protectedBranchNames` | `["main", "master", "develop"]` | Branch names to protect from delete actions; remote branches also honor the short branch name, so `main` protects `origin/main` |
| `gitBranchesPanel.branchContextMenu.primaryActions` | `["syncOrPublish", "checkout", "newBranchFromSelected", "newBranchFromSelectedAndCheckout", "createWorktree", "renameBranch", "createTag", "copyBranchName", "compareWithCurrent", "mergeIntoCurrent", "cherryPickIntoCurrent", "deleteOrCleanup"]` | Ordered list of primary branch right-click actions; remove ids to hide them, while **More Branch Actions...** remains the full fallback picker |
| `gitBranchesPanel.sortOrder` | `alphabetical` | `alphabetical` or `recent` |
| `gitBranchesPanel.tagSortOrder` | `versionDescending` | `versionDescending`, `versionAscending`, `alphabetical`, or `recent`; version-aware sorting recognizes semver-like suffixes such as `v1.2.3` or `release/v1.2.3` and keeps non-version tags after version tags |
| `gitBranchesPanel.showCurrentBranchInfo` | `false` | Show the current branch summary above the tree views |
| `gitBranchesPanel.showStatusBarBranchAction` | `true` | Deprecated. This setting no longer has any effect because the extension no longer contributes a status bar branch action |
| `gitBranchesPanel.toolbar.showNewBranch` | `true` | Show the **New Branch** toolbar quick action |
| `gitBranchesPanel.toolbar.showStashSilently` | `false` | Show the **Stash all changes silently** quick action in the extension Branches view toolbar |
| `gitBranchesPanel.changesView.showStashAllChangesSilently` | `true` | Show **Stash all changes silently** in the built-in Changes view title bar |
| `gitBranchesPanel.changesView.showStashStagedChangesSilently` | `false` | Show **Stash staged changes silently** in the built-in Changes view title bar |
| `gitBranchesPanel.changesView.showStashAllChanges` | `false` | Show **Stash all changes** in the built-in Changes view title bar |
| `gitBranchesPanel.changesView.showStashStagedChanges` | `false` | Show **Stash staged changes** in the built-in Changes view title bar |
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
- Keep `gitBranchesPanel.newBranchPrefixes` set to `feature`, `bugfix`, and `hotfix` for a lightweight branch-folder picker, or clear it entirely if you prefer typing everything yourself
- Extend `gitBranchesPanel.protectedBranchNames` with long-lived release or environment branches to add an extra UI safety net before delete commands run
- Leave `gitBranchesPanel.showCurrentBranchInfo` disabled if you prefer a leaner tree, or turn it back on if you want the current branch banner above the sections again
- Trim `gitBranchesPanel.branchContextMenu.primaryActions` down to a smaller ordered list if you want a shorter right-click menu, knowing **More Branch Actions...** still keeps every supported branch action one click away
- Keep `gitBranchesPanel.tagSortOrder` on `versionDescending` for release-style tags, or switch to `recent` or `alphabetical` if your repository uses non-version tag names more heavily
- Leave `gitBranchesPanel.toolbar.showStashSilently` off and use the built-in Changes view button by default, or turn the Branches-view stash button back on if you prefer the old placement
- Enable any of the additional `gitBranchesPanel.changesView.showStash*` settings if you want staged-only stash buttons or stash commands that prompt for an optional message
- Hide any toolbar quick action you never use to keep the title bar compact
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
