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

function createVscodeMock(showCurrentBranchInfo, treeViews) {
  return {
    window: {
      createTreeView: (viewId, options) => {
        const treeView = {
          viewId,
          options,
          message: undefined,
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
  const { registerBranchViews } = loadFresh('../out/viewRegistration.js', {
    vscode: createVscodeMock(false, treeViews),
  });

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
  const { registerBranchViews } = loadFresh('../out/viewRegistration.js', {
    vscode: createVscodeMock(true, treeViews),
  });

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
