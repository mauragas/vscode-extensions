const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildBranchDescription,
  buildBranchSections,
  buildBranchTree,
  findFolderNode,
  formatSyncStatus,
  parseUpstreamTrack,
  sortBranches,
} = require('../out/branchModel.js');

const sampleBranches = [
  {
    name: 'feature/auth',
    isCurrent: false,
    lastCommitDate: '2 days ago',
    lastCommitTimestamp: 200,
  },
  {
    name: 'feature/payments/stripe',
    isCurrent: false,
    lastCommitDate: '5 hours ago',
    lastCommitTimestamp: 500,
  },
  {
    name: 'main',
    isCurrent: true,
    lastCommitDate: '1 hour ago',
    lastCommitTimestamp: 1000,
  },
];

test('sortBranches keeps the current branch first for recent sorting', () => {
  const branches = [
    {
      name: 'feature/older-work',
      isCurrent: false,
      lastCommitTimestamp: 300,
    },
    {
      name: 'feature/newer-work',
      isCurrent: false,
      lastCommitTimestamp: 900,
    },
    {
      name: 'main',
      isCurrent: true,
      lastCommitTimestamp: 700,
    },
  ];

  const sorted = sortBranches(branches, 'recent');

  assert.deepEqual(sorted.map((branch) => branch.name), [
    'main',
    'feature/newer-work',
    'feature/older-work',
  ]);
});

test('buildBranchTree groups slash-separated branches into nested folders and keeps folders first', () => {
  const tree = buildBranchTree(sortBranches(sampleBranches, 'alphabetical'), true);

  assert.equal(tree[0]?.kind, 'folder');
  assert.equal(tree[0]?.kind === 'folder' ? tree[0].path : '', 'feature');
  assert.equal(tree[1]?.kind, 'branch');
  assert.equal(tree[1]?.kind === 'branch' ? tree[1].fullName : '', 'main');

  const featureFolder = findFolderNode(tree, 'feature');
  assert.ok(featureFolder);
  assert.equal(featureFolder.children[0]?.kind, 'folder');
  assert.equal(
    featureFolder.children[0]?.kind === 'folder' ? featureFolder.children[0].path : '',
    'feature/payments'
  );
  assert.equal(featureFolder.children[1]?.kind, 'branch');
  assert.equal(
    featureFolder.children[1]?.kind === 'branch' ? featureFolder.children[1].fullName : '',
    'feature/auth'
  );

  const paymentsFolder = findFolderNode(tree, 'feature/payments');
  assert.ok(paymentsFolder);
  assert.equal(paymentsFolder.children[0]?.kind, 'branch');
  assert.equal(
    paymentsFolder.children[0]?.kind === 'branch' ? paymentsFolder.children[0].fullName : '',
    'feature/payments/stripe'
  );
});

test('buildBranchSections shows local, remote, stash, worktree, and tag groups in order', () => {
  const localBranches = sortBranches(
    [
      { name: 'feature/auth', isCurrent: false },
      { name: 'main', isCurrent: true },
    ],
    'alphabetical'
  );
  const remoteBranches = sortBranches(
    [
      { name: 'origin/main', isCurrent: false, scope: 'remote', remoteName: 'origin' },
      {
        name: 'origin/feature/auth',
        isCurrent: false,
        scope: 'remote',
        remoteName: 'origin',
      },
      {
        name: 'upstream/release/1.0',
        isCurrent: false,
        scope: 'remote',
        remoteName: 'upstream',
      },
    ],
    'alphabetical'
  );
  const stashBranches = sortBranches(
    [
      {
        name: 'stash@{1}',
        isCurrent: false,
        scope: 'stash',
        lastCommit: 'Older stash',
        lastCommitTimestamp: 100,
      },
      {
        name: 'stash@{0}',
        isCurrent: false,
        scope: 'stash',
        lastCommit: 'Newest stash',
        lastCommitTimestamp: 200,
      },
    ],
    'alphabetical'
  );
  const worktreeBranches = sortBranches(
    [
      {
        name: '/tmp/git-branches-panel-feature-worktree',
        isCurrent: false,
        scope: 'worktree',
        worktreePath: '/tmp/git-branches-panel-feature-worktree',
        worktreeRef: 'feature/worktree',
      },
      {
        name: '/tmp/git-branches-panel-main-worktree',
        isCurrent: true,
        scope: 'worktree',
        worktreePath: '/tmp/git-branches-panel-main-worktree',
        worktreeRef: 'main',
      },
    ],
    'alphabetical'
  );
  const tagBranches = sortBranches(
    [
      { name: 'release/v1.0.0', isCurrent: false, scope: 'tag' },
      { name: 'v0.9.0', isCurrent: false, scope: 'tag' },
    ],
    'alphabetical'
  );

  const sections = buildBranchSections(
    localBranches,
    remoteBranches,
    stashBranches,
    worktreeBranches,
    tagBranches,
    true
  );

  assert.equal(sections.length, 5);
  assert.equal(sections[0]?.kind, 'section');
  assert.equal(sections[0]?.label, 'Local');
  assert.equal(sections[1]?.kind, 'section');
  assert.equal(sections[1]?.label, 'Remote');
  assert.equal(sections[2]?.kind, 'section');
  assert.equal(sections[2]?.label, 'Stash');
  assert.equal(sections[3]?.kind, 'section');
  assert.equal(sections[3]?.label, 'Worktree');
  assert.equal(sections[4]?.kind, 'section');
  assert.equal(sections[4]?.label, 'Tags');

  assert.deepEqual(
    sections[1].children.map((node) => (node.kind === 'folder' ? node.path : node.fullName)),
    ['origin', 'upstream']
  );

  const originFolder = findFolderNode(sections[1].children, 'origin');
  assert.ok(originFolder);
  assert.equal(originFolder.children[0]?.kind, 'folder');
  assert.equal(
    originFolder.children[0]?.kind === 'folder' ? originFolder.children[0].path : '',
    'origin/feature'
  );
  assert.equal(originFolder.children[1]?.kind, 'branch');
  assert.equal(
    originFolder.children[1]?.kind === 'branch' ? originFolder.children[1].fullName : '',
    'origin/main'
  );

  assert.deepEqual(
    sections[2].children.map((node) => (node.kind === 'folder' ? node.path : node.fullName)),
    ['stash@{0}', 'stash@{1}']
  );

  assert.deepEqual(
    sections[3].children.map((node) => (node.kind === 'folder' ? node.path : node.fullName)),
    ['/tmp/git-branches-panel-main-worktree', '/tmp/git-branches-panel-feature-worktree']
  );

  assert.deepEqual(
    sections[4].children.map((node) => (node.kind === 'folder' ? node.path : node.fullName)),
    ['release', 'v0.9.0']
  );
});

test('buildBranchSections omits empty local, remote, stash, worktree, or tag groups', () => {
  const localOnlySections = buildBranchSections(
    [{ name: 'main', isCurrent: true }],
    [],
    [],
    [],
    [],
    true
  );
  const remoteOnlySections = buildBranchSections(
    [],
    [{ name: 'origin/main', isCurrent: false, scope: 'remote', remoteName: 'origin' }],
    [],
    [],
    [],
    true
  );
  const stashOnlySections = buildBranchSections(
    [],
    [],
    [{ name: 'stash@{0}', isCurrent: false, scope: 'stash' }],
    [],
    [],
    true
  );
  const worktreeOnlySections = buildBranchSections(
    [],
    [],
    [],
    [{ name: '/tmp/git-branches-panel-main-worktree', isCurrent: true, scope: 'worktree' }],
    [],
    true
  );
  const tagOnlySections = buildBranchSections(
    [],
    [],
    [],
    [],
    [{ name: 'v1.0.0', isCurrent: false, scope: 'tag' }],
    true
  );

  assert.deepEqual(localOnlySections.map((section) => section.label), ['Local']);
  assert.deepEqual(remoteOnlySections.map((section) => section.label), ['Remote']);
  assert.deepEqual(stashOnlySections.map((section) => section.label), ['Stash']);
  assert.deepEqual(worktreeOnlySections.map((section) => section.label), ['Worktree']);
  assert.deepEqual(tagOnlySections.map((section) => section.label), ['Tags']);
});

test('buildBranchTree keeps sorted order when folder grouping is disabled', () => {
  const tree = buildBranchTree(sortBranches(sampleBranches, 'recent'), false);

  assert.deepEqual(
    tree.map((node) => (node.kind === 'branch' ? node.fullName : node.path)),
    ['main', 'feature/payments/stripe', 'feature/auth']
  );
});

test('buildBranchTree uses the final path segment for worktree labels on slash and backslash paths', () => {
  const tree = buildBranchTree(
    [
      {
        name: '/tmp/git-branches-panel/feature-worktree',
        isCurrent: false,
        scope: 'worktree',
      },
      {
        name: 'C:\\Users\\demo\\git-branches-panel\\windows-worktree',
        isCurrent: false,
        scope: 'worktree',
      },
    ],
    false
  );

  assert.deepEqual(
    tree.map((node) => (node.kind === 'branch' ? node.label : node.path)),
    ['feature-worktree', 'windows-worktree']
  );
});

test('findFolderNode resolves duplicate labels using the full folder path', () => {
  const tree = buildBranchTree(
    [
      { name: 'feature/foo/one', isCurrent: false },
      { name: 'release/foo/two', isCurrent: false },
    ],
    true
  );

  const featureFoo = findFolderNode(tree, 'feature/foo');
  const releaseFoo = findFolderNode(tree, 'release/foo');

  assert.ok(featureFoo);
  assert.ok(releaseFoo);
  assert.notStrictEqual(featureFoo, releaseFoo);
  assert.equal(featureFoo.label, 'foo');
  assert.equal(releaseFoo.label, 'foo');
  assert.equal(
    featureFoo.children[0]?.kind === 'branch' ? featureFoo.children[0].fullName : '',
    'feature/foo/one'
  );
  assert.equal(
    releaseFoo.children[0]?.kind === 'branch' ? releaseFoo.children[0].fullName : '',
    'release/foo/two'
  );
});

test('findFolderNode can traverse through section roots', () => {
  const sections = buildBranchSections(
    [{ name: 'main', isCurrent: true }],
    [{ name: 'origin/feature/auth', isCurrent: false, scope: 'remote', remoteName: 'origin' }],
    [],
    [],
    [],
    true
  );

  const remoteFeatureFolder = findFolderNode(sections, 'origin/feature');

  assert.ok(remoteFeatureFolder);
  assert.equal(remoteFeatureFolder.label, 'feature');
  assert.equal(
    remoteFeatureFolder.children[0]?.kind === 'branch'
      ? remoteFeatureFolder.children[0].fullName
      : '',
    'origin/feature/auth'
  );
});

test('parseUpstreamTrack extracts ahead and behind counts', () => {
  assert.deepEqual(parseUpstreamTrack('ahead 2, behind 3'), {
    aheadCount: 2,
    behindCount: 3,
    upstreamMissing: false,
  });

  assert.deepEqual(parseUpstreamTrack('behind 4'), {
    aheadCount: 0,
    behindCount: 4,
    upstreamMissing: false,
  });

  assert.deepEqual(parseUpstreamTrack('gone'), {
    aheadCount: 0,
    behindCount: 0,
    upstreamMissing: true,
  });
});

test('formatSyncStatus shows outgoing and incoming arrows only when needed', () => {
  assert.equal(formatSyncStatus({ aheadCount: 0, behindCount: 0 }), '');
  assert.equal(formatSyncStatus({ aheadCount: 2, behindCount: 0 }), '2↑');
  assert.equal(formatSyncStatus({ aheadCount: 0, behindCount: 5 }), '5↓');
  assert.equal(formatSyncStatus({ aheadCount: 2, behindCount: 5 }), '5↓ 2↑');
});

test('buildBranchDescription combines sync badges with commit timing', () => {
  assert.equal(
    buildBranchDescription({
      name: 'feature/payments',
      isCurrent: false,
      lastCommitDate: '3 hours ago',
      aheadCount: 1,
      behindCount: 2,
    }),
    '2↓ 1↑ • 3 hours ago'
  );

  assert.equal(
    buildBranchDescription({
      name: 'main',
      isCurrent: true,
      lastCommitDate: 'just now',
      aheadCount: 0,
      behindCount: 0,
    }),
    'just now'
  );

  assert.equal(
    buildBranchDescription({
      name: 'stash@{0}',
      isCurrent: false,
      scope: 'stash',
      lastCommit: 'WIP on main: add stash support',
      lastCommitDate: '5 minutes ago',
    }),
    'WIP on main: add stash support • 5 minutes ago'
  );

  assert.equal(
    buildBranchDescription({
      name: '/tmp/git-branches-panel-feature-worktree',
      isCurrent: false,
      scope: 'worktree',
      worktreeRef: 'feature/worktree',
      worktreeLockedReason: 'in use elsewhere',
    }),
    'feature/worktree • locked'
  );
});
