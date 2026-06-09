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

function getViewItemContextMenuItems(commandId) {
  return packageJson.contributes.menus['view/item/context'].filter(
    (item) => item.command === commandId
  );
}

function getInlineViewItemContextCommands() {
  return [...new Set(
    packageJson.contributes.menus['view/item/context']
      .filter((item) => typeof item.group === 'string' && item.group.startsWith('inline@'))
      .map((item) => item.command)
  )];
}

test('package manifest exposes the 2.4.0 branch-menu, worktree, stash, hook, multi-repo, search, remote-host, history, and remote-management contributions', () => {
  assert.equal(packageJson.version, '2.4.0');
  assert.equal(getCommand('gitBranchesPanel.selectRepository').title, 'Select Active Repository');
  assert.equal(getCommand('gitBranchesPanel.selectRepository').icon, '$(repo)');
  assert.equal(
    getCommand('gitBranchesPanel.focusActiveEditorRepository').title,
    'Focus Repository from Active Editor'
  );
  assert.equal(getCommand('gitBranchesPanel.addRemote').title, 'Add Remote...');
  assert.equal(getCommand('gitBranchesPanel.fetchRemote').title, 'Fetch Remote');
  assert.equal(getCommand('gitBranchesPanel.fetchRemotePrune').title, 'Fetch Remote (Prune)');
  assert.equal(getCommand('gitBranchesPanel.copyRemoteFetchUrl').title, 'Copy Fetch URL');
  assert.equal(getCommand('gitBranchesPanel.copyRemotePushUrl').title, 'Copy Push URL');
  assert.equal(getCommand('gitBranchesPanel.openRemoteHomepage').title, 'Open Remote Homepage');
  assert.equal(getCommand('gitBranchesPanel.renameRemote').title, 'Rename Remote...');
  assert.equal(getCommand('gitBranchesPanel.setRemoteFetchUrl').title, 'Set Fetch URL...');
  assert.equal(getCommand('gitBranchesPanel.setRemotePushUrl').title, 'Set Push URL...');
  assert.equal(getCommand('gitBranchesPanel.removeRemote').title, 'Remove Remote');
  assert.equal(getCommand('gitBranchesPanel.findRef').title, 'Find Ref...');
  assert.equal(getCommand('gitBranchesPanel.findRef').icon, '$(search)');
  assert.equal(getCommand('gitBranchesPanel.setFilter').title, 'Set Filter...');
  assert.equal(getCommand('gitBranchesPanel.clearFilter').title, 'Clear Filter');
  assert.equal(getCommand('gitBranchesPanel.toggleShowOnlyPinned').title, 'Toggle Show Only Pinned');
  assert.equal(getCommand('gitBranchesPanel.showNeedsAttention').title, 'Show Needs Attention');
  assert.equal(getCommand('gitBranchesPanel.openBranchOnRemote').title, 'Open Branch on Remote');
  assert.equal(getCommand('gitBranchesPanel.openComparePage').title, 'Open Compare Page');
  assert.equal(getCommand('gitBranchesPanel.createPullRequest').title, 'Create Pull Request');
  assert.equal(getCommand('gitBranchesPanel.copyBranchUrl').title, 'Copy Branch URL');
  assert.equal(getCommand('gitBranchesPanel.copyCompareUrl').title, 'Copy Compare URL');
  assert.equal(getCommand('gitBranchesPanel.compareWithUpstream').title, 'Compare with Upstream');
  assert.equal(getCommand('gitBranchesPanel.compareTwoRefs').title, 'Compare Two Refs...');
  assert.equal(getCommand('gitBranchesPanel.showBranchCommits').title, 'Show Branch Commits');
  assert.equal(getCommand('gitBranchesPanel.showRefHistory').title, 'Show Ref History');
  assert.equal(getCommand('gitBranchesPanel.openChangedFilesForRef').title, 'Open Changed Files for Ref');
  assert.equal(getCommand('gitBranchesPanel.stashSilently').title, 'Stash all changes silently');
  assert.equal(
    getCommand('gitBranchesPanel.stashStagedSilently').title,
    'Stash staged changes silently'
  );
  assert.equal(getCommand('gitBranchesPanel.stashAllChanges').title, 'Stash all changes');
  assert.equal(getCommand('gitBranchesPanel.stashStagedChanges').title, 'Stash staged changes');
  assert.equal(getCommand('gitBranchesPanel.syncAllBranches').title, 'Sync All Branches');
  assert.equal(getCommand('gitBranchesPanel.pullAllLocalBranches').title, 'Pull All Branch Changes');
  assert.equal(getCommand('gitBranchesPanel.fetchAll').icon, '$(repo-fetch)');
  assert.equal(getCommand('gitBranchesPanel.fetchAllPrune').icon, '$(clear-all)');
  assert.notEqual(getCommand('gitBranchesPanel.fetchAll').icon, getCommand('gitBranchesPanel.fetchAllPrune').icon);
  assert.equal(getCommand('gitBranchesPanel.applyLatestStash').title, 'Apply Latest Stash');
  assert.equal(getCommand('gitBranchesPanel.renameStash').title, 'Rename Stash...');
  assert.equal(getCommand('gitBranchesPanel.renameStash').icon, '$(edit)');
  assert.equal(
    getCommand('gitBranchesPanel.compareStashWithCurrent').title,
    'Show Stashed Changes vs Current Branch'
  );
  assert.equal(getCommand('gitBranchesPanel.compareStashWithCurrent').icon, '$(diff-multiple)');
  assert.equal(getCommand('gitBranchesPanel.editHook').title, 'Edit Hook');
  assert.equal(getCommand('gitBranchesPanel.editHook').icon, '$(edit)');
  assert.equal(getCommand('gitBranchesPanel.enableHook').title, 'Enable Hook');
  assert.equal(getCommand('gitBranchesPanel.enableHook').icon, '$(play)');
  assert.equal(getCommand('gitBranchesPanel.disableHook').title, 'Disable Hook');
  assert.equal(getCommand('gitBranchesPanel.disableHook').icon, '$(close)');
  assert.equal(getCommand('gitBranchesPanel.enableAllHooks').title, 'Enable All Hooks');
  assert.equal(getCommand('gitBranchesPanel.enableAllHooks').icon, '$(play)');
  assert.equal(getCommand('gitBranchesPanel.disableAllHooks').title, 'Disable All Hooks');
  assert.equal(getCommand('gitBranchesPanel.disableAllHooks').icon, '$(close)');
  assert.equal(
    getCommand('gitBranchesPanel.createWorktreeFromCurrentBranch').title,
    'Create New Worktree...'
  );
  assert.equal(getCommand('gitBranchesPanel.pinItem').title, 'Pin');
  assert.equal(getCommand('gitBranchesPanel.unpinItem').title, 'Unpin');
  assert.equal(getCommand('gitBranchesPanel.pinItem').icon, '$(pin)');
  assert.equal(getCommand('gitBranchesPanel.unpinItem').icon, '$(pinned)');
  assert.equal(getCommand('gitBranchesPanel.renameWorktree').title, 'Rename Worktree...');
  assert.equal(getCommand('gitBranchesPanel.renameWorktree').icon, '$(edit)');

  const scmTitleMenus = packageJson.contributes.menus['scm/title'];
  assert.deepEqual(
    scmTitleMenus.map((item) => item.command),
    [
      'gitBranchesPanel.stashSilently',
      'gitBranchesPanel.stashStagedSilently',
      'gitBranchesPanel.stashAllChanges',
      'gitBranchesPanel.stashStagedChanges',
    ]
  );
  assert.ok(scmTitleMenus.every((item) => item.when.includes('scmProvider == git')));

  const settings = packageJson.contributes.configuration.properties;
  assert.deepEqual(settings['gitBranchesPanel.branchContextMenu.primaryActions'].default, [
    'syncOrPublish',
    'checkout',
    'newBranchFromSelected',
    'newBranchFromSelectedAndCheckout',
    'createWorktree',
    'renameBranch',
    'createTag',
    'copyBranchName',
    'compareWithCurrent',
    'mergeIntoCurrent',
    'cherryPickIntoCurrent',
    'deleteOrCleanup',
  ]);
  assert.equal(settings['gitBranchesPanel.tagSortOrder'].default, 'versionDescending');
  assert.deepEqual(settings['gitBranchesPanel.tagSortOrder'].enum, [
    'versionDescending',
    'versionAscending',
    'alphabetical',
    'recent',
  ]);
  assert.equal(settings['gitBranchesPanel.multiRepository.mode'].default, 'auto');
  assert.deepEqual(settings['gitBranchesPanel.multiRepository.mode'].enum, [
    'auto',
    'alwaysGroupByRepository',
    'singleActiveRepository',
  ]);
  assert.equal(settings['gitBranchesPanel.multiRepository.followActiveEditor'].default, false);
  assert.equal(settings['gitBranchesPanel.showRemotesSection'].default, true);
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
  assert.equal(settings['gitBranchesPanel.showCurrentBranchInfo'].default, false);
  assert.equal(settings['gitBranchesPanel.showStatusBarBranchAction'].default, true);
  assert.match(
    settings['gitBranchesPanel.showStatusBarBranchAction'].description,
    /deprecated/i
  );
  assert.match(
    settings['gitBranchesPanel.showStatusBarBranchAction'].deprecationMessage,
    /no longer has any effect/i
  );
  assert.equal(settings['gitBranchesPanel.toolbar.showStashSilently'].default, false);
  assert.equal(settings['gitBranchesPanel.changesView.showStashAllChangesSilently'].default, true);
  assert.equal(settings['gitBranchesPanel.changesView.showStashStagedChangesSilently'].default, false);
  assert.equal(settings['gitBranchesPanel.changesView.showStashAllChanges'].default, false);
  assert.equal(settings['gitBranchesPanel.changesView.showStashStagedChanges'].default, false);

  const branchMenuSlots = packageJson.contributes.menus['view/item/context'].filter(
    (item) => item.group === '1_branchCustom@1'
  );
  assert.ok(branchMenuSlots.some((item) => item.when.includes("gitBranchesPanel.branchContextMenu.slot1")));
  assert.ok(branchMenuSlots.some((item) => item.when.includes('(?:pinned:)?')));
  const showBranchActionsMenu = packageJson.contributes.menus['view/item/context'].find(
    (item) => item.command === 'gitBranchesPanel.showBranchActions' && item.group === '2_more@1'
  );
  assert.ok(showBranchActionsMenu);
  assert.ok(showBranchActionsMenu.when.includes('(?:pinned:)?'));

  const sectionInlineMenus = packageJson.contributes.menus['view/item/context'];
  const [pinInlineMenu] = getViewItemContextMenuItems('gitBranchesPanel.pinItem');
  const [unpinInlineMenu] = getViewItemContextMenuItems('gitBranchesPanel.unpinItem');

  assert.equal(pinInlineMenu.group, 'inline@4');
  assert.equal(unpinInlineMenu.group, 'inline@4');
  assert.ok(pinInlineMenu.when.includes('view == gitBranchesPanel'));
  assert.ok(pinInlineMenu.when.includes('view == gitBranchesSCM'));
  assert.ok(unpinInlineMenu.when.includes('view == gitBranchesPanel'));
  assert.ok(unpinInlineMenu.when.includes('view == gitBranchesSCM'));
  assert.ok(
    pinInlineMenu.when.includes(
      'viewItem =~ /^(?:branch|currentBranch|publishableBranch|publishableCurrentBranch|missingUpstreamBranch|remoteBranch|staleRemoteBranch|protectedBranch|protectedPublishableBranch|protectedRemoteBranch|protectedStaleRemoteBranch|protectedMissingUpstreamBranch|stash|worktree|currentWorktree)$/'
    )
  );
  assert.ok(
    unpinInlineMenu.when.includes(
      'viewItem =~ /^pinned:(?:branch|currentBranch|publishableBranch|publishableCurrentBranch|missingUpstreamBranch|remoteBranch|staleRemoteBranch|protectedBranch|protectedPublishableBranch|protectedRemoteBranch|protectedStaleRemoteBranch|protectedMissingUpstreamBranch|stash|worktree|currentWorktree)$/'
    )
  );
  assert.ok(!pinInlineMenu.when.includes('branchesViewSelectedItemPinned'));
  assert.ok(!pinInlineMenu.when.includes('scmViewSelectedItemPinned'));
  assert.ok(!unpinInlineMenu.when.includes('branchesViewSelectedItemPinned'));
  assert.ok(!unpinInlineMenu.when.includes('scmViewSelectedItemPinned'));
  assert.ok(
    !sectionInlineMenus.some((item) => item.command === 'gitBranchesPanel.togglePinItem')
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) =>
        item.command === 'gitBranchesPanel.syncBranch' &&
        item.group === 'inline@1' &&
        item.when === 'viewItem =~ /^(?:pinned:)?(?:branch|currentBranch|protectedBranch)$/'
    )
  );

  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.newBranch' && item.when === 'viewItem == localSection' && item.group === 'inline@1'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.syncAllBranches' && item.when === 'viewItem == localSection' && item.group === 'inline@2'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.pullAllLocalBranches' && item.when === 'viewItem == localSection' && item.group === 'inline@3'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.fetchAll' && item.when === 'viewItem == remoteSection' && item.group === 'inline@1'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.fetchAllPrune' && item.when === 'viewItem == remoteSection' && item.group === 'inline@2'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.popLatestStash' && item.when === 'viewItem == stashSection' && item.group === 'inline@1'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.applyLatestStash' && item.when === 'viewItem == stashSection' && item.group === 'inline@2'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.createWorktreeFromCurrentBranch' && item.when === 'viewItem == worktreeSection' && item.group === 'inline@1'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.addRemote' && item.when === 'viewItem == remotesSection' && item.group === 'inline@1'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.fetchRemote' && item.when === 'viewItem == remoteConfig' && item.group === 'inline@1'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.fetchRemotePrune' && item.when === 'viewItem == remoteConfig' && item.group === 'inline@2'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.enableAllHooks' && item.when === 'viewItem =~ /^hooksSection(?::hasEnabled)?(?::hasDisabled)$/' && item.group === 'inline@1'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.disableAllHooks' && item.when === 'viewItem =~ /^hooksSection:hasEnabled(?::hasDisabled)?$/' && item.group === 'inline@2'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.openWorktree' && item.when === 'viewItem =~ /^(?:pinned:)?(?:worktree|currentWorktree)$/' && item.group === 'inline@1'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.openWorktreeInNewWindow' && item.when === 'viewItem =~ /^(?:pinned:)?(?:worktree|currentWorktree)$/' && item.group === 'inline@2'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.removeWorktree' && item.when === 'viewItem =~ /^(?:pinned:)?(?:worktree)$/' && item.group === 'inline@3'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.renameWorktree' && item.when === 'viewItem =~ /^(?:pinned:)?(?:worktree)$/' && item.group === '1_worktree@5'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.checkoutTag' && item.when === 'viewItem == tag' && item.group === 'inline@1'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.deleteTag' && item.when === 'viewItem == tag' && item.group === 'inline@2'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.popStash' && item.when === 'viewItem =~ /^(?:pinned:)?(?:stash)$/' && item.group === 'inline@1'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.applyStash' && item.when === 'viewItem =~ /^(?:pinned:)?(?:stash)$/' && item.group === 'inline@2'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.dropStash' && item.when === 'viewItem =~ /^(?:pinned:)?(?:stash)$/' && item.group === 'inline@3'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.renameStash' && item.when === 'viewItem =~ /^(?:pinned:)?(?:stash)$/' && item.group === 'inline@4'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.disableHook' && item.when === 'viewItem =~ /^(?:localHook|sharedHook)$/' && item.group === 'inline@1'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.enableHook' && item.when === 'viewItem =~ /^(?:disabledLocalHook|disabledSharedHook)$/' && item.group === 'inline@1'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.editHook' && item.when === 'viewItem =~ /^(?:localHook|sharedHook|disabledLocalHook|disabledSharedHook)$/' && item.group === 'inline@2'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.compareStashWithCurrent' && item.when === 'viewItem =~ /^(?:pinned:)?(?:stash)$/' && item.group === '1_stash@2.5'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.renameStash' && item.when === 'viewItem =~ /^(?:pinned:)?(?:stash)$/' && item.group === '1_stash@3'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.editHook' && item.when === 'viewItem =~ /^(?:localHook|sharedHook|disabledLocalHook|disabledSharedHook)$/' && item.group === '1_hook@1'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.disableHook' && item.when === 'viewItem =~ /^(?:localHook|sharedHook)$/' && item.group === '1_hook@2'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.enableHook' && item.when === 'viewItem =~ /^(?:disabledLocalHook|disabledSharedHook)$/' && item.group === '1_hook@2'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.createTag' && item.when === 'viewItem == tagsSection' && item.group === 'inline@1'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.pushAllTags' && item.when === 'viewItem == tagsSection' && item.group === 'inline@2'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.addRemote' && item.group === '1_remotesSection@1'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.fetchRemote' && item.group === '1_remoteConfig@1'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.fetchRemotePrune' && item.group === '1_remoteConfig@2'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.openRemoteHomepage' && item.group === '1_remoteConfig@3'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.copyRemoteFetchUrl' && item.group === '1_remoteConfig@4'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.copyRemotePushUrl' && item.group === '1_remoteConfig@5'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.renameRemote' && item.group === '1_remoteConfig@6'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.setRemoteFetchUrl' && item.group === '1_remoteConfig@7'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.setRemotePushUrl' && item.group === '1_remoteConfig@8'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.removeRemote' && item.group === '2_remoteConfig@1'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.openBranchOnRemote' && item.group === '1_remoteHosting@1'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.openComparePage' && item.group === '1_remoteHosting@2'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.createPullRequest' && item.group === '1_remoteHosting@3'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.copyBranchUrl' && item.group === '1_remoteHosting@4'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.copyCompareUrl' && item.group === '1_remoteHosting@5'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.compareWithUpstream' && item.group === '1_history@1'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.showBranchCommits' && item.group === '1_history@2'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.openChangedFilesForRef' && item.group === '1_history@3'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.showRefHistory' && item.group === '1_tag@2.5'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.openChangedFilesForRef' && item.group === '1_tag@2.6'
    )
  );
  assert.ok(
    packageJson.contributes.menus['view/title'].some(
      (item) =>
        item.command === 'gitBranchesPanel.selectRepository' &&
        item.when.includes('gitBranchesPanel.multipleRepositories')
    )
  );
  assert.ok(
    packageJson.contributes.menus['view/title'].some(
      (item) => item.command === 'gitBranchesPanel.findRef'
    )
  );
  assert.ok(
    packageJson.contributes.menus['view/title'].some(
      (item) =>
        item.command === 'gitBranchesPanel.clearFilter' &&
        item.when.includes('gitBranchesPanel.filterActive')
    )
  );

  for (const commandId of getInlineViewItemContextCommands()) {
    const command = getCommand(commandId);
    assert.ok(command, `Inline view/item/context command '${commandId}' must be contributed.`);
    assert.ok(command.icon, `Inline view/item/context command '${commandId}' must define an icon.`);
  }
});
