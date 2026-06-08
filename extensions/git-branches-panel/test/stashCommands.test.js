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
    inputBoxRequests: [],
    inputBoxResponse: undefined,
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
      async showInputBox(options) {
        state.inputBoxRequests.push(options);
        return state.inputBoxResponse;
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

function createBaseGitMock(overrides = {}) {
  return {
    async applyStash() {},
    async dropAllStashes() {},
    async dropStash() {},
    async getStashes() {
      return [];
    },
    async popStash() {},
    async stashAllChanges() {
      return false;
    },
    async stashSilently() {
      return false;
    },
    async stashStagedChanges() {
      return false;
    },
    async stashStagedSilently() {
      return false;
    },
    ...overrides,
  };
}

function createStashCommandsModule({
  vscodeState,
  gitMock,
  resolveRepoRootFromScmContextImpl,
}) {
  const commandContext = createCommandContext();
  const stashCommands = loadFresh('../out/commands/stashCommands.js', {
    vscode: createVscodeMock(vscodeState),
    '../git': createBaseGitMock(gitMock),
    '../treeProvider': {
      BranchTreeItem: class BranchTreeItem {},
    },
    './shared': {
      resolveRepoRootFromScmContext:
        resolveRepoRootFromScmContextImpl ?? (async () => undefined),
    },
  });

  stashCommands.registerStashCommands({ subscriptions: [] }, commandContext.context);

  return {
    commandContext,
  };
}

test('stashSilently resolves the selected SCM repository before falling back to the provider repo', async () => {
  const vscodeState = createVscodeState();
  const stashCalls = [];

  const { commandContext } = createStashCommandsModule({
    vscodeState,
    resolveRepoRootFromScmContextImpl: async (target) => target?.rootUri?.fsPath,
    gitMock: {
      async stashSilently(repoRoot) {
        stashCalls.push(repoRoot);
        return true;
      },
    },
  });
  commandContext.state.repoRoot = '/fallback-repo';

  await vscodeState.registeredCommands['gitBranchesPanel.stashSilently']({
    rootUri: { fsPath: '/scm-repo' },
  });

  assert.deepEqual(stashCalls, ['/scm-repo']);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: 'Stashed tracked and untracked changes.',
      options: { fetchRemoteState: false },
    },
  ]);
});

test('stashAllChanges prompts for an optional message and uses the fallback repo when needed', async () => {
  const vscodeState = createVscodeState();
  vscodeState.inputBoxResponse = 'Release prep';
  const stashCalls = [];

  const { commandContext } = createStashCommandsModule({
    vscodeState,
    gitMock: {
      async stashAllChanges(repoRoot, message) {
        stashCalls.push({ repoRoot, message });
        return true;
      },
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.stashAllChanges']();

  assert.match(vscodeState.inputBoxRequests[0].prompt, /optional stash message for all changes/i);
  assert.deepEqual(stashCalls, [{ repoRoot: '/repo', message: 'Release prep' }]);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: 'Stashed tracked and untracked changes.',
      options: { fetchRemoteState: false },
    },
  ]);
});

test('stashStagedChanges stops when the optional message prompt is cancelled', async () => {
  const vscodeState = createVscodeState();
  const stashCalls = [];

  const { commandContext } = createStashCommandsModule({
    vscodeState,
    gitMock: {
      async stashStagedChanges(repoRoot, message) {
        stashCalls.push({ repoRoot, message });
        return true;
      },
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.stashStagedChanges']();

  assert.equal(vscodeState.inputBoxRequests.length, 1);
  assert.deepEqual(stashCalls, []);
  assert.deepEqual(commandContext.state.successRefreshes, []);
});

test('stashStagedSilently shows an info message when there are no staged changes to stash', async () => {
  const vscodeState = createVscodeState();

  createStashCommandsModule({
    vscodeState,
    gitMock: {
      async stashStagedSilently() {
        return false;
      },
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.stashStagedSilently']();

  assert.deepEqual(vscodeState.infoMessages, ['No staged changes to stash.']);
});

test('dropAllStashes shows an info message when there are no stashes', async () => {
  const vscodeState = createVscodeState();
  const dropAllCalls = [];

  createStashCommandsModule({
    vscodeState,
    gitMock: {
      async dropAllStashes(repoRoot) {
        dropAllCalls.push(repoRoot);
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
      async dropAllStashes(repoRoot) {
        dropAllCalls.push(repoRoot);
      },
      async getStashes() {
        return [
          { name: 'stash@{0}', isCurrent: false, scope: 'stash' },
          { name: 'stash@{1}', isCurrent: false, scope: 'stash' },
        ];
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

test('popLatestStash shows an info message when there are no stashes', async () => {
  const vscodeState = createVscodeState();
  const popCalls = [];

  createStashCommandsModule({
    vscodeState,
    gitMock: {
      async popStash(repoRoot, stashName) {
        popCalls.push({ repoRoot, stashName });
      },
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.popLatestStash']({
    nodeType: 'section',
    containerScope: 'stash',
    repoRoot: '/repo',
  });

  assert.deepEqual(popCalls, []);
  assert.deepEqual(vscodeState.infoMessages, ['No stashes were found to pop.']);
});

test('applyLatestStash shows an info message when there are no stashes', async () => {
  const vscodeState = createVscodeState();
  const applyCalls = [];

  createStashCommandsModule({
    vscodeState,
    gitMock: {
      async applyStash(repoRoot, stashName) {
        applyCalls.push({ repoRoot, stashName });
      },
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.applyLatestStash']({
    nodeType: 'section',
    containerScope: 'stash',
    repoRoot: '/repo',
  });

  assert.deepEqual(applyCalls, []);
  assert.deepEqual(vscodeState.infoMessages, ['No stashes were found to apply.']);
});

test('popLatestStash pops the latest stash from the stash section and refreshes once', async () => {
  const vscodeState = createVscodeState();
  const popCalls = [];

  const { commandContext } = createStashCommandsModule({
    vscodeState,
    gitMock: {
      async getStashes() {
        return [
          { name: 'stash@{0}', isCurrent: false, scope: 'stash' },
          { name: 'stash@{1}', isCurrent: false, scope: 'stash' },
        ];
      },
      async popStash(repoRoot, stashName) {
        popCalls.push({ repoRoot, stashName });
      },
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.popLatestStash']({
    nodeType: 'section',
    containerScope: 'stash',
    repoRoot: '/repo',
  });

  assert.deepEqual(popCalls, [{ repoRoot: '/repo', stashName: 'stash@{0}' }]);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: "Popped latest stash 'stash@{0}'.",
      options: { fetchRemoteState: false },
    },
  ]);
});

test('applyLatestStash applies the latest stash from the stash section and refreshes once', async () => {
  const vscodeState = createVscodeState();
  const applyCalls = [];

  const { commandContext } = createStashCommandsModule({
    vscodeState,
    gitMock: {
      async applyStash(repoRoot, stashName) {
        applyCalls.push({ repoRoot, stashName });
      },
      async getStashes() {
        return [
          { name: 'stash@{0}', isCurrent: false, scope: 'stash' },
          { name: 'stash@{1}', isCurrent: false, scope: 'stash' },
        ];
      },
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.applyLatestStash']({
    nodeType: 'section',
    containerScope: 'stash',
    repoRoot: '/repo',
  });

  assert.deepEqual(applyCalls, [{ repoRoot: '/repo', stashName: 'stash@{0}' }]);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: "Applied latest stash 'stash@{0}'.",
      options: { fetchRemoteState: false },
    },
  ]);
});
