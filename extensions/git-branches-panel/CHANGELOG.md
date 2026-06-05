# Changelog

All notable changes to this project will be documented in this file.

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
