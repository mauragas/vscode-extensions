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
    getRemoteDetails: 0,
    getStashes: 0,
    getWorktrees: 0,
    getHooks: 0,
    getTags: 0,
  };
  const warnings = [];

  return {
    calls,
    warnings,
    dependencies: {
      getWorkspaceRepositories: async () => [
        {
          repoRoot: '/repo',
          label: 'repo',
        },
      ],
      getConfiguration: () => ({
        groupByFolder: true,
        sortOrder: 'alphabetical',
        tagSortOrder: 'versionDescending',
        multiRepositoryMode: 'auto',
        sectionVisibility: {
          local: true,
          remote: true,
          remotes: true,
          stash: true,
          worktree: true,
          hooks: true,
          tags: true,
        },
      }),
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
      getRemoteDetails: async () => {
        calls.getRemoteDetails += 1;
        return [
          {
            name: 'origin',
            fetchUrl: 'https://github.com/octo/repo.git',
            pushUrl: 'https://github.com/octo/repo.git',
            isDefault: true,
            hostProvider: 'GitHub',
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
      getHooks: async () => {
        calls.getHooks += 1;
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
  assert.equal(calls.getRemoteDetails, 0);
  assert.equal(calls.getStashes, 0);
  assert.equal(calls.getWorktrees, 0);
  assert.equal(calls.getHooks, 1);
  assert.equal(calls.getTags, 0);
  assert.equal(loader.getRepoRoot(), '/repo');
  assert.equal(loader.getCurrentBranch().name, 'main');
  assert.equal(loader.isSectionLoaded('local'), true);
  assert.equal(loader.isSectionLoaded('hooks'), true);
  assert.equal(loader.isSectionLoaded('remote'), false);
  assert.deepEqual(loader.getTreeData().map((node) => node.label), [
    'Local',
    'Remote',
    'Remotes',
    'Stash',
    'Worktree',
    'Tags',
  ]);
  assert.ok(loader.getTreeData()[0].children.length > 0);
  assert.equal(loader.getTreeData()[1].children.length, 0);
  assert.equal(loader.getTreeData()[2].children.length, 0);

  await loader.refresh({ sections: ['remote'] });
  assert.equal(calls.getRemoteBranches, 1);
  assert.equal(loader.isSectionLoaded('remote'), true);

  await loader.refresh({ sections: ['remotes'] });
  assert.equal(calls.getRemoteDetails, 1);
  assert.equal(loader.isSectionLoaded('remotes'), true);

  await loader.refresh({ fetchRemoteState: true });
  assert.equal(calls.fetchRemoteState, 1);

  now += REMOTE_FETCH_INTERVAL_MS;
  await loader.refresh({ fetchRemoteState: true });
  assert.equal(calls.fetchRemoteState, 2);

  await loader.refresh({ fetchRemoteState: true, forceFetchRemoteState: true });
  assert.equal(calls.fetchRemoteState, 3);
});

test('BranchDataLoader groups repositories when multiple repositories are available', async () => {
  const { dependencies } = createDependencies({
    getWorkspaceRepositories: async () => [
      {
        repoRoot: '/repo-a',
        label: 'repo-a',
        description: 'apps/repo-a',
      },
      {
        repoRoot: '/repo-b',
        label: 'repo-b',
        description: 'apps/repo-b',
      },
    ],
    getBranches: async (repoRoot) => [
      {
        name: repoRoot === '/repo-b' ? 'main-b' : 'main-a',
        isCurrent: true,
        lastCommitTimestamp: repoRoot === '/repo-b' ? 20 : 10,
      },
    ],
    getRemoteDetails: async (repoRoot) => [
      {
        name: repoRoot === '/repo-b' ? 'upstream' : 'origin',
        fetchUrl: `https://example.com/${repoRoot === '/repo-b' ? 'repo-b' : 'repo-a'}.git`,
        pushUrl: `https://example.com/${repoRoot === '/repo-b' ? 'repo-b' : 'repo-a'}.git`,
      },
    ],
  });
  const loader = new BranchDataLoader(dependencies, () => 1_000);

  await loader.refresh();

  assert.equal(loader.getRepoRoot(), null);
  assert.deepEqual(loader.getRepoRoots(), ['/repo-a', '/repo-b']);

  const groupedTree = loader.getTreeData({
    multiRepositoryMode: 'auto',
    activeRepoRoot: '/repo-b',
  });

  assert.equal(groupedTree.length, 2);
  assert.equal(groupedTree[0].kind, 'repository');
  assert.equal(groupedTree[0].label, 'repo-a');
  assert.equal(groupedTree[1].kind, 'repository');
  assert.equal(groupedTree[1].label, 'repo-b');
  assert.equal(groupedTree[1].isActive, true);
  assert.deepEqual(groupedTree[0].children.map((child) => child.label), [
    'Local',
    'Remote',
    'Remotes',
    'Stash',
    'Worktree',
    'Tags',
  ]);

  const singleRepositoryTree = loader.getTreeData({
    multiRepositoryMode: 'singleActiveRepository',
    activeRepoRoot: '/repo-b',
  });

  assert.deepEqual(singleRepositoryTree.map((node) => node.label), [
    'Local',
    'Remote',
    'Remotes',
    'Stash',
    'Worktree',
    'Tags',
  ]);
  assert.equal(loader.getCurrentBranch('/repo-a').name, 'main-a');
  assert.equal(loader.getCurrentBranch('/repo-b').name, 'main-b');
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
  assert.equal(loader.getTreeData().length, 6);
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
    getRemoteDetails: async () => [
      {
        name: 'origin',
        fetchUrl: 'https://github.com/octo/repo.git',
        pushUrl: 'https://github.com/octo/repo.git',
      },
    ],
  });
  const loader = new BranchDataLoader(dependencies, () => 1_000);

  await loader.refresh({ sections: ['remote'], onlyIfLoaded: true });
  assert.equal(calls.getRemoteBranches, 0);

  await loader.refresh({ sections: ['stash', 'worktree', 'tags', 'remotes'], fetchRemoteState: false });

  assert.equal(loader.isSectionLoaded('stash'), true);
  assert.equal(loader.isSectionLoaded('worktree'), true);
  assert.equal(loader.isSectionLoaded('tags'), true);
  assert.equal(loader.isSectionLoaded('remotes'), true);
  assert.equal(loader.isSectionLoaded('local'), false);
  assert.equal(calls.getHooks, 0);

  const sections = loader.getTreeData();
  assert.equal(sections.find((node) => node.path === 'section:remotes').children.length, 1);
  assert.equal(sections.find((node) => node.path === 'section:stash').children.length, 1);
  assert.equal(sections.find((node) => node.path === 'section:worktree').children.length, 1);
  assert.equal(sections.find((node) => node.path === 'section:tags').children.length, 1);
});

test('BranchDataLoader shows the Hooks section only when configured hooks exist', async () => {
  const { dependencies, calls } = createDependencies({
    getHooks: async () => {
      calls.getHooks += 1;
      return [
        {
          name: 'pre-commit · shared',
          isCurrent: false,
          scope: 'hook',
          hookName: 'pre-commit',
          hookSource: 'shared',
          hookEnabled: true,
          hookActive: true,
        },
      ];
    },
  });
  const loader = new BranchDataLoader(dependencies, () => 1_000);

  await loader.refresh();

  const hooksSection = loader.getTreeData().find((node) => node.path === 'section:hooks');

  assert.equal(calls.getHooks, 1);
  assert.equal(loader.isSectionLoaded('hooks'), true);
  assert.ok(hooksSection);
  assert.equal(hooksSection.children.length, 1);
  assert.equal(hooksSection.children[0].kind, 'branch');
  assert.equal(hooksSection.children[0].fullName, 'pre-commit · shared');
});

test('BranchDataLoader applies tagSortOrder independently from branch sortOrder', async () => {
  const { dependencies } = createDependencies({
    getConfiguration: () => ({
      groupByFolder: false,
      sortOrder: 'alphabetical',
      tagSortOrder: 'versionDescending',
      multiRepositoryMode: 'auto',
      sectionVisibility: {
        local: true,
        remote: true,
        remotes: true,
        stash: true,
        worktree: true,
        hooks: true,
        tags: true,
      },
    }),
    getTags: async () => [
      { name: 'v1.2.0', isCurrent: false, scope: 'tag' },
      { name: 'v1.10.0', isCurrent: false, scope: 'tag' },
      { name: 'latest', isCurrent: false, scope: 'tag' },
    ],
  });
  const loader = new BranchDataLoader(dependencies, () => 1_000);

  await loader.refresh({ sections: ['tags'], fetchRemoteState: false });

  const tagSection = loader.getTreeData().find((node) => node.path === 'section:tags');
  assert.ok(tagSection);
  assert.deepEqual(
    tagSection.children.map((node) => (node.kind === 'branch' ? node.fullName : node.path)),
    ['v1.10.0', 'v1.2.0', 'latest']
  );
});

test('BranchDataLoader decorates branches before sorting and tree building', async () => {
  const { dependencies } = createDependencies({
    decorateBranchInfo: (_repoRoot, branch) =>
      branch.name === 'feature/demo'
        ? {
            ...branch,
            isPinned: true,
          }
        : branch,
  });
  const loader = new BranchDataLoader(dependencies, () => 1_000);

  await loader.refresh({ sections: ['local'], fetchRemoteState: false });

  const localSection = loader.getTreeData().find((node) => node.path === 'section:local');
  assert.ok(localSection);
  assert.equal(localSection.children[0].kind, 'branch');
  assert.equal(localSection.children[0].fullName, 'feature/demo');
});

test('BranchDataLoader ignores stale section results after the repo root changes', async () => {
  let resolveRemoteBranches;
  const remoteBranchesPromise = new Promise((resolve) => {
    resolveRemoteBranches = resolve;
  });
  const repositorySets = [
    [
      {
        repoRoot: '/repo-a',
        label: 'repo-a',
      },
    ],
    [
      {
        repoRoot: '/repo-b',
        label: 'repo-b',
      },
    ],
  ];
  const { dependencies } = createDependencies({
    getWorkspaceRepositories: async () => repositorySets.shift() ?? repositorySets[repositorySets.length - 1] ?? [],
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

test('BranchDataLoader loads remote configuration items into the Remotes section', async () => {
  const { dependencies } = createDependencies({
    getRemoteDetails: async () => [
      {
        name: 'origin',
        fetchUrl: 'https://github.com/octo/repo.git',
        pushUrl: 'git@github.com:octo/repo.git',
        isDefault: true,
        hostProvider: 'GitHub',
      },
      {
        name: 'upstream',
        fetchUrl: 'https://gitlab.com/org/repo.git',
        pushUrl: 'https://gitlab.com/org/repo.git',
        hostProvider: 'GitLab',
      },
    ],
  });
  const loader = new BranchDataLoader(dependencies, () => 1_000);

  await loader.refresh({ sections: ['remotes'], fetchRemoteState: false });

  const remotesSection = loader.getTreeData().find((node) => node.path === 'section:remotes');
  assert.ok(remotesSection);
  assert.equal(remotesSection.children.length, 2);
  assert.equal(remotesSection.children[0].kind, 'remote');
  assert.equal(remotesSection.children[0].info.name, 'origin');
  assert.equal(remotesSection.children[0].info.isDefault, true);
  assert.equal(remotesSection.children[1].info.hostProvider, 'GitLab');
});

test('BranchDataLoader clears data when no workspace folders are available', async () => {
  const { dependencies } = createDependencies({
    getWorkspaceRepositories: async () => [],
  });
  const loader = new BranchDataLoader(dependencies);

  await loader.refresh({ fetchRemoteState: true });

  assert.equal(loader.getRepoRoot(), null);
  assert.deepEqual(loader.getTreeData(), []);
  assert.equal(loader.getCurrentBranch(), undefined);
});

test('BranchDataLoader omits sections hidden by settings even when they are loaded', async () => {
  const { dependencies } = createDependencies({
    getConfiguration: () => ({
      groupByFolder: false,
      sortOrder: 'alphabetical',
      tagSortOrder: 'versionDescending',
      multiRepositoryMode: 'auto',
      sectionVisibility: {
        local: true,
        remote: false,
        remotes: false,
        stash: false,
        worktree: false,
        hooks: false,
        tags: true,
      },
    }),
    getTags: async () => [{ name: 'v2.0.0', isCurrent: false, scope: 'tag' }],
    getRemoteDetails: async () => [
      {
        name: 'origin',
        fetchUrl: 'https://github.com/octo/repo.git',
        pushUrl: 'https://github.com/octo/repo.git',
      },
    ],
  });
  const loader = new BranchDataLoader(dependencies, () => 1_000);

  await loader.refresh({ sections: ['local', 'tags', 'remotes'], fetchRemoteState: false });

  assert.equal(loader.isSectionLoaded('remotes'), true);
  assert.deepEqual(loader.getTreeData().map((node) => node.label), ['Local', 'Tags']);
});
