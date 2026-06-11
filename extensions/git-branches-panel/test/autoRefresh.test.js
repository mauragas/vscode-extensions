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

function flushTimers(ms = 250) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('registerAutoRefresh targets only the affected loaded sections', async () => {
  const watchers = new Map();
  const configurationListeners = [];
  const workspaceFolderListeners = [];
  const refreshCalls = [];

  const vscodeMock = {
    Disposable: class Disposable {
      constructor(callback) {
        this._callback = callback;
      }
      dispose() {
        this._callback();
      }
    },
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

  await flushTimers(250);

  assert.deepEqual(refreshCalls, [
    {},
    {},
    { sections: ['local', 'remote'] },
  ]);
  assert.ok(context.subscriptions.length >= 13);
});

test('debounceTimer resets between distinct watcher event bursts', async () => {
  const watchers = new Map();
  const refreshCalls = [];

  const vscodeMock = {
    Disposable: class Disposable {
      constructor(callback) {
        this._callback = callback;
      }
      dispose() {
        this._callback();
      }
    },
    workspace: {
      createFileSystemWatcher: (glob) => {
        const watcher = createWatcher(glob);
        watchers.set(glob, watcher);
        return watcher;
      },
      onDidChangeConfiguration: () => ({ dispose() {} }),
      onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
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

  // First burst: HEAD change triggers local-only refresh
  watchers.get('**/.git/HEAD').listeners.change[0]();
  await flushTimers(250);

  // Second burst: tag creation triggers tags-only refresh (separate debounce window)
  watchers.get('**/.git/refs/tags/**').listeners.create[0]();
  await flushTimers(250);

  assert.deepEqual(refreshCalls, [
    { sections: ['local'] },
    { sections: ['tags'] },
  ]);
});

test('periodicRefresh fires full reset when interval elapses', async () => {
  const watchers = new Map();
  const refreshCalls = [];
  let originalNow = Date.now;
  let fakeTime = 0;

  const vscodeMock = {
    Disposable: class Disposable {
      constructor(callback) {
        this._callback = callback;
      }
      dispose() {
        this._callback();
      }
    },
    workspace: {
      createFileSystemWatcher: (glob) => {
        const watcher = createWatcher(glob);
        watchers.set(glob, watcher);
        return watcher;
      },
      onDidChangeConfiguration: () => ({ dispose() {} }),
      onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
    },
  };

  // Intercept Date.now before module loads so the compiled CHECK_INTERVAL_MS path uses fake time
  const originalSetInterval = global.setInterval;
  let savedCallback = null;
  let savedMs = 0;

  try {
    global.setInterval = (cb, ms) => {
      savedCallback = cb;
      savedMs = ms;
      return { _isMock: true };
    };

    const { registerAutoRefresh } = loadFresh('../out/autoRefresh.js', {
      vscode: vscodeMock,
      './providerRefresh': {
        resetTrackerAndRefresh: async (_provider, _activationTracker, options) => {
          refreshCalls.push(options);
        },
      },
    });

    const context = { subscriptions: [] };
    registerAutoRefresh(context, { refresh() {} }, { reset() {} });

    // Simulate periodic timer firing after interval elapses
    fakeTime = 31000;
    Date.now = () => fakeTime;
    savedCallback();

    assert.equal(refreshCalls.length, 1);
    assert.deepEqual(refreshCalls[0], undefined);
    assert.equal(savedMs, 30_000);

    // Second tick should be skipped because lastRefreshTime was already updated
    refreshCalls.length = 0;
    savedCallback();

    assert.equal(refreshCalls.length, 0);
  } finally {
    global.setInterval = originalSetInterval;
    Date.now = originalNow;
  }
});

test('subscription cleanup disposes periodic timer', async () => {
  const watchers = new Map();
  let disposed = false;

  const vscodeMock = {
    Disposable: class Disposable {
      constructor(callback) {
        this._callback = callback;
        this.dispose = () => {
          callback();
          disposed = true;
        };
      }
    },
    workspace: {
      createFileSystemWatcher: (glob) => {
        const watcher = createWatcher(glob);
        watchers.set(glob, watcher);
        return watcher;
      },
      onDidChangeConfiguration: () => ({ dispose() {} }),
      onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
    },
  };

  const { registerAutoRefresh } = loadFresh('../out/autoRefresh.js', {
    vscode: vscodeMock,
    './providerRefresh': {
      resetTrackerAndRefresh: async () => {},
    },
  });

  const context = { subscriptions: [] };
  registerAutoRefresh(context, { refresh() {} }, { reset() {} });

  // Call dispose on the Disposable subscription (the periodic timer cleanup)
  const disposableSub = context.subscriptions.find(
    (sub) => sub && typeof sub.dispose === 'function' && sub._callback
  );
  if (disposableSub) {
    disposableSub.dispose();
  }

  assert.ok(disposed);
});
