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
    infoMessages: [],
    warningMessages: [],
    errorMessages: [],
    warningResponses: [],
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
    window: {
      async showInformationMessage(message) {
        state.infoMessages.push(message);
        return undefined;
      },
      async showWarningMessage(message, options, ...items) {
        state.warningMessages.push({ message, options, items });
        if (options && options.modal) {
          return state.warningResponses.shift();
        }

        return undefined;
      },
      async showErrorMessage(message) {
        state.errorMessages.push(message);
        return undefined;
      },
    },
  };
}

function createCommandContext() {
  const state = {
    repoRoot: '/repo',
    successRefreshes: [],
    commandErrors: [],
  };

  return {
    state,
    context: {
      provider: {},
      activationTracker: {},
      async refresh() {},
      async requireRepoRoot() {
        return state.repoRoot;
      },
      async requireCurrentBranch() {
        return undefined;
      },
      async showSuccessAndRefresh(message, options = {}) {
        state.successRefreshes.push({ message, options });
      },
      showCommandError(prefix, error) {
        state.commandErrors.push({
          prefix,
          message: error instanceof Error ? error.message : String(error),
        });
      },
    },
  };
}

function createStashCommandsModule({ vscodeState, gitMock }) {
  const commandContext = createCommandContext();
  const stashCommands = loadFresh('../out/commands/stashCommands.js', {
    vscode: createVscodeMock(vscodeState),
    '../git': gitMock,
    '../treeProvider': {
      BranchTreeItem: class BranchTreeItem {},
    },
  });

  stashCommands.registerStashCommands({ subscriptions: [] }, commandContext.context);

  return {
    commandContext,
  };
}

test('dropAllStashes shows an info message when there are no stashes', async () => {
  const vscodeState = createVscodeState();
  const dropAllCalls = [];

  createStashCommandsModule({
    vscodeState,
    gitMock: {
      async applyStash() {},
      async dropAllStashes(repoRoot) {
        dropAllCalls.push(repoRoot);
      },
      async dropStash() {},
      async getStashes() {
        return [];
      },
      async popStash() {},
      async stashSilently() {
        return false;
      },
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.dropAllStashes']({
    nodeType: 'section',
    containerScope: 'stash',
    repoRoot: '/repo',
  });

  assert.deepEqual(dropAllCalls, []);
  assert.deepEqual(vscodeState.infoMessages, ['No stashes were found to drop.']);
});

test('dropAllStashes confirms, clears all stashes, and refreshes once', async () => {
  const vscodeState = createVscodeState();
  vscodeState.warningResponses.push('Drop All');
  const dropAllCalls = [];

  const { commandContext } = createStashCommandsModule({
    vscodeState,
    gitMock: {
      async applyStash() {},
      async dropAllStashes(repoRoot) {
        dropAllCalls.push(repoRoot);
      },
      async dropStash() {},
      async getStashes() {
        return [
          { name: 'stash@{0}', isCurrent: false, scope: 'stash' },
          { name: 'stash@{1}', isCurrent: false, scope: 'stash' },
        ];
      },
      async popStash() {},
      async stashSilently() {
        return false;
      },
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.dropAllStashes']({
    nodeType: 'section',
    containerScope: 'stash',
    repoRoot: '/repo',
  });

  assert.equal(vscodeState.warningMessages[0].options.modal, true);
  assert.match(vscodeState.warningMessages[0].message, /Drop all 2 stashes\?/);
  assert.deepEqual(dropAllCalls, ['/repo']);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: 'Dropped all 2 stashes.',
      options: { fetchRemoteState: false },
    },
  ]);
});
