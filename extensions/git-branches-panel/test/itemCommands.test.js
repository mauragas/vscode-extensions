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

function createVscodeState() {
  return {
    registeredCommands: {},
  };
}

function createVscodeMock(state) {
  return {
    commands: {
      registerCommand(name, callback) {
        state.registeredCommands[name] = callback;
        return { dispose() {} };
      },
    },
  };
}

function createCommandContext() {
  const state = {
    toggledItems: [],
  };

  return {
    state,
    context: {
      provider: {
        async togglePinnedItem(item) {
          state.toggledItems.push(item);
          return true;
        },
      },
      activationTracker: {},
      async refresh() {},
      async requireRepoRoot() {
        return '/repo';
      },
      async requireCurrentBranch() {
        return undefined;
      },
      async showSuccessAndRefresh() {},
      showCommandError() {},
    },
  };
}

function createItemCommandsModule({ vscodeState }) {
  const commandContext = createCommandContext();
  const itemCommands = loadFresh('../out/commands/itemCommands.js', {
    vscode: createVscodeMock(vscodeState),
    '../treeProvider': {
      BranchTreeItem: class BranchTreeItem {},
    },
  });

  itemCommands.registerItemCommands({ subscriptions: [] }, commandContext.context);

  return {
    commandContext,
  };
}

test('togglePinItem forwards supported items to the provider', async () => {
  const vscodeState = createVscodeState();
  const { commandContext } = createItemCommandsModule({ vscodeState });
  const item = {
    nodeType: 'stash',
    repoRoot: '/repo',
    branchInfo: {
      name: 'stash@{0}',
      isCurrent: false,
      scope: 'stash',
    },
  };

  await vscodeState.registeredCommands['gitBranchesPanel.togglePinItem'](item);

  assert.deepEqual(commandContext.state.toggledItems, [item]);
});

test('togglePinItem ignores unsupported items', async () => {
  const vscodeState = createVscodeState();
  const { commandContext } = createItemCommandsModule({ vscodeState });

  await vscodeState.registeredCommands['gitBranchesPanel.togglePinItem']({
    nodeType: 'tag',
    repoRoot: '/repo',
    branchInfo: {
      name: 'v1.0.0',
      isCurrent: false,
      scope: 'tag',
    },
  });

  assert.deepEqual(commandContext.state.toggledItems, []);
});

test('branchActionInProgress is a safe no-op command', async () => {
  const vscodeState = createVscodeState();
  createItemCommandsModule({ vscodeState });

  await vscodeState.registeredCommands['gitBranchesPanel.branchActionInProgress']();
});
