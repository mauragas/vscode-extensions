const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

function loadFresh(modulePath, mocks) {
  const originalLoad = Module._load;
  const resolvedModulePath = require.resolve(modulePath);
  delete require.cache[resolvedModulePath];

  Module._load = function mockLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require(modulePath);
  } finally {
    Module._load = originalLoad;
  }
}

function createEventEmitter() {
  return class EventEmitter {
    constructor() {
      this.listeners = [];
      this.event = (listener) => {
        this.listeners.push(listener);
        return { dispose() {} };
      };
    }

    fire(value) {
      for (const listener of this.listeners) {
        listener(value);
      }
    }
  };
}

function createVscodeMock(commandCalls) {
  return {
    EventEmitter: createEventEmitter(),
    commands: {
      async executeCommand(command, ...args) {
        commandCalls.push({ command, args });
        return undefined;
      },
    },
    workspace: {
      getConfiguration: (section) => {
        assert.equal(section, 'gitBranchesPanel');

        return {
          get: (_key, defaultValue) => defaultValue,
        };
      },
    },
  };
}

function createTreeItemMock() {
  return {
    BranchTreeItem: class BranchTreeItem {
      constructor(node) {
        this.nodeType =
          node.kind === 'branch' ? (node.info?.scope === 'hook' ? 'hook' : 'branch') : node.kind;
        this.containerKey =
          node.kind === 'branch'
            ? undefined
            : getContainerKey(node);
        this.containerPath = node.kind === 'branch' ? undefined : node.path;
        this.containerScope = node.kind === 'branch' ? undefined : node.scope;
        this.branchName = node.kind === 'branch' ? node.fullName : undefined;
        this.repoRoot = node.repoRoot;
      }
    },
  };
}

function getContainerKey(node) {
  if (node.kind === 'repository') {
    return node.path;
  }

  if (node.kind === 'section') {
    return node.repoRoot ? `repo:${node.repoRoot}:${node.path}` : node.path;
  }

  return node.repoRoot
    ? `repo:${node.repoRoot}:folder:${node.scope ?? 'local'}:${node.path}`
    : `folder:${node.scope ?? 'local'}:${node.path}`;
}

function findContainerNode(nodes, containerKey) {
  for (const node of nodes) {
    if (node.kind === 'branch') {
      continue;
    }

    if (getContainerKey(node) === containerKey) {
      return node;
    }

    const nestedMatch = findContainerNode(node.children, containerKey);
    if (nestedMatch) {
      return nestedMatch;
    }
  }

  return undefined;
}

function findDescendantBranches(nodes, containerKey) {
  const container = findContainerNode(nodes, containerKey);
  if (!container) {
    return [];
  }

  const descendants = [];
  for (const child of container.children) {
    if (child.kind === 'branch') {
      descendants.push(child);
      continue;
    }

    descendants.push(...findDescendantBranches([child], getContainerKey(child)));
  }

  return descendants;
}

function createDataLoader(state) {
  return {
    refreshCalls: [],
    async refresh(options = {}) {
      this.refreshCalls.push(options);
      if (typeof state.onRefresh === 'function') {
        await state.onRefresh(options);
      }
    },
    getCurrentBranch() {
      return state.currentBranch;
    },
    getTreeData() {
      return state.treeData;
    },
    getRepoRoots() {
      return state.repoRoots ?? (state.repoRoot ? [state.repoRoot] : []);
    },
    getRepositoryDescriptors() {
      return (
        state.repositoryDescriptors ??
        (state.repoRoot
          ? [
              {
                repoRoot: state.repoRoot,
                label: 'repo',
              },
            ]
          : [])
      );
    },
    hasRepository(repoRoot) {
      return (state.repoRoots ?? (state.repoRoot ? [state.repoRoot] : [])).includes(repoRoot);
    },
    getRepoRoot() {
      return state.repoRoot;
    },
    isSectionLoaded(section, repoRoot) {
      if (repoRoot && state.loadedSectionsByRepo?.get(repoRoot)) {
        return Boolean(state.loadedSectionsByRepo.get(repoRoot)?.has(section));
      }

      return Boolean(state.loadedSections?.has(section));
    },
  };
}

test('activate orchestrates provider, views, commands, and auto-refresh wiring', async () => {
  const calls = {
    trackers: 0,
    branchContextMenus: [],
    providerContexts: [],
    views: [],
    commands: [],
    autoRefresh: [],
    refreshes: [],
  };

  class MockTracker {
    constructor() {
      calls.trackers += 1;
    }
  }

  class MockProvider {
    constructor(context) {
      calls.providerContexts.push(context);
    }

    refresh(options) {
      calls.refreshes.push(options);
      return Promise.resolve();
    }
  }

  const { activate, deactivate } = loadFresh('../out/extension.js', {
    vscode: {},
    './autoRefresh': {
      registerAutoRefresh: (...args) => {
        calls.autoRefresh.push(args);
      },
    },
    './branchContextMenu': {
      registerBranchContextMenuContextKeys: (...args) => {
        calls.branchContextMenus.push(args);
      },
    },
    './extensionCommands': {
      registerBranchCommands: (...args) => {
        calls.commands.push(args);
      },
    },
    './extensionHelpers': {
      BranchItemActivationTracker: MockTracker,
    },
    './treeProvider': {
      BranchTreeProvider: MockProvider,
    },
    './viewRegistration': {
      registerBranchViews: (...args) => {
        calls.views.push(args);
      },
    },
  });

  const context = { subscriptions: [] };

  activate(context);
  deactivate();
  await Promise.resolve();

  assert.equal(calls.trackers, 1);
  assert.equal(calls.branchContextMenus.length, 1);
  assert.equal(calls.providerContexts.length, 1);
  assert.equal(calls.views.length, 1);
  assert.equal(calls.commands.length, 1);
  assert.equal(calls.autoRefresh.length, 1);
  assert.deepEqual(calls.refreshes, []);
  assert.equal(calls.branchContextMenus[0][0], context);
  assert.equal(calls.views[0][0], context);
  assert.equal(calls.commands[0][0], context);
  assert.equal(calls.autoRefresh[0][0], context);
  assert.equal(calls.commands[0][1], calls.views[0][1]);
  assert.equal(calls.autoRefresh[0][1], calls.views[0][1]);
  assert.equal(calls.commands[0][2], calls.autoRefresh[0][2]);
});

test('BranchTreeProvider refreshes current branch context and exposes tree items', async () => {
  const commandCalls = [];
  const state = {
    currentBranch: {
      name: 'main',
      isCurrent: true,
      upstreamName: 'origin/main',
    },
    treeData: [
      {
        kind: 'section',
        label: 'Local',
        path: 'section:local',
        scope: 'local',
        repoRoot: '/repo',
        children: [],
      },
    ],
    repoRoot: '/repo',
    loadedSections: new Set(['local']),
  };
  const dataLoader = createDataLoader(state);
  const { BranchTreeProvider } = loadFresh('../out/treeProvider.js', {
    vscode: createVscodeMock(commandCalls),
    './git': {
      fetchRemoteState() {},
      getBranches() {},
      getHooks() {},
      getRemoteBranches() {},
      getRepoRoot() {},
      getStashes() {},
      getWorktrees() {},
      getTags() {},
    },
    './gitApi': {
      getWorkspaceRepositories: async () => [],
      resolveRepoRootForUri: async () => undefined,
    },
    './treeDataLoader': {
      BranchDataLoader: class BranchDataLoader {},
      getBranchSectionKey: (sectionPath) =>
        sectionPath === 'section:local' ? 'local' : undefined,
    },
    './treeItem': createTreeItemMock(),
    './treePresentation': {
      findContainerNode,
      findDescendantBranches,
    },
  });

  const context = { subscriptions: [] };
  const provider = new BranchTreeProvider(context, dataLoader);
  let treeChangeCount = 0;
  provider.onDidChangeTreeData(() => {
    treeChangeCount += 1;
  });

  await provider.refresh({ fetchRemoteState: true });

  assert.deepEqual(dataLoader.refreshCalls, [{ fetchRemoteState: true }]);
  assert.equal(provider.getRepoRoot(), '/repo');
  assert.equal(provider.getCurrentBranch().name, 'main');
  assert.ok(
    commandCalls.some(
      (call) =>
        call.command === 'setContext' &&
        call.args[0] === 'gitBranchesPanel.multipleRepositories' &&
        call.args[1] === false
    )
  );
  assert.ok(
    commandCalls.some(
      (call) =>
        call.command === 'setContext' &&
        call.args[0] === 'gitBranchesPanel.groupedRepositories' &&
        call.args[1] === false
    )
  );
  assert.ok(
    commandCalls.some(
      (call) =>
        call.command === 'setContext' &&
        call.args[0] === 'gitBranchesPanel.currentBranchNeedsPublish' &&
        call.args[1] === false
    )
  );
  assert.ok(
    commandCalls.some(
      (call) =>
        call.command === 'setContext' &&
        call.args[0] === 'gitBranchesPanel.currentBranchBusy' &&
        call.args[1] === false
    )
  );
  assert.equal(treeChangeCount, 1);

  const rootChildren = await provider.getChildren();
  assert.equal(rootChildren.length, 1);
  assert.equal(rootChildren[0].containerPath, 'section:local');
  assert.equal(rootChildren[0].containerKey, 'repo:/repo:section:local');
  assert.equal(provider.getTreeItem(rootChildren[0]), rootChildren[0]);
});

test('BranchTreeProvider marks publishable current branches in context', async () => {
  const commandCalls = [];
  const state = {
    currentBranch: {
      name: 'feature/offline',
      isCurrent: true,
    },
    treeData: [
      {
        kind: 'section',
        label: 'Local',
        path: 'section:local',
        scope: 'local',
        repoRoot: '/repo',
        children: [],
      },
    ],
    repoRoot: '/repo',
    loadedSections: new Set(['local']),
  };
  const dataLoader = createDataLoader(state);
  const { BranchTreeProvider } = loadFresh('../out/treeProvider.js', {
    vscode: createVscodeMock(commandCalls),
    './git': {
      fetchRemoteState() {},
      getBranches() {},
      getHooks() {},
      getRemoteBranches() {},
      getRepoRoot() {},
      getStashes() {},
      getWorktrees() {},
      getTags() {},
    },
    './gitApi': {
      getWorkspaceRepositories: async () => [],
      resolveRepoRootForUri: async () => undefined,
    },
    './treeDataLoader': {
      BranchDataLoader: class BranchDataLoader {},
      getBranchSectionKey: (sectionPath) =>
        sectionPath === 'section:local' ? 'local' : undefined,
    },
    './treeItem': createTreeItemMock(),
    './treePresentation': {
      findContainerNode,
      findDescendantBranches,
    },
  });

  const provider = new BranchTreeProvider({ subscriptions: [] }, dataLoader);

  await provider.refresh({ fetchRemoteState: false });

  assert.ok(
    commandCalls.some(
      (call) =>
        call.command === 'setContext' &&
        call.args[0] === 'gitBranchesPanel.currentBranchNeedsPublish' &&
        call.args[1] === true
    )
  );
  assert.ok(
    commandCalls.some(
      (call) =>
        call.command === 'setContext' &&
        call.args[0] === 'gitBranchesPanel.currentBranchBusy' &&
        call.args[1] === false
    )
  );
});

test('BranchTreeProvider marks busy current branches in context', async () => {
  const commandCalls = [];
  const state = {
    currentBranch: {
      name: 'main',
      isCurrent: true,
      upstreamName: 'origin/main',
      isSyncing: true,
    },
    treeData: [
      {
        kind: 'section',
        label: 'Local',
        path: 'section:local',
        scope: 'local',
        repoRoot: '/repo',
        children: [],
      },
    ],
    repoRoot: '/repo',
    loadedSections: new Set(['local']),
  };
  const dataLoader = createDataLoader(state);
  const { BranchTreeProvider } = loadFresh('../out/treeProvider.js', {
    vscode: createVscodeMock(commandCalls),
    './git': {
      fetchRemoteState() {},
      getBranches() {},
      getHooks() {},
      getRemoteBranches() {},
      getRepoRoot() {},
      getStashes() {},
      getWorktrees() {},
      getTags() {},
    },
    './gitApi': {
      getWorkspaceRepositories: async () => [],
      resolveRepoRootForUri: async () => undefined,
    },
    './treeDataLoader': {
      BranchDataLoader: class BranchDataLoader {},
      getBranchSectionKey: (sectionPath) =>
        sectionPath === 'section:local' ? 'local' : undefined,
    },
    './treeItem': createTreeItemMock(),
    './treePresentation': {
      findContainerNode,
      findDescendantBranches,
    },
  });

  const provider = new BranchTreeProvider({ subscriptions: [] }, dataLoader);

  await provider.refresh({ fetchRemoteState: false });

  assert.ok(
    commandCalls.some(
      (call) =>
        call.command === 'setContext' &&
        call.args[0] === 'gitBranchesPanel.currentBranchNeedsPublish' &&
        call.args[1] === false
    )
  );
  assert.ok(
    commandCalls.some(
      (call) =>
        call.command === 'setContext' &&
        call.args[0] === 'gitBranchesPanel.currentBranchBusy' &&
        call.args[1] === true
    )
  );
});

test('BranchTreeProvider loads nested container children and clears branch context when no branch is active', async () => {
  const commandCalls = [];
  const state = {
    currentBranch: undefined,
    treeData: [],
    repoRoot: '/repo',
    loadedSections: new Set(),
    onRefresh(options) {
      const sections = options.sections ?? ['local', 'hooks'];

      for (const section of sections) {
        state.loadedSections.add(section);
      }

      state.treeData = [
        {
          kind: 'section',
          label: 'Local',
          path: 'section:local',
          scope: 'local',
          repoRoot: '/repo',
          children: state.loadedSections.has('local')
            ? [
                {
                  kind: 'folder',
                  label: 'feature',
                  path: 'feature',
                  scope: 'local',
                  repoRoot: '/repo',
                  children: [
                    {
                      kind: 'branch',
                      fullName: 'feature/demo',
                      label: 'demo',
                      path: 'feature/demo',
                      repoRoot: '/repo',
                      info: {
                        name: 'feature/demo',
                        isCurrent: false,
                      },
                    },
                  ],
                },
              ]
            : [],
        },
        {
          kind: 'section',
          label: 'Remote',
          path: 'section:remote',
          scope: 'remote',
          repoRoot: '/repo',
          children: state.loadedSections.has('remote')
            ? [
                {
                  kind: 'branch',
                  fullName: 'origin/main',
                  label: 'main',
                  path: 'origin/main',
                  repoRoot: '/repo',
                  info: {
                    name: 'origin/main',
                    isCurrent: false,
                    scope: 'remote',
                  },
                },
              ]
            : [],
        },
      ];
    },
  };
  const dataLoader = createDataLoader(state);
  const { BranchTreeProvider } = loadFresh('../out/treeProvider.js', {
    vscode: createVscodeMock(commandCalls),
    './git': {
      fetchRemoteState() {},
      getBranches() {},
      getHooks() {},
      getRemoteBranches() {},
      getRepoRoot() {},
      getStashes() {},
      getWorktrees() {},
      getTags() {},
    },
    './gitApi': {
      getWorkspaceRepositories: async () => [],
      resolveRepoRootForUri: async () => undefined,
    },
    './treeDataLoader': {
      BranchDataLoader: class BranchDataLoader {},
      getBranchSectionKey: (sectionPath) => {
        if (sectionPath === 'section:local') {
          return 'local';
        }

        if (sectionPath === 'section:remote') {
          return 'remote';
        }

        return undefined;
      },
    },
    './treeItem': createTreeItemMock(),
    './treePresentation': {
      findContainerNode,
      findDescendantBranches,
    },
  });

  const provider = new BranchTreeProvider({ subscriptions: [] }, dataLoader);

  const rootChildren = await provider.getChildren();
  const folderChildren = await provider.getChildren(rootChildren[0]);
  const branchChildren = await provider.getChildren(folderChildren[0]);
  const remoteChildren = await provider.getChildren(rootChildren[1]);
  const descendantBranches = provider.getDescendantBranches('repo:/repo:folder:local:feature');

  assert.deepEqual(dataLoader.refreshCalls, [
    { fetchRemoteState: false },
    { sections: ['remote'], repoRoots: ['/repo'], fetchRemoteState: false },
  ]);
  assert.equal(rootChildren.length, 2);
  assert.equal(rootChildren[0].containerPath, 'section:local');
  assert.equal(folderChildren[0].containerKey, 'repo:/repo:folder:local:feature');
  assert.equal(folderChildren[0].containerPath, 'feature');
  assert.equal(branchChildren[0].branchName, 'feature/demo');
  assert.equal(remoteChildren[0].branchName, 'origin/main');
  assert.deepEqual(descendantBranches.map((branch) => branch.fullName), ['feature/demo']);

  await provider.refresh();

  assert.deepEqual(commandCalls.at(-2), {
    command: 'setContext',
    args: ['gitBranchesPanel.currentBranchNeedsPublish', false],
  });
  assert.deepEqual(commandCalls.at(-1), {
    command: 'setContext',
    args: ['gitBranchesPanel.currentBranchBusy', false],
  });
});

test('BranchTreeProvider resolves parent items for grouped repositories and nested branches', async () => {
  const commandCalls = [];
  const state = {
    treeData: [
      {
        kind: 'repository',
        label: 'repo-a',
        path: 'repo:/repo-a',
        repoRoot: '/repo-a',
        children: [
          {
            kind: 'section',
            label: 'Local',
            path: 'section:local',
            scope: 'local',
            repoRoot: '/repo-a',
            children: [
              {
                kind: 'folder',
                label: 'feature',
                path: 'feature',
                scope: 'local',
                repoRoot: '/repo-a',
                children: [
                  {
                    kind: 'branch',
                    fullName: 'feature/demo',
                    label: 'demo',
                    path: 'feature/demo',
                    repoRoot: '/repo-a',
                    info: {
                      name: 'feature/demo',
                      isCurrent: false,
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        kind: 'repository',
        label: 'repo-b',
        path: 'repo:/repo-b',
        repoRoot: '/repo-b',
        children: [],
      },
    ],
    repoRoots: ['/repo-a', '/repo-b'],
    loadedSections: new Set(['local']),
  };
  const dataLoader = createDataLoader(state);
  const { BranchTreeProvider } = loadFresh('../out/treeProvider.js', {
    vscode: createVscodeMock(commandCalls),
    './git': {
      fetchRemoteState() {},
      getBranches() {},
      getHooks() {},
      getRemoteBranches() {},
      getRepoRoot() {},
      getStashes() {},
      getWorktrees() {},
      getTags() {},
    },
    './gitApi': {
      getWorkspaceRepositories: async () => [],
      resolveRepoRootForUri: async () => undefined,
    },
    './treeDataLoader': {
      BranchDataLoader: class BranchDataLoader {},
      getBranchSectionKey: (sectionPath) =>
        sectionPath === 'section:local' ? 'local' : undefined,
    },
    './treeItem': createTreeItemMock(),
    './treePresentation': {
      findContainerNode,
      findDescendantBranches,
    },
  });

  const provider = new BranchTreeProvider({ subscriptions: [] }, dataLoader);

  const repositories = await provider.getChildren();
  const sections = await provider.getChildren(repositories[0]);
  const folders = await provider.getChildren(sections[0]);
  const branches = await provider.getChildren(folders[0]);

  assert.equal(provider.getParent(sections[0]).nodeType, 'repository');
  assert.equal(provider.getParent(folders[0]).containerPath, 'section:local');
  assert.equal(provider.getParent(branches[0]).containerPath, 'feature');
});

test('BranchTreeProvider revealItem clears active filters before resolving the visible item', async () => {
  const commandCalls = [];
  const state = {
    treeData: [
      {
        kind: 'section',
        label: 'Local',
        path: 'section:local',
        scope: 'local',
        repoRoot: '/repo',
        children: [
          {
            kind: 'folder',
            label: 'feature',
            path: 'feature',
            scope: 'local',
            repoRoot: '/repo',
            children: [
              {
                kind: 'branch',
                fullName: 'feature/demo',
                label: 'demo',
                path: 'feature/demo',
                repoRoot: '/repo',
                info: {
                  name: 'feature/demo',
                  isCurrent: false,
                },
              },
            ],
          },
        ],
      },
    ],
    repoRoot: '/repo',
    loadedSections: new Set(['local']),
  };
  const dataLoader = createDataLoader(state);
  const { BranchTreeProvider } = loadFresh('../out/treeProvider.js', {
    vscode: createVscodeMock(commandCalls),
    './git': {
      fetchRemoteState() {},
      getBranches() {},
      getHooks() {},
      getRemoteBranches() {},
      getRepoRoot() {},
      getStashes() {},
      getWorktrees() {},
      getTags() {},
    },
    './gitApi': {
      getWorkspaceRepositories: async () => [],
      resolveRepoRootForUri: async () => undefined,
    },
    './treeDataLoader': {
      BranchDataLoader: class BranchDataLoader {},
      getBranchSectionKey: (sectionPath) =>
        sectionPath === 'section:local' ? 'local' : undefined,
    },
    './treeItem': createTreeItemMock(),
    './treePresentation': {
      findContainerNode,
      findDescendantBranches,
    },
  });

  const provider = new BranchTreeProvider({ subscriptions: [] }, dataLoader);
  const revealCalls = [];

  provider.registerTreeViews([
    {
      async reveal(item, options) {
        revealCalls.push({ item, options });
      },
    },
  ]);

  await provider.setFilterQuery('missing');

  const staleItem = {
    nodeType: 'branch',
    branchName: 'feature/demo',
    repoRoot: '/repo',
  };

  const revealed = await provider.revealItem(staleItem, { clearFilter: true });

  assert.equal(revealed, true);
  assert.equal(revealCalls.length, 1);
  assert.notEqual(revealCalls[0].item, staleItem);
  assert.equal(revealCalls[0].item.branchName, 'feature/demo');
  assert.deepEqual(revealCalls[0].options, {
    expand: 3,
    focus: true,
    select: true,
  });
});
