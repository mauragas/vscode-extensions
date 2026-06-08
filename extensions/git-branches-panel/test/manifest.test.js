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

test('package manifest exposes the 1.7.0 branch-menu, worktree rename, and stash contributions', () => {
  assert.equal(packageJson.version, '1.7.0');
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
      (item) => item.command === 'gitBranchesPanel.createTag' && item.when === 'viewItem == tagsSection' && item.group === 'inline@1'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.pushAllTags' && item.when === 'viewItem == tagsSection' && item.group === 'inline@2'
    )
  );

  for (const commandId of getInlineViewItemContextCommands()) {
    const command = getCommand(commandId);
    assert.ok(command, `Inline view/item/context command '${commandId}' must be contributed.`);
    assert.ok(command.icon, `Inline view/item/context command '${commandId}' must define an icon.`);
  }
});
