const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildBranchDescription,
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

test('buildBranchTree groups slash-separated branches into nested folders', () => {
  const tree = buildBranchTree(sortBranches(sampleBranches, 'alphabetical'), true);

  assert.equal(tree[0]?.kind, 'branch');
  assert.equal(tree[0]?.kind === 'branch' ? tree[0].fullName : '', 'main');

  const featureFolder = findFolderNode(tree, 'feature');
  assert.ok(featureFolder);
  assert.equal(featureFolder.children[0]?.kind, 'branch');
  assert.equal(
    featureFolder.children[0]?.kind === 'branch' ? featureFolder.children[0].fullName : '',
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
});
