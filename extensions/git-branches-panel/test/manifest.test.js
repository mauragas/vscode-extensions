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

test('package manifest exposes the 2.0.0 multi-repo, search, remote-host, history, remote-management, and worktree-maintenance contributions', () => {
  assert.equal(packageJson.version, '2.0.0');

  const expectedCommands = [
    ['gitBranchesPanel.selectRepository', 'Select Active Repository'],
    ['gitBranchesPanel.focusActiveEditorRepository', 'Focus Repository from Active Editor'],
    ['gitBranchesPanel.findRef', 'Find Ref...'],
    ['gitBranchesPanel.setFilter', 'Set Filter...'],
    ['gitBranchesPanel.clearFilter', 'Clear Filter'],
    ['gitBranchesPanel.toggleShowOnlyPinned', 'Toggle Show Only Pinned'],
    ['gitBranchesPanel.showNeedsAttention', 'Show Needs Attention'],
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
  ];

  for (const [commandId, title] of expectedCommands) {
    assert.equal(getCommand(commandId)?.title, title, `Command '${commandId}' should be contributed.`);
  }

  assert.equal(getCommand('gitBranchesPanel.findRef').icon, '$(search)');
  assert.equal(getCommand('gitBranchesPanel.openComparePage').icon, '$(link-external)');
  assert.equal(getCommand('gitBranchesPanel.addRemote').icon, '$(add)');
  assert.equal(getCommand('gitBranchesPanel.pruneWorktrees').icon, '$(clear-all)');
  assert.equal(getCommand('gitBranchesPanel.lockWorktree').icon, '$(lock)');
  assert.equal(getCommand('gitBranchesPanel.unlockWorktree').icon, '$(unlock)');
  assert.equal(getCommand('gitBranchesPanel.openWorktreeInTerminal').icon, '$(terminal)');

  const settings = packageJson.contributes.configuration.properties;
  assert.equal(settings['gitBranchesPanel.multiRepository.mode'].default, 'auto');
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

  assert.ok(
    hasViewTitleMenu(
      'gitBranchesPanel.selectRepository',
      (item) => item.when.includes('gitBranchesPanel.multipleRepositories')
    )
  );
  assert.ok(hasViewTitleMenu('gitBranchesPanel.findRef'));
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
