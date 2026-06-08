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
    registeredCommands: {},
    executedCommands: [],
  };
}

function createVscodeMock(state) {
  return {
    commands: {
      registerCommand(name, callback) {
        state.registeredCommands[name] = callback;
        return { dispose() {} };
      },
      async executeCommand(command, ...args) {
        state.executedCommands.push({ command, args });
        return undefined;
      },
    },
  };
}

function createCommandContext(nextPinnedValues = []) {
  const state = {
    toggledItems: [],
    nextPinnedValues: [...nextPinnedValues],
  };

  return {
    state,
    context: {
      provider: {
        async togglePinnedItem(item) {
          state.toggledItems.push(item);
          return state.nextPinnedValues.length > 0 ? state.nextPinnedValues.shift() : true;
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

function createItemCommandsModule({ vscodeState, nextPinnedValues = [] }) {
  const commandContext = createCommandContext(nextPinnedValues);
  const itemCommands = loadFresh('../out/commands/itemCommands.js', {
    vscode: createVscodeMock(vscodeState),
    '../treeProvider': {
      BranchTreeItem: class BranchTreeItem {},
    },
  }, ['../out/pinContext.js']);

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
  assert.deepEqual(vscodeState.executedCommands, [
    {
      command: 'setContext',
      args: ['gitBranchesPanel.selectedItemPinned', true],
    },
  ]);
});

test('pinItem and unpinItem commands reuse the toggle handler and update the selection context', async () => {
  const vscodeState = createVscodeState();
  const { commandContext } = createItemCommandsModule({
    vscodeState,
    nextPinnedValues: [true, false],
  });
  const item = {
    nodeType: 'branch',
    repoRoot: '/repo',
    branchInfo: {
      name: 'feature/demo',
      isCurrent: false,
    },
  };

  assert.equal(typeof vscodeState.registeredCommands['gitBranchesPanel.pinItem'], 'function');
  assert.equal(typeof vscodeState.registeredCommands['gitBranchesPanel.unpinItem'], 'function');

  await vscodeState.registeredCommands['gitBranchesPanel.pinItem'](item);
  await vscodeState.registeredCommands['gitBranchesPanel.unpinItem'](item);

  assert.deepEqual(commandContext.state.toggledItems, [item, item]);
  assert.deepEqual(vscodeState.executedCommands, [
    {
      command: 'setContext',
      args: ['gitBranchesPanel.selectedItemPinned', true],
    },
    {
      command: 'setContext',
      args: ['gitBranchesPanel.selectedItemPinned', false],
    },
  ]);
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
  assert.deepEqual(vscodeState.executedCommands, []);
});

test('branchActionInProgress is a safe no-op command', async () => {
  const vscodeState = createVscodeState();
  createItemCommandsModule({ vscodeState });

  await vscodeState.registeredCommands['gitBranchesPanel.branchActionInProgress']();
});
