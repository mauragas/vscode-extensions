const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BranchDataLoader,
  REMOTE_FETCH_INTERVAL_MS,
  shouldRefreshRemoteState,
} = require('../out/treeDataLoader.js');

function createDependencies(overrides = {}) {
  const calls = {
    fetchRemoteState: 0,
    getBranches: 0,
    getRemoteBranches: 0,
    getStashes: 0,
    getTags: 0,
  };
  const warnings = [];

  return {
    calls,
    warnings,
    dependencies: {
      getWorkspaceFolderPaths: () => ['/workspace'],
      getConfiguration: () => ({
        groupByFolder: true,
        sortOrder: 'alphabetical',
      }),
      getRepoRoot: async () => '/repo',
      getBranches: async () => {
        calls.getBranches += 1;
        return [
          { name: 'feature/demo', isCurrent: false, lastCommitTimestamp: 10 },
          { name: 'main', isCurrent: true, lastCommitTimestamp: 20 },
        ];
      },
      getRemoteBranches: async () => {
        calls.getRemoteBranches += 1;
        return [
          {
            name: 'origin/main',
            isCurrent: false,
            scope: 'remote',
            remoteName: 'origin',
            lastCommitTimestamp: 20,
          },
        ];
      },
      getStashes: async () => {
        calls.getStashes += 1;
        return [];
      },
      getTags: async () => {
        calls.getTags += 1;
        return [];
      },
      fetchRemoteState: async () => {
        calls.fetchRemoteState += 1;
      },
      warn: (message) => {
        warnings.push(message);
      },
      ...overrides,
    },
  };
}

test('shouldRefreshRemoteState honors interval and force-refresh rules', () => {
  assert.equal(shouldRefreshRemoteState(0, 0), true);
  assert.equal(shouldRefreshRemoteState(1_000, 1_000), false);
  assert.equal(shouldRefreshRemoteState(1_000, 1_000 + REMOTE_FETCH_INTERVAL_MS - 1), false);
  assert.equal(shouldRefreshRemoteState(1_000, 1_000 + REMOTE_FETCH_INTERVAL_MS), true);
  assert.equal(shouldRefreshRemoteState(1_000, 1_001, true), true);
});

test('BranchDataLoader refreshes and throttles remote fetches', async () => {
  let now = 10_000;
  const { dependencies, calls } = createDependencies();
  const loader = new BranchDataLoader(dependencies, () => now);

  await loader.refresh({ fetchRemoteState: true });

  assert.equal(calls.fetchRemoteState, 1);
  assert.equal(calls.getStashes, 1);
  assert.equal(loader.getRepoRoot(), '/repo');
  assert.equal(loader.getCurrentBranch().name, 'main');
  assert.deepEqual(loader.getTreeData().map((node) => node.label), ['Local', 'Remote']);

  await loader.refresh({ fetchRemoteState: true });
  assert.equal(calls.fetchRemoteState, 1);

  now += REMOTE_FETCH_INTERVAL_MS;
  await loader.refresh({ fetchRemoteState: true });
  assert.equal(calls.fetchRemoteState, 2);

  await loader.refresh({ fetchRemoteState: true, forceFetchRemoteState: true });
  assert.equal(calls.fetchRemoteState, 3);
});

test('BranchDataLoader warns on refresh failures and still loads branch data', async () => {
  const { dependencies, warnings } = createDependencies({
    fetchRemoteState: async () => {
      throw new Error('network is grumpy');
    },
  });
  const loader = new BranchDataLoader(dependencies, () => 1_000);

  await loader.refresh({ fetchRemoteState: true });

  assert.equal(loader.getCurrentBranch().name, 'main');
  assert.equal(loader.getTreeData().length, 2);
  assert.match(warnings[0], /network is grumpy/);
});

test('BranchDataLoader inserts stash section between remote and tags', async () => {
  const { dependencies } = createDependencies({
    getStashes: async () => [
      {
        name: 'stash@{0}',
        isCurrent: false,
        scope: 'stash',
        lastCommit: 'WIP on main: stash support',
        lastCommitTimestamp: 30,
      },
    ],
    getTags: async () => [{ name: 'v1.0.0', isCurrent: false, scope: 'tag' }],
  });
  const loader = new BranchDataLoader(dependencies, () => 1_000);

  await loader.refresh({ fetchRemoteState: false });

  assert.deepEqual(loader.getTreeData().map((node) => node.label), ['Local', 'Remote', 'Stash', 'Tags']);
});

test('BranchDataLoader clears data when no workspace folders are available', async () => {
  const { dependencies } = createDependencies({
    getWorkspaceFolderPaths: () => [],
  });
  const loader = new BranchDataLoader(dependencies);

  await loader.refresh({ fetchRemoteState: true });

  assert.equal(loader.getRepoRoot(), null);
  assert.deepEqual(loader.getTreeData(), []);
  assert.equal(loader.getCurrentBranch(), undefined);
});
