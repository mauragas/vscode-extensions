const assert = require('node:assert/strict');
const test = require('node:test');

const { buildBranchSections } = require('../out/branchModel.js');
const {
  buildBranchTooltipContent,
  buildStatusBarText,
  buildStatusBarTooltipContent,
  buildTreeItemPresentation,
  findContainerNode,
} = require('../out/treePresentation.js');

test('buildBranchTooltipContent describes local, remote, and tag items', () => {
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

  assert.match(localTooltip, /\*\*feature\/demo\*\*/);
  assert.match(localTooltip, /_Current branch_/);
  assert.match(localTooltip, /Last commit: 2 hours ago/);
  assert.match(localTooltip, /Upstream: origin\/feature\/demo/);
  assert.match(localTooltip, /Sync state: 2↓ 1↑/);
  assert.match(localTooltip, /> Ship it/);

  assert.match(remoteTooltip, /_Remote branch_/);
  assert.match(remoteTooltip, /Remote: origin/);
  assert.match(tagTooltip, /_Tag_/);
});

test('buildStatusBar helpers format sync state and guidance', () => {
  assert.equal(
    buildStatusBarText({
      name: 'main',
      isCurrent: true,
      behindCount: 2,
      aheadCount: 1,
    }),
    '$(git-branch) main 2↓ 1↑'
  );
  assert.equal(buildStatusBarText(undefined), '');

  const tooltip = buildStatusBarTooltipContent({
    name: 'main',
    isCurrent: true,
    upstreamName: 'origin/main',
    upstreamMissing: true,
  });

  assert.match(tooltip, /\*\*Current branch:\*\* main/);
  assert.match(tooltip, /Upstream: origin\/main/);
  assert.match(tooltip, /_Tracked upstream no longer exists_/);
  assert.match(tooltip, /Click to sync the current branch with its remote\./);
});

test('buildTreeItemPresentation maps sections, folders, and branch types consistently', () => {
  const sectionPresentation = buildTreeItemPresentation({
    kind: 'section',
    label: 'Remote',
    path: 'section:remote',
    children: [],
  });
  const folderPresentation = buildTreeItemPresentation({
    kind: 'folder',
    label: 'feature',
    path: 'feature',
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
      aheadCount: 1,
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

  assert.equal(sectionPresentation.nodeType, 'section');
  assert.equal(sectionPresentation.icon.id, 'cloud');
  assert.equal(sectionPresentation.collapsibleState, 'expanded');

  assert.equal(folderPresentation.nodeType, 'folder');
  assert.equal(folderPresentation.id, 'folder:feature');
  assert.equal(folderPresentation.icon.id, 'folder');

  assert.equal(localBranchPresentation.nodeType, 'branch');
  assert.equal(localBranchPresentation.id, 'local:branch:feature/demo');
  assert.equal(localBranchPresentation.description, '1↑ • 1 hour ago');
  assert.equal(localBranchPresentation.command.command, 'gitBranchesPanel.activateBranchItem');

  assert.equal(currentBranchPresentation.nodeType, 'currentBranch');
  assert.equal(currentBranchPresentation.label, '● main');
  assert.equal(currentBranchPresentation.command, undefined);
  assert.equal(currentBranchPresentation.icon.colorId, 'gitDecoration.addedResourceForeground');

  assert.equal(remoteBranchPresentation.nodeType, 'remoteBranch');
  assert.equal(remoteBranchPresentation.icon.id, 'cloud');
  assert.equal(remoteBranchPresentation.command, undefined);

  assert.equal(tagPresentation.nodeType, 'tag');
  assert.equal(tagPresentation.icon.id, 'tag');
  assert.equal(tagPresentation.command, undefined);
});

test('findContainerNode resolves section and nested folder paths', () => {
  const sections = buildBranchSections(
    [{ name: 'main', isCurrent: true }],
    [{ name: 'origin/feature/demo', isCurrent: false, scope: 'remote', remoteName: 'origin' }],
    [],
    true
  );

  const remoteSection = findContainerNode(sections, 'section:remote');
  const nestedFolder = findContainerNode(sections, 'origin/feature');

  assert.ok(remoteSection);
  assert.equal(remoteSection.label, 'Remote');
  assert.ok(nestedFolder);
  assert.equal(nestedFolder.label, 'feature');
  assert.equal(findContainerNode(sections, 'missing/path'), undefined);
});
