const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

function loadFresh(modulePath, mocks, extraModulePaths = []) {
  const originalLoad = Module._load;
  const resolvedModulePaths = [
    require.resolve(modulePath),
    ...extraModulePaths.map((extraModulePath) => require.resolve(extraModulePath)),
  ];

  for (const resolvedModulePath of resolvedModulePaths) {
    delete require.cache[resolvedModulePath];
  }

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

function createVscodeState() {
  return {
    executedCommands: [],
  };
}

function createVscodeMock(showCurrentBranchInfo, treeViews, state) {
  return {
    commands: {
      async executeCommand(command, ...args) {
        state.executedCommands.push({ command, args });
        return undefined;
      },
    },
    window: {
      createTreeView: (viewId, options) => {
        const selectionListeners = [];
        const treeView = {
          viewId,
          options,
          message: undefined,
          selection: [],
          onDidChangeSelection(listener) {
            selectionListeners.push(listener);
            return { dispose() {} };
          },
          fireSelection(selection) {
            treeView.selection = selection;
            for (const listener of selectionListeners) {
              listener({ selection });
            }
          },
          dispose() {},
        };
        treeViews.push(treeView);
        return treeView;
      },
    },
    workspace: {
      getConfiguration: (section) => {
        assert.equal(section, 'gitBranchesPanel');

        return {
          get: (key, defaultValue) =>
            key === 'showCurrentBranchInfo' ? showCurrentBranchInfo : defaultValue,
        };
      },
    },
  };
}

test('registerBranchViews hides the current branch banner when setting is disabled', () => {
  const treeViews = [];
  const listeners = [];
  const vscodeState = createVscodeState();
  const { registerBranchViews } = loadFresh('../out/viewRegistration.js', {
    vscode: createVscodeMock(false, treeViews, vscodeState),
  }, ['../out/pinContext.js']);

  const provider = {
    getCurrentBranch: () => ({
      name: 'main',
      isCurrent: true,
      lastCommitDate: '1 minute ago',
    }),
    onDidChangeTreeData: (listener) => {
      listeners.push(listener);
      return { dispose() {} };
    },
  };
  const context = { subscriptions: [] };

  registerBranchViews(context, provider);

  assert.equal(treeViews.length, 2);
  assert.equal(treeViews[0].message, '');
  assert.equal(treeViews[1].message, '');

  listeners[0]();

  assert.equal(treeViews[0].message, '');
  assert.equal(treeViews[1].message, '');
});

test('registerBranchViews updates the current branch banner when setting is enabled', () => {
  const treeViews = [];
  const listeners = [];
  const vscodeState = createVscodeState();
  const { registerBranchViews } = loadFresh('../out/viewRegistration.js', {
    vscode: createVscodeMock(true, treeViews, vscodeState),
  }, ['../out/pinContext.js']);

  let currentBranch = {
    name: 'main',
    isCurrent: true,
  };
  const provider = {
    getCurrentBranch: () => currentBranch,
    onDidChangeTreeData: (listener) => {
      listeners.push(listener);
      return { dispose() {} };
    },
  };

  registerBranchViews({ subscriptions: [] }, provider);

  assert.equal(treeViews.length, 2);
  assert.equal(treeViews[0].message, 'Current branch: main');
  assert.equal(treeViews[1].message, 'Current branch: main');

  currentBranch = {
    name: 'feature/release-candidate',
    isCurrent: true,
    lastCommitDate: '3 minutes ago',
  };

  listeners[0]();

  assert.equal(
    treeViews[0].message,
    'Current branch: feature/release-candidate • 3 minutes ago'
  );
  assert.equal(
    treeViews[1].message,
    'Current branch: feature/release-candidate • 3 minutes ago'
  );
});

test('registerBranchViews keeps per-view pinned-item contexts isolated across both tree views', () => {
  const treeViews = [];
  const listeners = [];
  const vscodeState = createVscodeState();
  const { registerBranchViews } = loadFresh('../out/viewRegistration.js', {
    vscode: createVscodeMock(false, treeViews, vscodeState),
  }, ['../out/pinContext.js']);

  const provider = {
    getCurrentBranch: () => undefined,
    onDidChangeTreeData: (listener) => {
      listeners.push(listener);
      return { dispose() {} };
    },
  };

  registerBranchViews({ subscriptions: [] }, provider);

  const pinnedBranch = {
    nodeType: 'branch',
    repoRoot: '/repo',
    branchInfo: {
      name: 'feature/demo',
      isCurrent: false,
      isPinned: true,
    },
  };
  const unpinnedBranch = {
    nodeType: 'branch',
    repoRoot: '/repo',
    branchInfo: {
      name: 'feature/demo',
      isCurrent: false,
      isPinned: false,
    },
  };
  const tagItem = {
    nodeType: 'tag',
    repoRoot: '/repo',
    branchInfo: {
      name: 'v1.0.0',
      isCurrent: false,
      isPinned: true,
      scope: 'tag',
    },
  };

  treeViews[0].fireSelection([pinnedBranch]);
  treeViews[1].fireSelection([unpinnedBranch]);
  treeViews[1].fireSelection([tagItem]);
  listeners[0]();
  treeViews[0].fireSelection([]);

  assert.deepEqual(vscodeState.executedCommands, [
    {
      command: 'setContext',
      args: ['gitBranchesPanel.branchesViewSelectedItemPinned', false],
    },
    {
      command: 'setContext',
      args: ['gitBranchesPanel.scmViewSelectedItemPinned', false],
    },
    {
      command: 'setContext',
      args: ['gitBranchesPanel.branchesViewSelectedItemPinned', true],
    },
    {
      command: 'setContext',
      args: ['gitBranchesPanel.scmViewSelectedItemPinned', false],
    },
    {
      command: 'setContext',
      args: ['gitBranchesPanel.scmViewSelectedItemPinned', false],
    },
    {
      command: 'setContext',
      args: ['gitBranchesPanel.branchesViewSelectedItemPinned', true],
    },
    {
      command: 'setContext',
      args: ['gitBranchesPanel.scmViewSelectedItemPinned', false],
    },
    {
      command: 'setContext',
      args: ['gitBranchesPanel.branchesViewSelectedItemPinned', false],
    },
  ]);
});
