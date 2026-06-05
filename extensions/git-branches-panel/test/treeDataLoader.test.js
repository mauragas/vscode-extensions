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
    getWorktrees: 0,
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
      getWorktrees: async () => {
        calls.getWorktrees += 1;
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

test('BranchDataLoader lazily loads sections and throttles explicit remote fetches', async () => {
  let now = 10_000;
  const { dependencies, calls } = createDependencies();
  const loader = new BranchDataLoader(dependencies, () => now);

  await loader.refresh();

  assert.equal(calls.fetchRemoteState, 0);
  assert.equal(calls.getBranches, 1);
  assert.equal(calls.getRemoteBranches, 0);
  assert.equal(calls.getStashes, 0);
  assert.equal(calls.getWorktrees, 0);
  assert.equal(calls.getTags, 0);
  assert.equal(loader.getRepoRoot(), '/repo');
  assert.equal(loader.getCurrentBranch().name, 'main');
  assert.equal(loader.isSectionLoaded('local'), true);
  assert.equal(loader.isSectionLoaded('remote'), false);
  assert.deepEqual(loader.getTreeData().map((node) => node.label), [
    'Local',
    'Remote',
    'Stash',
    'Worktree',
    'Tags',
  ]);
  assert.ok(loader.getTreeData()[0].children.length > 0);
  assert.equal(loader.getTreeData()[1].children.length, 0);

  await loader.refresh({ sections: ['remote'] });
  assert.equal(calls.getRemoteBranches, 1);
  assert.equal(loader.isSectionLoaded('remote'), true);

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
  assert.equal(loader.isSectionLoaded('local'), true);
  assert.equal(loader.isSectionLoaded('remote'), false);
  assert.equal(loader.getTreeData().length, 5);
  assert.match(warnings[0], /network is grumpy/);
});

test('BranchDataLoader only refreshes explicitly requested lazy sections', async () => {
  const { dependencies, calls } = createDependencies({
    getStashes: async () => [
      {
        name: 'stash@{0}',
        isCurrent: false,
        scope: 'stash',
        lastCommit: 'WIP on main: stash support',
        lastCommitTimestamp: 30,
      },
    ],
    getWorktrees: async () => [
      {
        name: '/tmp/git-branches-panel-feature-worktree',
        isCurrent: false,
        scope: 'worktree',
        worktreePath: '/tmp/git-branches-panel-feature-worktree',
        worktreeRef: 'feature/worktree',
      },
    ],
    getTags: async () => [{ name: 'v1.0.0', isCurrent: false, scope: 'tag' }],
  });
  const loader = new BranchDataLoader(dependencies, () => 1_000);

  await loader.refresh({ sections: ['remote'], onlyIfLoaded: true });
  assert.equal(calls.getRemoteBranches, 0);

  await loader.refresh({ sections: ['stash', 'worktree', 'tags'], fetchRemoteState: false });

  assert.equal(loader.isSectionLoaded('stash'), true);
  assert.equal(loader.isSectionLoaded('worktree'), true);
  assert.equal(loader.isSectionLoaded('tags'), true);
  assert.equal(loader.isSectionLoaded('local'), false);

  const sections = loader.getTreeData();
  assert.equal(sections.find((node) => node.path === 'section:stash').children.length, 1);
  assert.equal(sections.find((node) => node.path === 'section:worktree').children.length, 1);
  assert.equal(sections.find((node) => node.path === 'section:tags').children.length, 1);
});

test('BranchDataLoader ignores stale section results after the repo root changes', async () => {
  let resolveRemoteBranches;
  const remoteBranchesPromise = new Promise((resolve) => {
    resolveRemoteBranches = resolve;
  });
  const repoRoots = ['/repo-a', '/repo-b'];
  const { dependencies } = createDependencies({
    getRepoRoot: async () => repoRoots.shift() ?? '/repo-b',
    getBranches: async (repoRoot) => [
      {
        name: repoRoot === '/repo-b' ? 'main-b' : 'main-a',
        isCurrent: true,
        lastCommitTimestamp: 20,
      },
    ],
    getRemoteBranches: async (repoRoot) => {
      if (repoRoot === '/repo-a') {
        return remoteBranchesPromise;
      }

      return [
        {
          name: 'origin/main-b',
          isCurrent: false,
          scope: 'remote',
          remoteName: 'origin',
          lastCommitTimestamp: 20,
        },
      ];
    },
  });
  const loader = new BranchDataLoader(dependencies);

  const staleRefresh = loader.refresh({ sections: ['remote'], fetchRemoteState: false });
  await Promise.resolve();

  await loader.refresh({ sections: ['local'], fetchRemoteState: false });

  resolveRemoteBranches([
    {
      name: 'origin/main-a',
      isCurrent: false,
      scope: 'remote',
      remoteName: 'origin',
      lastCommitTimestamp: 10,
    },
  ]);
  await staleRefresh;

  assert.equal(loader.getRepoRoot(), '/repo-b');
  assert.equal(loader.getCurrentBranch().name, 'main-b');
  assert.equal(loader.isSectionLoaded('local'), true);
  assert.equal(loader.isSectionLoaded('remote'), false);

  const remoteSection = loader.getTreeData().find((node) => node.path === 'section:remote');
  assert.ok(remoteSection);
  assert.equal(remoteSection.children.length, 0);
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
