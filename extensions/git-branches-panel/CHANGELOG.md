# Changelog

All notable changes to this project will be documented in this file.

## [1.3.0] - 2026-06-06

- Added scope-aware folder context menus for Local, Remote, and Tags groups
- Added bulk local-folder actions to sync or delete all descendant branches while automatically skipping the current branch during bulk deletes
- Added bulk remote-folder and tag-folder delete actions for descendant branches and tags
- Added a `...` toolbar button with advanced repository actions, including pruning local branches whose tracked upstream no longer exists
- Fixed folder identity collisions across sections by making folder tree items section-aware end-to-end
- Refreshed the marketplace icon with a cleaner high-resolution PNG for sharper rendering in the Extensions UI

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
