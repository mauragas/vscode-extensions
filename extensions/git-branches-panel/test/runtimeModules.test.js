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

function createStatusBarItem() {
  return {
    text: undefined,
    command: undefined,
    tooltip: undefined,
    showCalls: 0,
    hideCalls: 0,
    show() {
      this.showCalls += 1;
    },
    hide() {
      this.hideCalls += 1;
    },
  };
}

function createVscodeMock(statusBarItem) {
  return {
    EventEmitter: createEventEmitter(),
    MarkdownString: class MarkdownString {
      constructor(value) {
        this.value = value;
      }
    },
    StatusBarAlignment: {
      Left: 1,
    },
    window: {
      createStatusBarItem: () => statusBarItem,
    },
  };
}

function createTreeItemMock() {
  return {
    BranchTreeItem: class BranchTreeItem {
      constructor(node, repoRoot) {
        this.nodeType = node.kind === 'branch' ? 'branch' : node.kind;
        this.containerKey =
          node.kind === 'branch'
            ? undefined
            : node.kind === 'section'
              ? node.path
              : `folder:${node.scope ?? 'local'}:${node.path}`;
        this.containerPath = node.kind === 'branch' ? undefined : node.path;
        this.containerScope = node.kind === 'branch' ? undefined : node.scope;
        this.branchName = node.kind === 'branch' ? node.fullName : undefined;
        this.repoRoot = repoRoot;
      }
    },
  };
}

function getContainerKey(node) {
  return node.kind === 'section' ? node.path : `folder:${node.scope ?? 'local'}:${node.path}`;
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
    getRepoRoot() {
      return state.repoRoot;
    },
    isSectionLoaded(section) {
      return Boolean(state.loadedSections?.has(section));
    },
  };
}

test('activate orchestrates provider, views, commands, and auto-refresh wiring', async () => {
  const calls = {
    trackers: 0,
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
  assert.equal(calls.providerContexts.length, 1);
  assert.equal(calls.views.length, 1);
  assert.equal(calls.commands.length, 1);
  assert.equal(calls.autoRefresh.length, 1);
  assert.deepEqual(calls.refreshes, []);
  assert.equal(calls.views[0][0], context);
  assert.equal(calls.commands[0][0], context);
  assert.equal(calls.autoRefresh[0][0], context);
  assert.equal(calls.commands[0][1], calls.views[0][1]);
  assert.equal(calls.autoRefresh[0][1], calls.views[0][1]);
  assert.equal(calls.commands[0][2], calls.autoRefresh[0][2]);
});

test('BranchTreeProvider refreshes status bar data and exposes tree items', async () => {
  const statusBarItem = createStatusBarItem();
  const state = {
    currentBranch: {
      name: 'main',
      isCurrent: true,
    },
    treeData: [
      {
        kind: 'section',
        label: 'Local',
        path: 'section:local',
        scope: 'local',
        children: [],
      },
    ],
    repoRoot: '/repo',
    loadedSections: new Set(['local']),
  };
  const dataLoader = createDataLoader(state);
  const { BranchTreeProvider } = loadFresh('../out/treeProvider.js', {
    vscode: createVscodeMock(statusBarItem),
    './git': {
      fetchRemoteState() {},
      getBranches() {},
      getRemoteBranches() {},
      getRepoRoot() {},
      getStashes() {},
      getWorktrees() {},
      getTags() {},
    },
    './treeDataLoader': {
      BranchDataLoader: class BranchDataLoader {},
      getBranchSectionKey: (sectionPath) =>
        sectionPath === 'section:local' ? 'local' : undefined,
    },
    './treeItem': createTreeItemMock(),
    './treePresentation': {
      buildStatusBarText: (branch) => (branch ? `branch:${branch.name}` : ''),
      buildStatusBarTooltipContent: (branch) => `tooltip:${branch.name}`,
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
  assert.equal(statusBarItem.text, 'branch:main');
  assert.equal(statusBarItem.command, 'gitBranchesPanel.syncCurrentBranch');
  assert.equal(statusBarItem.tooltip.value, 'tooltip:main');
  assert.equal(statusBarItem.showCalls, 1);
  assert.equal(treeChangeCount, 1);
  assert.equal(context.subscriptions.includes(statusBarItem), true);

  const rootChildren = await provider.getChildren();
  assert.equal(rootChildren.length, 1);
  assert.equal(rootChildren[0].containerPath, 'section:local');
  assert.equal(rootChildren[0].containerKey, 'section:local');
  assert.equal(provider.getTreeItem(rootChildren[0]), rootChildren[0]);
});

test('BranchTreeProvider loads nested container children and hides the status bar when no branch is active', async () => {
  const statusBarItem = createStatusBarItem();
  const state = {
    currentBranch: undefined,
    treeData: [],
    repoRoot: '/repo',
    loadedSections: new Set(),
    onRefresh(options) {
      for (const section of options.sections ?? []) {
        state.loadedSections.add(section);
      }

      state.treeData = [
        {
          kind: 'section',
          label: 'Local',
          path: 'section:local',
          scope: 'local',
          children: state.loadedSections.has('local')
            ? [
                {
                  kind: 'folder',
                  label: 'feature',
                  path: 'feature',
                  scope: 'local',
                  children: [
                    {
                      kind: 'branch',
                      fullName: 'feature/demo',
                      label: 'demo',
                      path: 'feature/demo',
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
          children: state.loadedSections.has('remote')
            ? [
                {
                  kind: 'branch',
                  fullName: 'origin/main',
                  label: 'main',
                  path: 'origin/main',
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
    vscode: createVscodeMock(statusBarItem),
    './git': {
      fetchRemoteState() {},
      getBranches() {},
      getRemoteBranches() {},
      getRepoRoot() {},
      getStashes() {},
      getWorktrees() {},
      getTags() {},
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
      buildStatusBarText: () => '',
      buildStatusBarTooltipContent: () => '',
      findContainerNode,
      findDescendantBranches,
    },
  });

  const provider = new BranchTreeProvider({ subscriptions: [] }, dataLoader);

  const rootChildren = await provider.getChildren();
  const folderChildren = await provider.getChildren(rootChildren[0]);
  const branchChildren = await provider.getChildren(folderChildren[0]);
  const remoteChildren = await provider.getChildren(rootChildren[1]);
  const descendantBranches = provider.getDescendantBranches('folder:local:feature');

  assert.deepEqual(dataLoader.refreshCalls, [
    { sections: ['local'], fetchRemoteState: false },
    { sections: ['remote'], fetchRemoteState: false },
  ]);
  assert.equal(rootChildren.length, 2);
  assert.equal(rootChildren[0].containerPath, 'section:local');
  assert.equal(folderChildren[0].containerKey, 'folder:local:feature');
  assert.equal(folderChildren[0].containerPath, 'feature');
  assert.equal(branchChildren[0].branchName, 'feature/demo');
  assert.equal(remoteChildren[0].branchName, 'origin/main');
  assert.deepEqual(descendantBranches.map((branch) => branch.fullName), ['feature/demo']);

  await provider.refresh();

  assert.ok(statusBarItem.hideCalls >= 1);
});
