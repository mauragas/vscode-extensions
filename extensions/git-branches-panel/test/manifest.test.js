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

test('package manifest exposes the 1.6.0 branch-menu and stash contributions', () => {
  assert.equal(packageJson.version, '1.6.0');
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
  assert.equal(
    getCommand('gitBranchesPanel.createWorktreeFromCurrentBranch').title,
    'Create New Worktree...'
  );
  assert.equal(getCommand('gitBranchesPanel.pinItem').title, 'Pin');
  assert.equal(getCommand('gitBranchesPanel.unpinItem').title, 'Unpin');
  assert.equal(getCommand('gitBranchesPanel.pinItem').icon, '$(pin)');
  assert.equal(getCommand('gitBranchesPanel.unpinItem').icon, '$(pinned)');

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
  assert.equal(settings['gitBranchesPanel.toolbar.showStashSilently'].default, false);
  assert.equal(settings['gitBranchesPanel.changesView.showStashAllChangesSilently'].default, true);
  assert.equal(settings['gitBranchesPanel.changesView.showStashStagedChangesSilently'].default, false);
  assert.equal(settings['gitBranchesPanel.changesView.showStashAllChanges'].default, false);
  assert.equal(settings['gitBranchesPanel.changesView.showStashStagedChanges'].default, false);

  const branchMenuSlots = packageJson.contributes.menus['view/item/context'].filter(
    (item) => item.group === '1_branchCustom@1'
  );
  assert.ok(branchMenuSlots.some((item) => item.when.includes("gitBranchesPanel.branchContextMenu.slot1")));
  assert.ok(
    packageJson.contributes.menus['view/item/context'].some(
      (item) => item.command === 'gitBranchesPanel.showBranchActions' && item.group === '2_more@1'
    )
  );

  const sectionInlineMenus = packageJson.contributes.menus['view/item/context'];
  const [pinInlineMenu] = getViewItemContextMenuItems('gitBranchesPanel.pinItem');
  const [unpinInlineMenu] = getViewItemContextMenuItems('gitBranchesPanel.unpinItem');

  assert.equal(pinInlineMenu.group, 'inline@4');
  assert.equal(unpinInlineMenu.group, 'inline@4');
  assert.ok(pinInlineMenu.when.includes('viewItem == branch'));
  assert.ok(unpinInlineMenu.when.includes('viewItem == branch'));
  assert.ok(pinInlineMenu.when.includes('view == gitBranchesPanel'));
  assert.ok(pinInlineMenu.when.includes('view == gitBranchesSCM'));
  assert.ok(unpinInlineMenu.when.includes('view == gitBranchesPanel'));
  assert.ok(unpinInlineMenu.when.includes('view == gitBranchesSCM'));
  assert.ok(pinInlineMenu.when.includes('!gitBranchesPanel.branchesViewSelectedItemPinned'));
  assert.ok(pinInlineMenu.when.includes('!gitBranchesPanel.scmViewSelectedItemPinned'));
  assert.ok(unpinInlineMenu.when.includes('gitBranchesPanel.branchesViewSelectedItemPinned'));
  assert.ok(unpinInlineMenu.when.includes('gitBranchesPanel.scmViewSelectedItemPinned'));
  assert.equal(
    pinInlineMenu.when
      .replace(' && ((view == gitBranchesPanel && !gitBranchesPanel.branchesViewSelectedItemPinned) || (view == gitBranchesSCM && !gitBranchesPanel.scmViewSelectedItemPinned))', ''),
    unpinInlineMenu.when
      .replace(' && ((view == gitBranchesPanel && gitBranchesPanel.branchesViewSelectedItemPinned) || (view == gitBranchesSCM && gitBranchesPanel.scmViewSelectedItemPinned))', '')
  );
  assert.ok(
    !sectionInlineMenus.some((item) => item.command === 'gitBranchesPanel.togglePinItem')
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
      (item) => item.command === 'gitBranchesPanel.openWorktree' && item.when === 'viewItem == worktree || viewItem == currentWorktree' && item.group === 'inline@1'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.openWorktreeInNewWindow' && item.when === 'viewItem == worktree || viewItem == currentWorktree' && item.group === 'inline@2'
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
      (item) => item.command === 'gitBranchesPanel.popStash' && item.when === 'viewItem == stash' && item.group === 'inline@1'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.applyStash' && item.when === 'viewItem == stash' && item.group === 'inline@2'
    )
  );
  assert.ok(
    sectionInlineMenus.some(
      (item) => item.command === 'gitBranchesPanel.dropStash' && item.when === 'viewItem == stash' && item.group === 'inline@3'
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
