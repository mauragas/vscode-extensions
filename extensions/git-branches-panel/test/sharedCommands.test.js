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

function createVscodeMock(options = {}) {
  return {
    window: {
      activeTextEditor: options.activeTextEditor,
      showErrorMessage() {},
      showInformationMessage() {},
    },
  };
}

function loadSharedModule(vscodeMock, gitApi) {
  return loadFresh('../out/commands/shared.js', {
    vscode: vscodeMock,
    '../gitApi': {
      async getGitApi() {
        return gitApi;
      },
    },
    '../errorUtils': {
      formatErrorMessage(prefix, error) {
        return `${prefix}: ${error instanceof Error ? error.message : String(error)}`;
      },
    },
    '../providerRefresh': {
      async resetTrackerAndRefresh() {},
    },
    '../treeProvider': {
      BranchTreeProvider: class BranchTreeProvider {},
    },
  });
}

test('resolveRepoRootFromScmContext resolves the selected SCM repository via the public Git API', async () => {
  const repositoryCalls = [];
  const shared = loadSharedModule(createVscodeMock(), {
    repositories: [
      { rootUri: { fsPath: '/repo-a', path: '/repo-a' } },
      { rootUri: { fsPath: '/repo-b', path: '/repo-b' } },
    ],
    getRepository(uri) {
      repositoryCalls.push(uri.fsPath);
      if (uri.fsPath === '/repo-b') {
        return { rootUri: { fsPath: '/repo-b', path: '/repo-b' } };
      }

      return null;
    },
  });

  const repoRoot = await shared.resolveRepoRootFromScmContext({
    rootUri: { fsPath: '/repo-b', path: '/repo-b' },
  });

  assert.equal(repoRoot, '/repo-b');
  assert.deepEqual(repositoryCalls, ['/repo-b']);
});

test('resolveRepoRootFromScmContext resolves selected SCM resource states via the public Git API', async () => {
  const repositoryCalls = [];
  const shared = loadSharedModule(createVscodeMock(), {
    repositories: [
      { rootUri: { fsPath: '/repo-a', path: '/repo-a' } },
      { rootUri: { fsPath: '/repo-b', path: '/repo-b' } },
    ],
    getRepository(uri) {
      repositoryCalls.push(uri.fsPath);
      if (uri.fsPath === '/repo-b/src/app.ts') {
        return { rootUri: { fsPath: '/repo-b', path: '/repo-b' } };
      }

      return null;
    },
  });

  const repoRoot = await shared.resolveRepoRootFromScmContext({
    selectedResourceStates: [
      {
        resourceUri: { fsPath: '/repo-b/src/app.ts', path: '/repo-b/src/app.ts' },
      },
    ],
  });

  assert.equal(repoRoot, '/repo-b');
  assert.deepEqual(repositoryCalls, ['/repo-b/src/app.ts']);
});

test('resolveRepoRootFromScmContext falls back to the sole repository when no target is available', async () => {
  const shared = loadSharedModule(createVscodeMock(), {
    repositories: [{ rootUri: { fsPath: '/only-repo', path: '/only-repo' } }],
    getRepository() {
      return null;
    },
  });

  const repoRoot = await shared.resolveRepoRootFromScmContext(undefined);

  assert.equal(repoRoot, '/only-repo');
});
