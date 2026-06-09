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
    executedCommands: [],
    infoMessages: [],
    warningMessages: [],
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
      async executeCommand(command, ...args) {
        state.executedCommands.push({ command, args });
        return undefined;
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
    },
  };
}

function createCommandContext() {
  const state = {
    successRefreshes: [],
    commandErrors: [],
    setActiveRepositoryCalls: [],
  };

  return {
    state,
    context: {
      provider: {
        async setActiveRepository(repoRoot) {
          state.setActiveRepositoryCalls.push(repoRoot);
          return true;
        },
        getRepositoryDescriptors() {
          return [
            {
              repoRoot: '/repo',
              label: 'repo',
            },
          ];
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

function createRepositoryCommandsModule({ vscodeState, gitMock }) {
  const commandContext = createCommandContext();
  const repositoryCommands = loadFresh('../out/commands/repositoryCommands.js', {
    vscode: createVscodeMock(vscodeState),
    '../git': gitMock,
  });

  repositoryCommands.registerRepositoryCommands({ subscriptions: [] }, commandContext.context);

  return {
    commandContext,
  };
}

test('cleanRepository confirms, cleans the repository, and refreshes once', async () => {
  const vscodeState = createVscodeState();
  vscodeState.warningResponses.push('Clean Repository');
  const cleanCalls = [];

  const { commandContext } = createRepositoryCommandsModule({
    vscodeState,
    gitMock: {
      async cleanRepository(repoRoot) {
        cleanCalls.push(repoRoot);
      },
      async fetchAllRemotes() {},
      async fetchRemoteState() {},
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.cleanRepository']();

  assert.equal(vscodeState.warningMessages[0].options.modal, true);
  assert.match(vscodeState.warningMessages[0].message, /git clean -fdx/);
  assert.deepEqual(cleanCalls, ['/repo']);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: 'Removed untracked and ignored files from the repository.',
      options: { fetchRemoteState: false },
    },
  ]);
});

test('fetchAll fetches remotes and refreshes without pruning', async () => {
  const vscodeState = createVscodeState();
  const fetchCalls = [];

  const { commandContext } = createRepositoryCommandsModule({
    vscodeState,
    gitMock: {
      async cleanRepository() {},
      async fetchAllRemotes(repoRoot) {
        fetchCalls.push(repoRoot);
      },
      async fetchRemoteState() {},
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.fetchAll']();

  assert.deepEqual(fetchCalls, ['/repo']);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: 'Fetched all remotes and refreshed branch status.',
      options: { fetchRemoteState: false },
    },
  ]);
});

test('fetchAllPrune fetches remotes with pruning and refreshes once', async () => {
  const vscodeState = createVscodeState();
  const pruneCalls = [];

  const { commandContext } = createRepositoryCommandsModule({
    vscodeState,
    gitMock: {
      async cleanRepository() {},
      async fetchAllRemotes() {},
      async fetchRemoteState(repoRoot) {
        pruneCalls.push(repoRoot);
      },
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.fetchAllPrune']();

  assert.deepEqual(pruneCalls, ['/repo']);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: 'Fetched all remotes, pruned deleted refs, and refreshed branch status.',
      options: { fetchRemoteState: false },
    },
  ]);
});

test('openSettings opens the extension settings query', async () => {
  const vscodeState = createVscodeState();

  createRepositoryCommandsModule({
    vscodeState,
    gitMock: {
      async cleanRepository() {},
      async fetchAllRemotes() {},
      async fetchRemoteState() {},
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.openSettings']();

  assert.deepEqual(vscodeState.executedCommands, [
    {
      command: 'workbench.action.openSettings',
      args: ['@ext:karolis-mauragas.git-branches-panel'],
    },
  ]);
});

test('selectRepository can activate the repository from a repository tree item directly', async () => {
  const vscodeState = createVscodeState();

  const { commandContext } = createRepositoryCommandsModule({
    vscodeState,
    gitMock: {
      async cleanRepository() {},
      async fetchAllRemotes() {},
      async fetchRemoteState() {},
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.selectRepository']({
    nodeType: 'repository',
    repoRoot: '/repo',
    label: 'repo',
  });

  assert.deepEqual(commandContext.state.setActiveRepositoryCalls, ['/repo']);
  assert.deepEqual(vscodeState.infoMessages, ["Selected repository 'repo'."]);
});
