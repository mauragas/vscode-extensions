const assert = require('node:assert/strict');
const test = require('node:test');

const { buildBranchSections } = require('../out/branchModel.js');
const {
  buildBranchTooltipContent,
  buildTreeItemPresentation,
  findDescendantBranches,
  findContainerNode,
} = require('../out/treePresentation.js');

test('buildBranchTooltipContent describes local, remote, stash, hook, tag, and worktree items', () => {
  const localTooltip = buildBranchTooltipContent({
    kind: 'branch',
    fullName: 'feature/demo',
    label: 'demo',
    path: 'feature/demo',
    info: {
      name: 'feature/demo',
      isCurrent: true,
      lastCommitDate: '2 hours ago',
      lastCommit: 'Ship it',
      upstreamName: 'origin/feature/demo',
      aheadCount: 1,
      behindCount: 2,
    },
  });
  const publishableTooltip = buildBranchTooltipContent({
    kind: 'branch',
    fullName: 'feature/offline',
    label: 'offline',
    path: 'feature/offline',
    info: {
      name: 'feature/offline',
      isCurrent: false,
      lastCommitDate: 'just now',
    },
  });
  const remoteTooltip = buildBranchTooltipContent({
    kind: 'branch',
    fullName: 'origin/feature/demo',
    label: 'demo',
    path: 'origin/feature/demo',
    info: {
      name: 'origin/feature/demo',
      isCurrent: false,
      scope: 'remote',
      remoteName: 'origin',
      lastCommitDate: 'yesterday',
    },
  });
  const staleRemoteTooltip = buildBranchTooltipContent({
    kind: 'branch',
    fullName: 'ghost/feature/demo',
    label: 'demo',
    path: 'ghost/feature/demo',
    info: {
      name: 'ghost/feature/demo',
      isCurrent: false,
      scope: 'remote',
      remoteName: 'ghost',
      remoteTrackingState: 'stale',
      lastCommitDate: 'last week',
    },
  });
  const tagTooltip = buildBranchTooltipContent({
    kind: 'branch',
    fullName: 'v1.0.0',
    label: 'v1.0.0',
    path: 'v1.0.0',
    info: {
      name: 'v1.0.0',
      isCurrent: false,
      scope: 'tag',
    },
  });
  const stashTooltip = buildBranchTooltipContent({
    kind: 'branch',
    fullName: 'stash@{0}',
    label: 'stash@{0}',
    path: 'stash@{0}',
    info: {
      name: 'stash@{0}',
      isCurrent: false,
      scope: 'stash',
      lastCommitDate: '5 minutes ago',
      lastCommit: 'WIP on main: stash support',
    },
  });
  const hookTooltip = buildBranchTooltipContent({
    kind: 'branch',
    fullName: 'pre-commit · shared',
    label: 'pre-commit · shared',
    path: 'pre-commit · shared',
    info: {
      name: 'pre-commit · shared',
      isCurrent: false,
      scope: 'hook',
      hookName: 'pre-commit',
      hookSource: 'shared',
      hookEnabled: true,
      hookActive: true,
      hookRelativePath: '.githooks/pre-commit',
    },
  });
  const worktreeTooltip = buildBranchTooltipContent({
    kind: 'branch',
    fullName: '/tmp/git-branches-panel-feature-worktree',
    label: 'git-branches-panel-feature-worktree',
    path: '/tmp/git-branches-panel-feature-worktree',
    info: {
      name: '/tmp/git-branches-panel-feature-worktree',
      isCurrent: false,
      scope: 'worktree',
      worktreePath: '/tmp/git-branches-panel-feature-worktree',
      worktreeRef: 'feature/worktree',
      worktreeLockedReason: 'in use elsewhere',
    },
  });

  assert.match(localTooltip, /\*\*feature\/demo\*\*/);
  assert.match(localTooltip, /_Current branch_/);
  assert.match(localTooltip, /Last commit: 2 hours ago/);
  assert.match(localTooltip, /Upstream: origin\/feature\/demo/);
  assert.match(localTooltip, /Sync state: 2↓ 1↑/);
  assert.match(localTooltip, /> Ship it/);
  assert.match(publishableTooltip, /Publish target: origin\/feature\/offline/);
  assert.match(publishableTooltip, /_Not published yet_/);

  assert.match(remoteTooltip, /_Remote branch_/);
  assert.match(remoteTooltip, /Remote: origin/);
  assert.match(staleRemoteTooltip, /_Stale remote-tracking ref_/);
  assert.match(staleRemoteTooltip, /Remote: ghost/);
  assert.match(staleRemoteTooltip, /_Remote is no longer configured locally_/);
  assert.match(tagTooltip, /_Tag_/);
  assert.match(stashTooltip, /_Stash_/);
  assert.match(stashTooltip, /Saved: 5 minutes ago/);
  assert.match(stashTooltip, /Message: WIP on main: stash support/);
  assert.match(hookTooltip, /_Git hook_/);
  assert.match(hookTooltip, /Source: Shared/);
  assert.match(hookTooltip, /Status: Active/);
  assert.match(hookTooltip, /Path: \.githooks\/pre-commit/);
  assert.match(worktreeTooltip, /_Worktree_/);
  assert.match(worktreeTooltip, /Reference: feature\/worktree/);
  assert.match(worktreeTooltip, /Locked: in use elsewhere/);
});

test('buildTreeItemPresentation maps sections, folders, and branch types consistently', () => {
  const localSectionPresentation = buildTreeItemPresentation({
    kind: 'section',
    label: 'Local',
    path: 'section:local',
    scope: 'local',
    children: [],
  });
  const sectionPresentation = buildTreeItemPresentation({
    kind: 'section',
    label: 'Remote',
    path: 'section:remote',
    scope: 'remote',
    children: [],
  });
  const stashSectionPresentation = buildTreeItemPresentation({
    kind: 'section',
    label: 'Stash',
    path: 'section:stash',
    scope: 'stash',
    children: [],
  });
  const worktreeSectionPresentation = buildTreeItemPresentation({
    kind: 'section',
    label: 'Worktree',
    path: 'section:worktree',
    scope: 'worktree',
    children: [],
  });
  const hooksSectionPresentation = buildTreeItemPresentation({
    kind: 'section',
    label: 'Hooks',
    path: 'section:hooks',
    scope: 'hook',
    children: [],
  });
  const tagsSectionPresentation = buildTreeItemPresentation({
    kind: 'section',
    label: 'Tags',
    path: 'section:tags',
    scope: 'tag',
    children: [],
  });
  const remotesSectionPresentation = buildTreeItemPresentation({
    kind: 'section',
    label: 'Remotes',
    path: 'section:remotes',
    scope: 'remoteConfig',
    children: [],
  });
  const folderPresentation = buildTreeItemPresentation({
    kind: 'folder',
    label: 'feature',
    path: 'feature',
    scope: 'local',
    children: [],
  });
  const localBranchPresentation = buildTreeItemPresentation({
    kind: 'branch',
    fullName: 'feature/demo',
    label: 'demo',
    path: 'feature/demo',
    info: {
      name: 'feature/demo',
      isCurrent: false,
      lastCommitDate: '1 hour ago',
      upstreamName: 'origin/feature/demo',
      aheadCount: 1,
    },
  });
  const publishableBranchPresentation = buildTreeItemPresentation({
    kind: 'branch',
    fullName: 'feature/offline',
    label: 'offline',
    path: 'feature/offline',
    info: {
      name: 'feature/offline',
      isCurrent: false,
      lastCommitDate: 'just now',
    },
  });
  const currentBranchWithSyncPresentation = buildTreeItemPresentation({
    kind: 'branch',
    fullName: 'main',
    label: 'main',
    path: 'main',
    info: {
      name: 'main',
      isCurrent: true,
      lastCommitDate: '2 hours ago',
      upstreamName: 'origin/main',
      aheadCount: 1,
      behindCount: 2,
    },
  });
  const currentBranchPresentation = buildTreeItemPresentation({
    kind: 'branch',
    fullName: 'main',
    label: 'main',
    path: 'main',
    info: {
      name: 'main',
      isCurrent: true,
    },
  });
  const remoteBranchPresentation = buildTreeItemPresentation({
    kind: 'branch',
    fullName: 'origin/main',
    label: 'main',
    path: 'origin/main',
    info: {
      name: 'origin/main',
      isCurrent: false,
      scope: 'remote',
      remoteName: 'origin',
    },
  });
  const staleRemoteBranchPresentation = buildTreeItemPresentation({
    kind: 'branch',
    fullName: 'ghost/main',
    label: 'main',
    path: 'ghost/main',
    info: {
      name: 'ghost/main',
      isCurrent: false,
      scope: 'remote',
      remoteName: 'ghost',
      remoteTrackingState: 'stale',
      lastCommitDate: 'yesterday',
    },
  });
  const tagPresentation = buildTreeItemPresentation({
    kind: 'branch',
    fullName: 'v1.0.0',
    label: 'v1.0.0',
    path: 'v1.0.0',
    info: {
      name: 'v1.0.0',
      isCurrent: false,
      scope: 'tag',
    },
  });
  const stashPresentation = buildTreeItemPresentation({
    kind: 'branch',
    fullName: 'stash@{0}',
    label: 'stash@{0}',
    path: 'stash@{0}',
    info: {
      name: 'stash@{0}',
      isCurrent: false,
      scope: 'stash',
      lastCommit: 'WIP on main: stash support',
      lastCommitDate: '5 minutes ago',
    },
  });
  const hookPresentation = buildTreeItemPresentation({
    kind: 'branch',
    fullName: 'pre-commit · shared',
    label: 'pre-commit · shared',
    path: 'pre-commit · shared',
    info: {
      name: 'pre-commit · shared',
      isCurrent: false,
      scope: 'hook',
      hookName: 'pre-commit',
      hookSource: 'shared',
      hookEnabled: true,
      hookActive: true,
      hookRelativePath: '.githooks/pre-commit',
    },
  });
  const disabledHookPresentation = buildTreeItemPresentation({
    kind: 'branch',
    fullName: 'commit-msg · local',
    label: 'commit-msg · local',
    path: 'commit-msg · local',
    info: {
      name: 'commit-msg · local',
      isCurrent: false,
      scope: 'hook',
      hookName: 'commit-msg',
      hookSource: 'local',
      hookEnabled: false,
      hookActive: false,
      hookRelativePath: '.git/hooks/commit-msg.disabled',
    },
  });
  const worktreePresentation = buildTreeItemPresentation({
    kind: 'branch',
    fullName: '/tmp/git-branches-panel-feature-worktree',
    label: 'git-branches-panel-feature-worktree',
    path: '/tmp/git-branches-panel-feature-worktree',
    info: {
      name: '/tmp/git-branches-panel-feature-worktree',
      isCurrent: false,
      scope: 'worktree',
      worktreePath: '/tmp/git-branches-panel-feature-worktree',
      worktreeRef: 'feature/worktree',
    },
  });
  const currentWorktreePresentation = buildTreeItemPresentation({
    kind: 'branch',
    fullName: '/tmp/git-branches-panel-main-worktree',
    label: 'git-branches-panel-main-worktree',
    path: '/tmp/git-branches-panel-main-worktree',
    info: {
      name: '/tmp/git-branches-panel-main-worktree',
      isCurrent: true,
      scope: 'worktree',
      worktreePath: '/tmp/git-branches-panel-main-worktree',
      worktreeRef: 'main',
    },
  });
  const lockedWorktreePresentation = buildTreeItemPresentation({
    kind: 'branch',
    fullName: '/tmp/git-branches-panel-locked-worktree',
    label: 'git-branches-panel-locked-worktree',
    path: '/tmp/git-branches-panel-locked-worktree',
    info: {
      name: '/tmp/git-branches-panel-locked-worktree',
      isCurrent: false,
      scope: 'worktree',
      worktreePath: '/tmp/git-branches-panel-locked-worktree',
      worktreeRef: 'feature/locked',
      worktreeLockedReason: 'in use elsewhere',
    },
  });
  const detachedPrunableWorktreePresentation = buildTreeItemPresentation({
    kind: 'branch',
    fullName: '/tmp/git-branches-panel-prunable-worktree',
    label: 'git-branches-panel-prunable-worktree',
    path: '/tmp/git-branches-panel-prunable-worktree',
    info: {
      name: '/tmp/git-branches-panel-prunable-worktree',
      isCurrent: false,
      scope: 'worktree',
      worktreePath: '/tmp/git-branches-panel-prunable-worktree',
      worktreeRef: 'detached at abc1234',
      worktreePrunableReason: 'gitdir file points to non-existent location',
    },
  });
  const remoteConfigPresentation = buildTreeItemPresentation({
    kind: 'remote',
    fullName: 'origin',
    label: 'origin',
    path: 'origin',
    repoRoot: '/repo',
    info: {
      name: 'origin',
      fetchUrl: 'https://github.com/octo/repo.git',
      pushUrl: 'git@github.com:octo/repo.git',
      isDefault: true,
      hostProvider: 'GitHub',
    },
  });

  assert.equal(localSectionPresentation.nodeType, 'section');
  assert.equal(localSectionPresentation.collapsibleState, 'expanded');
  assert.equal(localSectionPresentation.containerKey, 'section:local');
  assert.equal(localSectionPresentation.contextValue, 'localSection');

  assert.equal(sectionPresentation.nodeType, 'section');
  assert.equal(sectionPresentation.icon.id, 'cloud');
  assert.equal(sectionPresentation.collapsibleState, 'collapsed');
  assert.equal(sectionPresentation.contextValue, 'remoteSection');
  assert.equal(sectionPresentation.containerKey, 'section:remote');

  assert.equal(stashSectionPresentation.nodeType, 'section');
  assert.equal(stashSectionPresentation.icon.id, 'archive');
  assert.equal(stashSectionPresentation.contextValue, 'stashSection');

  assert.equal(worktreeSectionPresentation.nodeType, 'section');
  assert.equal(worktreeSectionPresentation.icon.id, 'folder');
  assert.equal(worktreeSectionPresentation.contextValue, 'worktreeSection');

  assert.equal(hooksSectionPresentation.nodeType, 'section');
  assert.equal(hooksSectionPresentation.icon.id, 'tools');
  assert.equal(hooksSectionPresentation.contextValue, 'hooksSection');

  assert.equal(tagsSectionPresentation.nodeType, 'section');
  assert.equal(tagsSectionPresentation.contextValue, 'tagsSection');

  assert.equal(remotesSectionPresentation.nodeType, 'section');
  assert.equal(remotesSectionPresentation.icon.id, 'repo');
  assert.equal(remotesSectionPresentation.contextValue, 'remotesSection');

  assert.equal(folderPresentation.nodeType, 'folder');
  assert.equal(folderPresentation.id, 'folder:local:feature');
  assert.equal(folderPresentation.containerKey, 'folder:local:feature');
  assert.equal(folderPresentation.contextValue, 'local-folder');
  assert.equal(folderPresentation.icon.id, 'folder');
  assert.equal(folderPresentation.collapsibleState, 'collapsed');

  assert.equal(localBranchPresentation.nodeType, 'branch');
  assert.equal(localBranchPresentation.id, 'local:branch:feature/demo');
  assert.equal(localBranchPresentation.label, '1↑ demo');
  assert.equal(localBranchPresentation.contextValue, 'branch');
  assert.equal(localBranchPresentation.description, '1 hour ago');
  assert.equal(localBranchPresentation.command.command, 'gitBranchesPanel.activateBranchItem');

  assert.equal(publishableBranchPresentation.nodeType, 'branch');
  assert.equal(publishableBranchPresentation.contextValue, 'publishableBranch');

  assert.equal(currentBranchWithSyncPresentation.nodeType, 'currentBranch');
  assert.equal(currentBranchWithSyncPresentation.label, '● 2↓ 1↑ main');
  assert.equal(currentBranchWithSyncPresentation.contextValue, 'currentBranch');
  assert.equal(currentBranchWithSyncPresentation.description, '2 hours ago');

  assert.equal(currentBranchPresentation.nodeType, 'currentBranch');
  assert.equal(currentBranchPresentation.label, '● main');
  assert.equal(currentBranchPresentation.contextValue, 'publishableCurrentBranch');
  assert.equal(currentBranchPresentation.command, undefined);
  assert.equal(currentBranchPresentation.icon.colorId, 'gitDecoration.addedResourceForeground');

  assert.equal(remoteBranchPresentation.nodeType, 'remoteBranch');
  assert.equal(remoteBranchPresentation.icon.id, 'cloud');
  assert.equal(remoteBranchPresentation.command, undefined);

  assert.equal(staleRemoteBranchPresentation.nodeType, 'staleRemoteBranch');
  assert.equal(staleRemoteBranchPresentation.contextValue, 'staleRemoteBranch');
  assert.equal(staleRemoteBranchPresentation.icon.id, 'cloud');
  assert.equal(staleRemoteBranchPresentation.icon.colorId, 'list.warningForeground');
  assert.equal(staleRemoteBranchPresentation.description, 'stale remote • yesterday');
  assert.equal(staleRemoteBranchPresentation.command, undefined);

  assert.equal(tagPresentation.nodeType, 'tag');
  assert.equal(tagPresentation.icon.id, 'tag');
  assert.equal(tagPresentation.command, undefined);

  assert.equal(stashPresentation.nodeType, 'stash');
  assert.equal(stashPresentation.icon.id, 'archive');
  assert.equal(stashPresentation.description, 'WIP on main: stash support • 5 minutes ago');
  assert.equal(stashPresentation.command, undefined);

  assert.equal(hookPresentation.nodeType, 'hook');
  assert.equal(hookPresentation.contextValue, 'sharedHook');
  assert.equal(hookPresentation.icon.id, 'tools');
  assert.equal(hookPresentation.icon.colorId, 'gitDecoration.addedResourceForeground');
  assert.equal(hookPresentation.description, 'active • shared');
  assert.equal(hookPresentation.command.command, 'gitBranchesPanel.activateHookItem');

  assert.equal(disabledHookPresentation.nodeType, 'hook');
  assert.equal(disabledHookPresentation.contextValue, 'disabledLocalHook');
  assert.equal(disabledHookPresentation.icon.id, 'tools');
  assert.equal(disabledHookPresentation.icon.colorId, 'disabledForeground');
  assert.equal(disabledHookPresentation.description, 'disabled • local');

  assert.equal(worktreePresentation.nodeType, 'worktree');
  assert.equal(worktreePresentation.contextValue, 'worktree');
  assert.equal(worktreePresentation.icon.id, 'folder');
  assert.equal(worktreePresentation.description, 'feature/worktree');
  assert.equal(worktreePresentation.command, undefined);

  assert.equal(currentWorktreePresentation.nodeType, 'worktree');
  assert.equal(currentWorktreePresentation.label, '● git-branches-panel-main-worktree');
  assert.equal(currentWorktreePresentation.contextValue, 'currentWorktree');

  assert.equal(lockedWorktreePresentation.nodeType, 'worktree');
  assert.equal(lockedWorktreePresentation.contextValue, 'worktree:locked');
  assert.equal(lockedWorktreePresentation.icon.id, 'lock');
  assert.equal(lockedWorktreePresentation.icon.colorId, 'list.warningForeground');
  assert.equal(lockedWorktreePresentation.description, 'feature/locked • locked');

  assert.equal(detachedPrunableWorktreePresentation.nodeType, 'worktree');
  assert.equal(detachedPrunableWorktreePresentation.contextValue, 'worktree:detached:prunable');
  assert.equal(detachedPrunableWorktreePresentation.icon.id, 'folder');
  assert.equal(detachedPrunableWorktreePresentation.icon.colorId, 'list.warningForeground');
  assert.equal(detachedPrunableWorktreePresentation.description, 'detached at abc1234 • prunable');

  assert.equal(remoteConfigPresentation.nodeType, 'remoteConfig');
  assert.equal(remoteConfigPresentation.id, 'repo:/repo:remote:origin');
  assert.equal(remoteConfigPresentation.contextValue, 'remoteConfig');
  assert.equal(remoteConfigPresentation.icon.id, 'repo');
  assert.equal(remoteConfigPresentation.description, 'GitHub • github.com/octo/repo');
  assert.match(remoteConfigPresentation.tooltip, /Fetch: https:\/\/github.com\/octo\/repo.git/);
  assert.match(remoteConfigPresentation.tooltip, /Push: git@github.com:octo\/repo.git/);
  assert.match(remoteConfigPresentation.tooltip, /Provider: GitHub/);
  assert.match(remoteConfigPresentation.tooltip, /Default remote/);
});

test('buildTreeItemPresentation adjusts Hooks section context for bulk enable and disable actions', () => {
  const enableOnlyPresentation = buildTreeItemPresentation({
    kind: 'section',
    label: 'Hooks',
    path: 'section:hooks',
    scope: 'hook',
    children: [
      {
        kind: 'branch',
        fullName: 'pre-commit · local',
        label: 'pre-commit · local',
        path: 'pre-commit · local',
        info: {
          name: 'pre-commit · local',
          isCurrent: false,
          scope: 'hook',
          hookName: 'pre-commit',
          hookSource: 'local',
          hookEnabled: false,
        },
      },
    ],
  });
  const disableOnlyPresentation = buildTreeItemPresentation({
    kind: 'section',
    label: 'Hooks',
    path: 'section:hooks',
    scope: 'hook',
    children: [
      {
        kind: 'branch',
        fullName: 'commit-msg · shared',
        label: 'commit-msg · shared',
        path: 'commit-msg · shared',
        info: {
          name: 'commit-msg · shared',
          isCurrent: false,
          scope: 'hook',
          hookName: 'commit-msg',
          hookSource: 'shared',
          hookEnabled: true,
        },
      },
    ],
  });
  const mixedPresentation = buildTreeItemPresentation({
    kind: 'section',
    label: 'Hooks',
    path: 'section:hooks',
    scope: 'hook',
    children: [
      {
        kind: 'branch',
        fullName: 'pre-commit · local',
        label: 'pre-commit · local',
        path: 'pre-commit · local',
        info: {
          name: 'pre-commit · local',
          isCurrent: false,
          scope: 'hook',
          hookName: 'pre-commit',
          hookSource: 'local',
          hookEnabled: false,
        },
      },
      {
        kind: 'branch',
        fullName: 'commit-msg · shared',
        label: 'commit-msg · shared',
        path: 'commit-msg · shared',
        info: {
          name: 'commit-msg · shared',
          isCurrent: false,
          scope: 'hook',
          hookName: 'commit-msg',
          hookSource: 'shared',
          hookEnabled: true,
        },
      },
    ],
  });

  assert.equal(enableOnlyPresentation.contextValue, 'hooksSection:hasDisabled');
  assert.equal(disableOnlyPresentation.contextValue, 'hooksSection:hasEnabled');
  assert.equal(mixedPresentation.contextValue, 'hooksSection:hasEnabled:hasDisabled');
});

test('buildTreeItemPresentation sets correct context value and icon for missing upstream branches', () => {
  const missingUpstreamBranchPresentation = buildTreeItemPresentation({
    kind: 'branch',
    fullName: 'feature/old-feature',
    label: 'old-feature',
    path: 'feature/old-feature',
    info: {
      name: 'feature/old-feature',
      isCurrent: false,
      lastCommitDate: '3 days ago',
      upstreamName: 'origin/feature/old-feature',
      upstreamMissing: true,
    },
  });
  const currentMissingUpstreamPresentation = buildTreeItemPresentation({
    kind: 'branch',
    fullName: 'main',
    label: 'main',
    path: 'main',
    info: {
      name: 'main',
      isCurrent: true,
      lastCommitDate: '1 hour ago',
      upstreamName: 'origin/main',
      upstreamMissing: true,
    },
  });

  assert.equal(missingUpstreamBranchPresentation.nodeType, 'missingUpstreamBranch');
  assert.equal(missingUpstreamBranchPresentation.contextValue, 'missingUpstreamBranch');
  assert.equal(missingUpstreamBranchPresentation.icon.id, 'git-branch');
  assert.equal(missingUpstreamBranchPresentation.icon.colorId, 'list.warningForeground');
  assert.equal(missingUpstreamBranchPresentation.command.command, 'gitBranchesPanel.activateBranchItem');

  assert.equal(currentMissingUpstreamPresentation.nodeType, 'missingUpstreamBranch');
  assert.equal(currentMissingUpstreamPresentation.contextValue, 'publishableCurrentBranch');
  assert.equal(currentMissingUpstreamPresentation.icon.id, 'git-branch');
  assert.equal(currentMissingUpstreamPresentation.icon.colorId, 'list.warningForeground');
  assert.equal(currentMissingUpstreamPresentation.command, undefined);
});

test('buildTreeItemPresentation adds pinned prefixes and busy context values where appropriate', () => {
  const pinnedBusyBranchPresentation = buildTreeItemPresentation({
    kind: 'branch',
    fullName: 'feature/demo',
    label: 'demo',
    path: 'feature/demo',
    info: {
      name: 'feature/demo',
      isCurrent: false,
      isPinned: true,
      isSyncing: true,
      lastCommitDate: '1 hour ago',
      upstreamName: 'origin/feature/demo',
      aheadCount: 1,
    },
  });
  const pinnedCurrentWorktreePresentation = buildTreeItemPresentation({
    kind: 'branch',
    fullName: '/tmp/git-branches-panel-main-pinned-worktree',
    label: 'git-branches-panel-main-pinned-worktree',
    path: '/tmp/git-branches-panel-main-pinned-worktree',
    info: {
      name: '/tmp/git-branches-panel-main-pinned-worktree',
      isCurrent: true,
      isPinned: true,
      scope: 'worktree',
      worktreePath: '/tmp/git-branches-panel-main-pinned-worktree',
      worktreeRef: 'main',
    },
  });

  assert.equal(pinnedBusyBranchPresentation.label, '★ 1↑ demo');
  assert.equal(pinnedBusyBranchPresentation.contextValue, 'pinned:busyBranch');
  assert.equal(pinnedBusyBranchPresentation.icon.id, 'git-branch');
  assert.match(pinnedBusyBranchPresentation.tooltip, /_Pinned item_/);

  assert.equal(pinnedCurrentWorktreePresentation.label, '★ ● git-branches-panel-main-pinned-worktree');
  assert.equal(pinnedCurrentWorktreePresentation.contextValue, 'pinned:currentWorktree');
  assert.equal(pinnedCurrentWorktreePresentation.icon.id, 'folder');
});

test('buildTreeItemPresentation exposes protected context values so delete actions can be hidden in menus', () => {
  const protectedBranchPresentation = buildTreeItemPresentation({
    kind: 'branch',
    fullName: 'main',
    label: 'main',
    path: 'main',
    info: {
      name: 'main',
      isCurrent: false,
      isDeletionProtected: true,
      upstreamName: 'origin/main',
    },
  });
  const protectedPublishableBranchPresentation = buildTreeItemPresentation({
    kind: 'branch',
    fullName: 'develop',
    label: 'develop',
    path: 'develop',
    info: {
      name: 'develop',
      isCurrent: false,
      isDeletionProtected: true,
    },
  });
  const protectedMissingUpstreamPresentation = buildTreeItemPresentation({
    kind: 'branch',
    fullName: 'release/2026.06',
    label: '2026.06',
    path: 'release/2026.06',
    info: {
      name: 'release/2026.06',
      isCurrent: false,
      isDeletionProtected: true,
      upstreamName: 'origin/release/2026.06',
      upstreamMissing: true,
    },
  });
  const protectedRemotePresentation = buildTreeItemPresentation({
    kind: 'branch',
    fullName: 'origin/main',
    label: 'main',
    path: 'origin/main',
    info: {
      name: 'origin/main',
      isCurrent: false,
      isDeletionProtected: true,
      scope: 'remote',
      remoteName: 'origin',
    },
  });
  const protectedStaleRemotePresentation = buildTreeItemPresentation({
    kind: 'branch',
    fullName: 'ghost/main',
    label: 'main',
    path: 'ghost/main',
    info: {
      name: 'ghost/main',
      isCurrent: false,
      isDeletionProtected: true,
      scope: 'remote',
      remoteName: 'ghost',
      remoteTrackingState: 'stale',
    },
  });

  assert.equal(protectedBranchPresentation.contextValue, 'protectedBranch');
  assert.equal(protectedPublishableBranchPresentation.contextValue, 'protectedPublishableBranch');
  assert.equal(protectedMissingUpstreamPresentation.contextValue, 'protectedMissingUpstreamBranch');
  assert.equal(protectedRemotePresentation.contextValue, 'protectedRemoteBranch');
  assert.equal(protectedStaleRemotePresentation.contextValue, 'protectedStaleRemoteBranch');
});

test('findContainerNode resolves section and nested folder paths', () => {
  const sections = buildBranchSections(
    [{ name: 'main', isCurrent: true }],
    [{ name: 'origin/feature/demo', isCurrent: false, scope: 'remote', remoteName: 'origin' }],
    [{ name: 'stash@{0}', isCurrent: false, scope: 'stash' }],
    [{ name: '/tmp/git-branches-panel-main-worktree', isCurrent: true, scope: 'worktree' }],
    [],
    true
  );

  const remoteSection = findContainerNode(sections, 'section:remote');
  const nestedFolder = findContainerNode(sections, 'folder:remote:origin/feature');

  assert.ok(remoteSection);
  assert.equal(remoteSection.label, 'Remote');
  assert.ok(nestedFolder);
  assert.equal(nestedFolder.label, 'feature');
  assert.equal(findContainerNode(sections, 'folder:local:missing/path'), undefined);
});

test('findDescendantBranches uses unique folder keys so matching paths in different sections stay separate', () => {
  const sections = buildBranchSections(
    [{ name: 'release/1.0', isCurrent: false }],
    [],
    [],
    [],
    [{ name: 'release/v1.0.0', isCurrent: false, scope: 'tag' }],
    true
  );

  const localReleaseBranches = findDescendantBranches(sections, 'folder:local:release');
  const tagReleaseBranches = findDescendantBranches(sections, 'folder:tag:release');

  assert.deepEqual(localReleaseBranches.map((branch) => branch.fullName), ['release/1.0']);
  assert.deepEqual(tagReleaseBranches.map((branch) => branch.fullName), ['release/v1.0.0']);
});
