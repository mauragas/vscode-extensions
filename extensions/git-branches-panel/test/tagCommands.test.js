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
    errorMessages: [],
    inputBoxRequests: [],
    inputBoxResponse: undefined,
    quickPickRequests: [],
    quickPickSelector: undefined,
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
    env: {
      clipboard: {
        async writeText() {},
      },
    },
    window: {
      async showErrorMessage(message) {
        state.errorMessages.push(message);
        return undefined;
      },
      async showInformationMessage() {
        return undefined;
      },
      async showInputBox(options) {
        state.inputBoxRequests.push(options);
        return state.inputBoxResponse;
      },
      async showQuickPick(items, options) {
        state.quickPickRequests.push({ items, options });
        return typeof state.quickPickSelector === 'function'
          ? state.quickPickSelector(items, options)
          : undefined;
      },
      async showWarningMessage() {
        return undefined;
      },
    },
  };
}

function createCommandContext() {
  const state = {
    currentBranch: undefined,
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
        return '/repo';
      },
      async requireCurrentBranch() {
        return state.currentBranch;
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

function createTagCommandsModule({ vscodeState, gitMock }) {
  const commandContext = createCommandContext();
  const tagCommands = loadFresh('../out/commands/tagCommands.js', {
    vscode: createVscodeMock(vscodeState),
    '../extensionHelpers': {
      validateTagName() {
        return undefined;
      },
    },
    '../git': gitMock,
    '../treeProvider': {
      BranchTreeItem: class BranchTreeItem {},
    },
    './shared': {
      NO_CURRENT_BRANCH_MESSAGE: 'No current git branch was found.',
    },
  });

  tagCommands.registerTagCommands({ subscriptions: [] }, commandContext.context);

  return {
    commandContext,
  };
}

test('createTag falls back to the current branch when triggered from the Tags section', async () => {
  const vscodeState = createVscodeState();
  vscodeState.inputBoxResponse = 'v2.0.0';
  const createTagCalls = [];

  const { commandContext } = createTagCommandsModule({
    vscodeState,
    gitMock: {
      async checkoutTag() {},
      async createTag(repoRoot, tagName, refName) {
        createTagCalls.push({ repoRoot, tagName, refName });
      },
      async deleteTag() {},
      async getRemotes() {
        return ['origin'];
      },
      async pushAllTags() {},
    },
  });
  commandContext.state.currentBranch = {
    name: 'main',
    isCurrent: true,
  };

  await vscodeState.registeredCommands['gitBranchesPanel.createTag']({
    nodeType: 'section',
    containerPath: 'section:tags',
    repoRoot: '/repo',
  });

  assert.match(vscodeState.inputBoxRequests[0].prompt, /new tag on 'main'/);
  assert.deepEqual(createTagCalls, [
    {
      repoRoot: '/repo',
      tagName: 'v2.0.0',
      refName: 'main',
    },
  ]);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: "Created tag 'v2.0.0' on 'main'.",
      options: { fetchRemoteState: false },
    },
  ]);
});

test('pushAllTags accepts the Tags section and uses the only configured remote automatically', async () => {
  const vscodeState = createVscodeState();
  const pushAllTagsCalls = [];

  const { commandContext } = createTagCommandsModule({
    vscodeState,
    gitMock: {
      async checkoutTag() {},
      async createTag() {},
      async deleteTag() {},
      async getRemotes() {
        return ['origin'];
      },
      async pushAllTags(repoRoot, remoteName) {
        pushAllTagsCalls.push({ repoRoot, remoteName });
      },
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.pushAllTags']({
    nodeType: 'section',
    containerPath: 'section:tags',
    repoRoot: '/repo',
  });

  assert.deepEqual(pushAllTagsCalls, [{ repoRoot: '/repo', remoteName: 'origin' }]);
  assert.equal(vscodeState.quickPickRequests.length, 0);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: "Pushed all tags to 'origin'.",
      options: { fetchRemoteState: false },
    },
  ]);
});
