const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const packageJson = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf8')
);

function getCommand(commandId) {
  return packageJson.contributes.commands.find((command) => command.command === commandId);
}

function hasViewItemMenu(commandId, predicate) {
  return packageJson.contributes.menus['view/item/context'].some(
    (item) => item.command === commandId && predicate(item)
  );
}

function hasViewTitleMenu(commandId, predicate = () => true) {
  return packageJson.contributes.menus['view/title'].some(
    (item) => item.command === commandId && predicate(item)
  );
}

function getInlineViewItemContextCommands() {
  return [...new Set(
    packageJson.contributes.menus['view/item/context']
      .filter((item) => typeof item.group === 'string' && item.group.startsWith('inline@'))
      .map((item) => item.command)
  )];
}

test('package manifest exposes the 2.0.0 multi-repo, search, remote-host, history, remote-management, worktree, tag, and advanced-branch contributions', () => {
  assert.equal(packageJson.version, '2.0.0');

  const expectedCommands = [
    ['gitBranchesPanel.selectRepository', 'Select Active Repository'],
    ['gitBranchesPanel.focusActiveEditorRepository', 'Focus Repository from Active Editor'],
    ['gitBranchesPanel.findRef', 'Find Ref...'],
    ['gitBranchesPanel.setFilter', 'Set Filter...'],
    ['gitBranchesPanel.clearFilter', 'Clear Filter'],
    ['gitBranchesPanel.toggleShowOnlyPinned', 'Toggle Show Only Pinned'],
    ['gitBranchesPanel.showNeedsAttention', 'Show Needs Attention'],
    ['gitBranchesPanel.fetchAllRepositories', 'Fetch All Repositories'],
    ['gitBranchesPanel.fetchAllRepositoriesPrune', 'Fetch All Repositories (Prune)'],
    ['gitBranchesPanel.syncAllRepositoriesBranches', 'Sync All Repositories Branches'],
    ['gitBranchesPanel.pullAllRepositoriesChanges', 'Pull All Repositories Changes'],
    ['gitBranchesPanel.showAllRepositoriesActions', 'More Actions'],
    ['gitBranchesPanel.showRepositoryActions', 'More Actions'],
    ['gitBranchesPanel.openBranchOnRemote', 'Open Branch on Remote'],
    ['gitBranchesPanel.openComparePage', 'Open Compare Page'],
    ['gitBranchesPanel.createPullRequest', 'Create Pull Request'],
    ['gitBranchesPanel.copyBranchUrl', 'Copy Branch URL'],
    ['gitBranchesPanel.copyCompareUrl', 'Copy Compare URL'],
    ['gitBranchesPanel.compareWithUpstream', 'Compare with Upstream'],
    ['gitBranchesPanel.compareTwoRefs', 'Compare Two Refs...'],
    ['gitBranchesPanel.showBranchCommits', 'Show Branch Commits'],
    ['gitBranchesPanel.showRefHistory', 'Show Ref History'],
    ['gitBranchesPanel.openChangedFilesForRef', 'Open Changed Files for Ref'],
    ['gitBranchesPanel.addRemote', 'Add Remote...'],
    ['gitBranchesPanel.fetchRemote', 'Fetch Remote'],
    ['gitBranchesPanel.fetchRemotePrune', 'Fetch Remote (Prune)'],
    ['gitBranchesPanel.copyRemoteFetchUrl', 'Copy Fetch URL'],
    ['gitBranchesPanel.copyRemotePushUrl', 'Copy Push URL'],
    ['gitBranchesPanel.openRemoteHomepage', 'Open Remote Homepage'],
    ['gitBranchesPanel.renameRemote', 'Rename Remote...'],
    ['gitBranchesPanel.setRemoteFetchUrl', 'Set Fetch URL...'],
    ['gitBranchesPanel.setRemotePushUrl', 'Set Push URL...'],
    ['gitBranchesPanel.removeRemote', 'Remove Remote'],
    ['gitBranchesPanel.pruneWorktrees', 'Prune Worktrees...'],
    ['gitBranchesPanel.lockWorktree', 'Lock Worktree...'],
    ['gitBranchesPanel.unlockWorktree', 'Unlock Worktree'],
    ['gitBranchesPanel.copyWorktreeRef', 'Copy Worktree Ref'],
    ['gitBranchesPanel.openWorktreeInTerminal', 'Open Worktree in Terminal'],
    ['gitBranchesPanel.pushTag', 'Push Tag'],
    ['gitBranchesPanel.deleteRemoteTag', 'Delete Remote Tag'],
    ['gitBranchesPanel.compareTagWithCurrent', 'Compare Tag with Current Branch'],
    ['gitBranchesPanel.showTagDetails', 'Show Tag Details'],
    ['gitBranchesPanel.copyTagTargetSha', 'Copy Tag Target SHA'],
    ['gitBranchesPanel.showAdvancedBranchOperations', 'Advanced Branch Operations...'],
    ['gitBranchesPanel.rebaseCurrentOntoSelected', 'Rebase Current onto Selected'],
    ['gitBranchesPanel.rebaseSelectedOntoCurrent', 'Rebase Selected onto Current'],
    ['gitBranchesPanel.squashMergeIntoCurrent', 'Squash Merge into Current'],
    ['gitBranchesPanel.resetCurrentToSelected', 'Reset Current to Selected...'],
    ['gitBranchesPanel.forcePushWithLease', 'Force Push with Lease'],
  ];

  for (const [commandId, title] of expectedCommands) {
    assert.equal(getCommand(commandId)?.title, title, `Command '${commandId}' should be contributed.`);
  }

  assert.equal(getCommand('gitBranchesPanel.findRef').icon, '$(search)');
  assert.equal(getCommand('gitBranchesPanel.openComparePage').icon, '$(link-external)');
  assert.equal(getCommand('gitBranchesPanel.addRemote').icon, '$(add)');
  assert.equal(getCommand('gitBranchesPanel.fetchAllRepositories').icon, '$(repo-fetch)');
  assert.equal(getCommand('gitBranchesPanel.fetchAllRepositoriesPrune').icon, '$(clear-all)');
  assert.equal(getCommand('gitBranchesPanel.syncAllRepositoriesBranches').icon, '$(sync)');
  assert.equal(getCommand('gitBranchesPanel.pullAllRepositoriesChanges').icon, '$(repo-pull)');
  assert.equal(getCommand('gitBranchesPanel.showAllRepositoriesActions').icon, '$(ellipsis)');
  assert.equal(getCommand('gitBranchesPanel.showRepositoryActions').icon, '$(ellipsis)');
  assert.equal(getCommand('gitBranchesPanel.pruneWorktrees').icon, '$(clear-all)');
  assert.equal(getCommand('gitBranchesPanel.lockWorktree').icon, '$(lock)');
  assert.equal(getCommand('gitBranchesPanel.unlockWorktree').icon, '$(unlock)');
  assert.equal(getCommand('gitBranchesPanel.openWorktreeInTerminal').icon, '$(terminal)');
  assert.equal(getCommand('gitBranchesPanel.pushTag').icon, '$(cloud-upload)');
  assert.equal(getCommand('gitBranchesPanel.showAdvancedBranchOperations').icon, '$(tools)');
  assert.equal(getCommand('gitBranchesPanel.resetCurrentToSelected').icon, '$(discard)');
  assert.equal(getCommand('gitBranchesPanel.forcePushWithLease').icon, '$(cloud-upload)');

  const settings = packageJson.contributes.configuration.properties;
  assert.equal(settings['gitBranchesPanel.multiRepository.mode'].default, 'auto');
  assert.equal(settings['gitBranchesPanel.multiRepository.followActiveEditor'].default, false);
  assert.equal(settings['gitBranchesPanel.sections.local.visible'].default, true);
  assert.equal(settings['gitBranchesPanel.sections.remote.visible'].default, true);
  assert.equal(settings['gitBranchesPanel.sections.remotes.visible'].default, false);
  assert.equal(settings['gitBranchesPanel.sections.stash.visible'].default, true);
  assert.equal(settings['gitBranchesPanel.sections.worktree.visible'].default, true);
  assert.equal(settings['gitBranchesPanel.sections.hooks.visible'].default, true);
  assert.equal(settings['gitBranchesPanel.sections.tags.visible'].default, true);
  assert.equal(settings['gitBranchesPanel.showRemotesSection'].default, false);
  assert.match(settings['gitBranchesPanel.showRemotesSection'].description, /Deprecated/i);
  assert.equal(settings['gitBranchesPanel.tags.defaultType'].default, 'annotated');
  assert.deepEqual(settings['gitBranchesPanel.tags.defaultType'].enum, [
    'lightweight',
    'annotated',
    'signedAnnotated',
  ]);
  assert.equal(settings['gitBranchesPanel.tags.pushAfterCreate'].default, false);
  assert.equal(settings['gitBranchesPanel.tags.requireMessageForAnnotated'].default, true);
  assert.equal(settings['gitBranchesPanel.branchContextMenu.showRebaseCurrentOntoSelected'].default, false);
  assert.equal(settings['gitBranchesPanel.branchContextMenu.showRebaseSelectedOntoCurrent'].default, false);
  assert.equal(settings['gitBranchesPanel.branchContextMenu.showSquashMergeIntoCurrent'].default, false);
  assert.equal(settings['gitBranchesPanel.branchContextMenu.showResetCurrentToSelected'].default, false);
  assert.equal(settings['gitBranchesPanel.branchContextMenu.showForcePushWithLease'].default, false);
  assert.equal(settings['gitBranchesPanel.toolbar.showPullAllRepositoriesChanges'].default, true);
  assert.equal(settings['gitBranchesPanel.search.includeHooks'].default, false);
  assert.equal(settings['gitBranchesPanel.search.maxResults'].default, 200);
  assert.equal(settings['gitBranchesPanel.search.autoLoadAllSections'].default, true);
  assert.equal(settings['gitBranchesPanel.remoteHosting.preferredRemote'].default, '');
  assert.equal(settings['gitBranchesPanel.remoteHosting.compareBase'].default, 'defaultBranch');
  assert.deepEqual(settings['gitBranchesPanel.remoteHosting.compareBase'].enum, [
    'defaultBranch',
    'upstream',
    'currentBranch',
  ]);
  assert.deepEqual(settings['gitBranchesPanel.remoteHosting.customProviders'].default, []);
  assert.equal(settings['gitBranchesPanel.history.maxCommits'].default, 50);
  assert.equal(settings['gitBranchesPanel.history.includeMerges'].default, true);
  assert.equal(settings['gitBranchesPanel.advanced.enableForcePushWithLease'].default, true);
  assert.equal(settings['gitBranchesPanel.advanced.defaultResetMode'].default, 'mixed');
  assert.deepEqual(settings['gitBranchesPanel.advanced.defaultResetMode'].enum, [
    'soft',
    'mixed',
    'hard',
  ]);
  assert.equal(settings['gitBranchesPanel.advanced.allowNonCurrentBranchRebase'].default, true);
  assert.equal(settings['gitBranchesPanel.advanced.rebaseAutostash'].default, true);

  assert.ok(
    hasViewTitleMenu(
      'gitBranchesPanel.selectRepository',
      (item) =>
        item.when.includes('gitBranchesPanel.multipleRepositories') &&
        item.when.includes('!gitBranchesPanel.groupedRepositories')
    )
  );
  assert.ok(
    hasViewTitleMenu(
      'gitBranchesPanel.syncAllRepositoriesBranches',
      (item) => item.when.includes('gitBranchesPanel.groupedRepositories')
    )
  );
  assert.ok(
    hasViewTitleMenu(
      'gitBranchesPanel.pullAllRepositoriesChanges',
      (item) => item.when.includes('gitBranchesPanel.groupedRepositories')
    )
  );
  assert.ok(
    hasViewTitleMenu(
      'gitBranchesPanel.fetchAllRepositories',
      (item) => item.when.includes('gitBranchesPanel.groupedRepositories')
    )
  );
  assert.ok(
    hasViewTitleMenu(
      'gitBranchesPanel.fetchAllRepositoriesPrune',
      (item) => item.when.includes('gitBranchesPanel.groupedRepositories')
    )
  );
  assert.ok(hasViewTitleMenu('gitBranchesPanel.findRef'));
  assert.ok(
    hasViewTitleMenu(
      'gitBranchesPanel.showAdvancedActions',
      (item) => item.when.includes('!gitBranchesPanel.groupedRepositories')
    )
  );
  assert.ok(
    hasViewTitleMenu(
      'gitBranchesPanel.showAllRepositoriesActions',
      (item) => item.when.includes('gitBranchesPanel.groupedRepositories')
    )
  );
  assert.ok(
    hasViewTitleMenu(
      'gitBranchesPanel.clearFilter',
      (item) => item.when.includes('gitBranchesPanel.filterActive')
    )
  );

  assert.ok(
    hasViewItemMenu(
      'gitBranchesPanel.pruneWorktrees',
      (item) => item.when === 'viewItem == worktreeSection' && item.group === 'inline@2'
    )
  );
  assert.ok(
    hasViewItemMenu(
      'gitBranchesPanel.addRemote',
      (item) => item.when === 'viewItem == remotesSection' && item.group === 'inline@1'
    )
  );
  assert.ok(
    hasViewItemMenu(
      'gitBranchesPanel.newBranch',
      (item) =>
        item.when === 'viewItem =~ /^(?:activeRepository|repository)(?::(?:busyCurrentBranch|publishableCurrentBranch))?$/' &&
        item.group === 'inline@1'
    )
  );
  assert.ok(
    hasViewItemMenu(
      'gitBranchesPanel.publishCurrentBranch',
      (item) => item.when === 'viewItem =~ /^(?:activeRepository|repository):publishableCurrentBranch$/' && item.group === 'inline@2'
    )
  );
  assert.ok(
    hasViewItemMenu(
      'gitBranchesPanel.syncCurrentBranch',
      (item) => item.when === 'viewItem == repository || viewItem == activeRepository' && item.group === 'inline@2'
    )
  );
  assert.ok(
    hasViewItemMenu(
      'gitBranchesPanel.fetchAllPrune',
      (item) => item.when === 'viewItem =~ /^(?:activeRepository|repository)(?::(?:busyCurrentBranch|publishableCurrentBranch))?$/' && item.group === 'inline@3'
    )
  );
  assert.ok(
    hasViewItemMenu(
      'gitBranchesPanel.showRepositoryActions',
      (item) => item.when === 'viewItem =~ /^(?:activeRepository|repository)(?::(?:busyCurrentBranch|publishableCurrentBranch))?$/' && item.group === 'inline@4'
    )
  );
  assert.ok(
    hasViewItemMenu(
      'gitBranchesPanel.pushTag',
      (item) => item.when === 'viewItem == tag' && item.group === 'inline@2'
    )
  );
  assert.ok(
    hasViewItemMenu(
      'gitBranchesPanel.fetchRemote',
      (item) => item.when === 'viewItem == remoteConfig' && item.group === 'inline@1'
    )
  );
  assert.ok(
    hasViewItemMenu(
      'gitBranchesPanel.fetchRemotePrune',
      (item) => item.when === 'viewItem == remoteConfig' && item.group === 'inline@2'
    )
  );

  assert.ok(
    hasViewItemMenu(
      'gitBranchesPanel.openWorktree',
      (item) =>
        item.when === 'viewItem =~ /^(?:pinned:)?(?:worktree|currentWorktree)(?::(?:detached|locked|prunable))*$/' &&
        item.group === '1_worktree@1'
    )
  );
  assert.ok(
    hasViewItemMenu(
      'gitBranchesPanel.openWorktreeInTerminal',
      (item) =>
        item.when === 'viewItem =~ /^(?:pinned:)?(?:worktree|currentWorktree)(?::(?:detached|locked|prunable))*$/' &&
        item.group === '1_worktree@3.5'
    )
  );
  assert.ok(
    hasViewItemMenu(
      'gitBranchesPanel.copyWorktreeRef',
      (item) =>
        item.when === 'viewItem =~ /^(?:pinned:)?(?:worktree|currentWorktree)(?::(?:detached|locked|prunable))*$/' &&
        item.group === '1_worktree@4.5'
    )
  );
  assert.ok(
    hasViewItemMenu(
      'gitBranchesPanel.lockWorktree',
      (item) =>
        item.when === 'viewItem =~ /^(?:pinned:)?worktree(?::detached)?$/' &&
        item.group === '1_worktree@5.5'
    )
  );
  assert.ok(
    hasViewItemMenu(
      'gitBranchesPanel.unlockWorktree',
      (item) =>
        item.when === 'viewItem =~ /^(?:pinned:)?worktree(?::detached)?(?::locked)(?::prunable)?$/' &&
        item.group === '1_worktree@5.6'
    )
  );
  assert.ok(
    hasViewItemMenu(
      'gitBranchesPanel.pruneWorktrees',
      (item) =>
        item.when === 'viewItem =~ /^(?:pinned:)?worktree(?::detached)?(?::locked)?(?::prunable)$/' &&
        item.group === '1_worktree@5.7'
    )
  );
  assert.ok(
    hasViewItemMenu(
      'gitBranchesPanel.openRemoteHomepage',
      (item) => item.when === 'viewItem == remoteConfig' && item.group === '1_remoteConfig@3'
    )
  );
  assert.ok(
    hasViewItemMenu(
      'gitBranchesPanel.newBranch',
      (item) =>
        item.when === 'viewItem =~ /^(?:activeRepository|repository)(?::(?:busyCurrentBranch|publishableCurrentBranch))?$/' &&
        item.group === '1_repository@1'
    )
  );
  assert.ok(
    hasViewItemMenu(
      'gitBranchesPanel.publishCurrentBranch',
      (item) => item.when === 'viewItem =~ /^(?:activeRepository|repository):publishableCurrentBranch$/' && item.group === '1_repository@2'
    )
  );
  assert.ok(
    hasViewItemMenu(
      'gitBranchesPanel.syncCurrentBranch',
      (item) => item.when === 'viewItem == repository || viewItem == activeRepository' && item.group === '1_repository@2'
    )
  );
  assert.ok(
    hasViewItemMenu(
      'gitBranchesPanel.fetchAllPrune',
      (item) => item.when === 'viewItem =~ /^(?:activeRepository|repository)(?::(?:busyCurrentBranch|publishableCurrentBranch))?$/' && item.group === '1_repository@3'
    )
  );
  assert.ok(
    hasViewItemMenu(
      'gitBranchesPanel.showRepositoryActions',
      (item) =>
        item.when === 'viewItem =~ /^(?:activeRepository|repository)(?::(?:busyCurrentBranch|publishableCurrentBranch))?$/' &&
        item.group === '1_repository@4'
    )
  );
  assert.ok(
    hasViewItemMenu(
      'gitBranchesPanel.rebaseCurrentOntoSelected',
      (item) =>
        item.when ===
          'config.gitBranchesPanel.branchContextMenu.showRebaseCurrentOntoSelected && viewItem =~ /^(?:pinned:)?(?:branch|publishableBranch|remoteBranch|staleRemoteBranch|missingUpstreamBranch|protectedBranch|protectedPublishableBranch|protectedRemoteBranch|protectedStaleRemoteBranch|protectedMissingUpstreamBranch)$/' &&
        item.group === '2_advanced@1'
    )
  );
  assert.ok(
    hasViewItemMenu(
      'gitBranchesPanel.rebaseSelectedOntoCurrent',
      (item) =>
        item.when ===
          'config.gitBranchesPanel.branchContextMenu.showRebaseSelectedOntoCurrent && viewItem =~ /^(?:pinned:)?(?:branch|publishableBranch|missingUpstreamBranch|protectedBranch|protectedPublishableBranch|protectedMissingUpstreamBranch)$/' &&
        item.group === '2_advanced@2'
    )
  );
  assert.ok(
    hasViewItemMenu(
      'gitBranchesPanel.squashMergeIntoCurrent',
      (item) =>
        item.when ===
          'config.gitBranchesPanel.branchContextMenu.showSquashMergeIntoCurrent && viewItem =~ /^(?:pinned:)?(?:branch|publishableBranch|remoteBranch|staleRemoteBranch|missingUpstreamBranch|protectedBranch|protectedPublishableBranch|protectedRemoteBranch|protectedStaleRemoteBranch|protectedMissingUpstreamBranch)$/' &&
        item.group === '2_advanced@3'
    )
  );
  assert.ok(
    hasViewItemMenu(
      'gitBranchesPanel.resetCurrentToSelected',
      (item) =>
        item.when ===
          'config.gitBranchesPanel.branchContextMenu.showResetCurrentToSelected && viewItem =~ /^(?:pinned:)?(?:branch|publishableBranch|remoteBranch|staleRemoteBranch|missingUpstreamBranch|protectedBranch|protectedPublishableBranch|protectedRemoteBranch|protectedStaleRemoteBranch|protectedMissingUpstreamBranch)$/' &&
        item.group === '2_advanced@4'
    )
  );
  assert.ok(
    hasViewItemMenu(
      'gitBranchesPanel.forcePushWithLease',
      (item) =>
        item.when ===
          'config.gitBranchesPanel.branchContextMenu.showForcePushWithLease && viewItem =~ /^(?:pinned:)?(?:branch|currentBranch|protectedBranch)$/' &&
        item.group === '2_advanced@5'
    )
  );
  assert.equal(
    hasViewItemMenu('gitBranchesPanel.showAdvancedBranchOperations', () => true),
    false
  );
  assert.ok(
    hasViewItemMenu(
      'gitBranchesPanel.compareTagWithCurrent',
      (item) => item.when === 'viewItem == tag' && item.group === '1_tag@2.7'
    )
  );
  assert.ok(
    hasViewItemMenu(
      'gitBranchesPanel.showTagDetails',
      (item) => item.when === 'viewItem == tag' && item.group === '1_tag@2.8'
    )
  );
  assert.ok(
    hasViewItemMenu(
      'gitBranchesPanel.copyTagTargetSha',
      (item) => item.when === 'viewItem == tag' && item.group === '1_tag@2.9'
    )
  );
  assert.ok(
    hasViewItemMenu(
      'gitBranchesPanel.deleteRemoteTag',
      (item) => item.when === 'viewItem == tag' && item.group === '2_tag@1.5'
    )
  );
  assert.ok(
    hasViewItemMenu(
      'gitBranchesPanel.setRemoteFetchUrl',
      (item) => item.when === 'viewItem == remoteConfig' && item.group === '1_remoteConfig@7'
    )
  );
  assert.ok(
    hasViewItemMenu(
      'gitBranchesPanel.setRemotePushUrl',
      (item) => item.when === 'viewItem == remoteConfig' && item.group === '1_remoteConfig@8'
    )
  );
  assert.ok(
    hasViewItemMenu(
      'gitBranchesPanel.removeRemote',
      (item) => item.when === 'viewItem == remoteConfig' && item.group === '2_remoteConfig@1'
    )
  );

  const inlineCommandIds = getInlineViewItemContextCommands();
  for (const commandId of inlineCommandIds) {
    const command = getCommand(commandId);
    assert.ok(command, `Inline command '${commandId}' must be contributed.`);
    assert.ok(command.icon, `Inline command '${commandId}' must define an icon.`);
  }
});
