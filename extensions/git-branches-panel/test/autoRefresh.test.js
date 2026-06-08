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

function createWatcher(glob) {
  const listeners = {
    change: [],
    create: [],
    delete: [],
  };

  return {
    glob,
    listeners,
    onDidChange(listener) {
      listeners.change.push(listener);
      return { dispose() {} };
    },
    onDidCreate(listener) {
      listeners.create.push(listener);
      return { dispose() {} };
    },
    onDidDelete(listener) {
      listeners.delete.push(listener);
      return { dispose() {} };
    },
    dispose() {},
  };
}

function flushMicrotasks() {
  return Promise.resolve().then(() => Promise.resolve());
}

test('registerAutoRefresh targets only the affected loaded sections', async () => {
  const watchers = new Map();
  const configurationListeners = [];
  const workspaceFolderListeners = [];
  const refreshCalls = [];

  const vscodeMock = {
    workspace: {
      createFileSystemWatcher: (glob) => {
        const watcher = createWatcher(glob);
        watchers.set(glob, watcher);
        return watcher;
      },
      onDidChangeConfiguration: (listener) => {
        configurationListeners.push(listener);
        return { dispose() {} };
      },
      onDidChangeWorkspaceFolders: (listener) => {
        workspaceFolderListeners.push(listener);
        return { dispose() {} };
      },
    },
  };

  const { registerAutoRefresh } = loadFresh('../out/autoRefresh.js', {
    vscode: vscodeMock,
    './providerRefresh': {
      resetTrackerAndRefresh: async (_provider, _activationTracker, options = {}) => {
        refreshCalls.push(options);
      },
    },
  });

  const context = { subscriptions: [] };
  registerAutoRefresh(context, { refresh() {} }, { reset() {} });

  watchers.get('**/.git/HEAD').listeners.change[0]();
  watchers.get('**/.git/refs/remotes/**').listeners.delete[0]();
  watchers.get('**/.git/refs/tags/**').listeners.create[0]();
  watchers.get('**/.git/logs/refs/stash').listeners.change[0]();
  watchers.get('**/.git/worktrees/**').listeners.create[0]();
  watchers.get('**/.git/config').listeners.change[0]();
  watchers.get('**/.git/hooks/**').listeners.delete[0]();
  watchers.get('**/.git/FETCH_HEAD').listeners.change[0]();
  watchers.get('**/.git/packed-refs').listeners.delete[0]();
  configurationListeners[0]({
    affectsConfiguration: (section) => section === 'gitBranchesPanel',
  });
  workspaceFolderListeners[0]();

  await flushMicrotasks();

  assert.deepEqual(refreshCalls, [
    { sections: ['local'], fetchRemoteState: false, onlyIfLoaded: true },
    { sections: ['local', 'remote'], fetchRemoteState: false, onlyIfLoaded: true },
    { sections: ['tags'], fetchRemoteState: false, onlyIfLoaded: true },
    { sections: ['stash'], fetchRemoteState: false, onlyIfLoaded: true },
    { sections: ['worktree'], fetchRemoteState: false, onlyIfLoaded: true },
    { sections: ['hooks'], fetchRemoteState: false, onlyIfLoaded: true },
    { sections: ['hooks'], fetchRemoteState: false, onlyIfLoaded: true },
    { sections: ['local', 'remote'], fetchRemoteState: false, onlyIfLoaded: true },
    { sections: ['local', 'remote', 'tags'], fetchRemoteState: false, onlyIfLoaded: true },
    { sections: undefined, fetchRemoteState: false, onlyIfLoaded: false },
    { sections: undefined, fetchRemoteState: false, onlyIfLoaded: false },
  ]);
  assert.ok(context.subscriptions.length >= 13);
});
