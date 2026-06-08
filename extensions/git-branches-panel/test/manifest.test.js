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

test('package manifest exposes the 1.6.0 branch-menu and stash contributions', () => {
  assert.equal(packageJson.version, '1.6.0');
  assert.equal(getCommand('gitBranchesPanel.stashSilently').title, 'Stash all changes silently');
  assert.equal(
    getCommand('gitBranchesPanel.stashStagedSilently').title,
    'Stash staged changes silently'
  );
  assert.equal(getCommand('gitBranchesPanel.stashAllChanges').title, 'Stash all changes');
  assert.equal(getCommand('gitBranchesPanel.stashStagedChanges').title, 'Stash staged changes');

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
});
