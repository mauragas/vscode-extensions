# Changelog

All notable changes to this project will be documented in this file.

## [1.7.0] - 2026-06-08

- Added a **Hooks** section that appears only when the current repository has configured local `.git/hooks` scripts or shared hooks via `core.hooksPath`
- Added hook state indicators plus **Enable Hook**, **Disable Hook**, and **Edit Hook** actions so configured hooks can be managed directly from the tree
- Added **Enable All Hooks** and **Disable All Hooks** inline actions on the **Hooks** section header for one-click bulk hook toggling
- Made the Hooks section bulk actions conditional, so **Enable All Hooks** only appears when something is disabled and **Disable All Hooks** only appears when something is enabled, and double-clicking a hook now opens **Edit Hook**
- Added hook detection and coverage for local-vs-shared hook discovery, section visibility, hover/context-menu contributions, and hook command behavior
- Added **Rename Worktree...** to linked worktree context menus so you can rename a specific worktree in place without removing and recreating it
- Added a `renameWorktree` Git helper backed by `git worktree move`, plus command/test coverage for successful linked-worktree moves
- Kept the rename action unavailable for the current worktree, matching Git's own limitations around moving the actively open worktree

## [1.6.0] - 2026-06-08

- Added `gitBranchesPanel.branchContextMenu.primaryActions` so branch right-click actions can be reordered or hidden from settings, while **More Branch Actions...** still remains the full fallback picker
- Renamed **Stash Silently** to **Stash all changes silently** while keeping the existing `gitBranchesPanel.stashSilently` command id for backward compatibility
- Moved the default stash shortcut out of the Branches view toolbar and into the built-in **Changes** view title bar through the stable `scm/title` menu contribution point
- Added three optional stash commands/buttons, disabled by default: **Stash staged changes silently**, **Stash all changes**, and **Stash staged changes**
- Added optional-message prompts for the non-silent stash commands and SCM-aware repository resolution so stash buttons target the correct Git repository in multi-repository workspaces
- Added inline hover actions for the **Local**, **Remote**, **Stash**, **Worktree**, and **Tags** section headers, including **Sync All Branches**, **Pull All Branch Changes**, **Apply Latest Stash**, and section-level tag/worktree creation shortcuts
- Added inline hover actions on individual worktree items for **Open Worktree** and **Open Worktree in New Window**
- Added inline hover actions on individual tag items for **Checkout Tag** and **Delete Tag**
- Added inline hover actions on individual stash items for **Pop Stash**, **Apply Stash**, and **Drop Stash**
- Added matching section context-menu entries where that improved discoverability for the new hover actions
- Changed `gitBranchesPanel.showCurrentBranchInfo` to default to `false`, so the current-branch banner starts hidden unless you opt back in
- Documented the stable-API limitation that prevents custom buttons from being placed directly inside the built-in Commit button row, so the implementation uses the Changes view title bar instead
- Removed the duplicate current-branch indicator from the VS Code status bar so the extension no longer repeats VS Code's built-in branch label
- Deprecated `gitBranchesPanel.showStatusBarBranchAction`; the setting now has no effect because the extension no longer contributes a status bar action

## [1.5.0] - 2026-06-07

- Local branches whose tracked upstream no longer exists are now shown with a warning color so they are visually distinct from healthy branches
- Added **Prune Local Branches with Missing Upstream** command to the Local section context menu
- Improved the branch tooltip to clearly separate "no upstream configured" from "tracked upstream was deleted" states
- Added inline buttons next to branch names for checkout, create new branch from selected and checkout, and delete
- Inline buttons adapt to branch type — sync/publish, checkout, create-new-branch, and delete appear where appropriate
- Added `missingUpstreamBranch` context value for finer-grained inline button control on branches with deleted upstreams
- Added context menu actions to create a worktree directly from a local branch or a detached worktree from a tag without first checking out that ref
- Added a branch context menu action to cherry-pick the selected branch into the currently checked out branch
- Added a Stash section action to pop the latest stash in one click
- Added `gitBranchesPanel.protectedBranchNames` with default safeguards for `main`, `master`, and `develop`, and enforced it across single-branch and bulk delete flows
- Added `gitBranchesPanel.newBranchPrefixes` with default `feature`, `bugfix`, and `hotfix` entries to prefill new branch names from common folder prefixes
- Added inline pin/unpin buttons for branches, stashes, and worktrees, and keep pinned items sorted to the top of their section
- Added a spinning inline branch-action indicator while sync or publish operations are in progress
- Fixed inline checkout, create-branch, and delete buttons so publishable branches and missing-upstream branches get the same quick-action coverage as regular local branches

## [1.4.1] - 2026-06-06

- Classified remote-branch delete failures so local `pre-push` hook blocks, stale remote-tracking refs, remote-side rejections, and generic auth/network problems no longer collapse into one generic error path
- Added **Retry Without Hook…** for remote branch deletes blocked by a local `pre-push` hook, using `git push --no-verify` only after an explicit modal confirmation
- Marked remote-tracking refs whose remote is no longer configured as stale in the tree, disabled normal remote delete for them, and added **Remove Stale Tracking Ref** cleanup
- Prevented stale remote-tracking refs from being included in descendant remote-folder deletes, reporting them as skipped cleanup candidates instead
- Hardened remote ref parsing so symbolic refs such as `origin/HEAD` are never treated as deletable remote branches

## [1.4.0] - 2026-06-06

- Branch creation now quietly sanitizes entered names into valid Git branch names instead of warning on spaces or passing invalid names through to Git, while rejecting inputs that sanitize to nothing instead of silently creating a generic fallback branch
- Added `gitBranchesPanel.normalizeNewBranchNames` to optionally apply extra lowercase kebab-case normalization on top of the default sanitization, stripping special characters other than `-` while preserving `/` folder separators
- Applied normalization only to branch creation flows (`New Branch`, `New Branch from Selected`, and `New Branch from Selected and Checkout`), leaving rename and tag naming behavior unchanged
- Added cleanup for common invalid Git ref patterns such as spaces, duplicate separators, invalid punctuation, leading/trailing dashes, and `.lock` suffixes during branch creation

## [1.3.0] - 2026-06-06

- Added scope-aware folder context menus for Local, Remote, and Tags groups
- Added bulk local-folder actions to sync or delete all descendant branches while automatically skipping the current branch during bulk deletes
- Added bulk remote-folder and tag-folder delete actions for descendant branches and tags
- Added a `...` toolbar button with advanced repository actions, including pruning local branches whose tracked upstream no longer exists
- Fixed folder identity collisions across sections by making folder tree items section-aware end-to-end
- Refreshed the marketplace icon with a cleaner high-resolution PNG for sharper rendering in the Extensions UI
- Added settings to show or hide each toolbar quick action independently
- Added a setting to hide the status bar sync/publish action for the current branch
- Added separate publish actions for local branches that do not yet track a live upstream
- Added a local-folder action to push descendant branches while publishing unpublished ones
- Added a `Settings` toolbar quick action that opens this extension's settings directly
- Added a `More Branch Actions...` context action that opens an iconized Quick Pick for branch commands

## [1.2.0] - 2026-06-05

- Improved first-load performance by loading the Local section first instead of eagerly loading every section at startup
- Added lazy loading for Remote, Stash, Worktree, and Tags so section contents are loaded only when expanded
- Changed the default tree expansion state so Local starts expanded while other sections and folders start collapsed
- Reduced unnecessary refresh work by targeting only already loaded sections during auto-refresh events
- Removed the duplicate initial refresh path so the tree does less work during activation

## [1.1.0] - 2026-06-05

- Added a local-branch context menu action to create a tag on the selected branch
- Added `gitBranchesPanel.showCurrentBranchInfo` to hide or show the current-branch summary above the tree view
- Added a Tags section context menu action to push all local tags to a remote
- Split toolbar fetching into `Fetch All` and `Fetch All (Prune)` actions
- Added a Stash section between Remote and Tags
- Added stash context actions to apply, pop, and drop stashes
- Added a `Stash Silently` toolbar action for tracked and untracked files
- Added a Worktree section between Stash and Tags with common worktree actions
- Prioritized incoming/outgoing sync badges so they stay visible for long branch names
- Added a branch context action to compare any local or remote branch with the currently checked out branch

## [1.0.0] - 2026-06-05

- Added local, remote, and tags sections to the tree view
- Added folder-first ordering inside grouped tree sections
- Added automatic refresh after syncing a branch
- Added remote branch context actions for checkout, copy, and delete
- Added tag context actions for checkout, copy, and delete

## [0.0.1] - 2026-06-05

- Initial open-source repository setup for `Git Branches Panel`
- Tree view for local branches with folder grouping
- Sync badges for ahead/behind branch state
- Sync current or non-current branches with their upstream
- Merge a selected branch into the current branch
- Quick actions for fetch, refresh, branch creation, checkout, rename, copy, and delete
