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
    executedCommands: [],
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
      async executeCommand(command, ...args) {
        state.executedCommands.push({ command, args });
        return undefined;
      },
    },
    Uri: {
      file(value) {
        return { fsPath: value, path: value };
      },
      from(value) {
        return value;
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
    currentBranch: undefined,
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

function createBaseGitMock(overrides = {}) {
  return {
    async applyStash() {},
    async dropAllStashes() {},
    async dropStash() {},
    async getDiffFilesBetweenRefs() {
      return [];
    },
    async getStashes() {
      return [];
    },
    async popStash() {},
    async renameStash() {},
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
  getGitApiImpl,
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
      getGitApi: getGitApiImpl ?? (async () => undefined),
      NO_CURRENT_BRANCH_MESSAGE: 'No current branch',
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

test('stashSilently uses the provider repo when invoked without an SCM target', async () => {
  const vscodeState = createVscodeState();
  const stashCalls = [];
  const resolveCalls = [];

  const { commandContext } = createStashCommandsModule({
    vscodeState,
    resolveRepoRootFromScmContextImpl: async (target) => {
      resolveCalls.push(target);
      return '/wrong-repo';
    },
    gitMock: {
      async stashSilently(repoRoot) {
        stashCalls.push(repoRoot);
        return true;
      },
    },
  });
  commandContext.state.repoRoot = '/fallback-repo';

  await vscodeState.registeredCommands['gitBranchesPanel.stashSilently']();

  assert.deepEqual(resolveCalls, []);
  assert.deepEqual(stashCalls, ['/fallback-repo']);
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

test('renameStash prompts for a new stash message and refreshes once', async () => {
  const vscodeState = createVscodeState();
  vscodeState.inputBoxResponse = 'Hotfix prep';
  const renameCalls = [];

  const { commandContext } = createStashCommandsModule({
    vscodeState,
    gitMock: {
      async renameStash(repoRoot, stashIdentifier, message) {
        renameCalls.push({ repoRoot, stashIdentifier, message });
      },
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.renameStash']({
    nodeType: 'stash',
    branchName: 'stash@{1}',
    repoRoot: '/repo',
    branchInfo: {
      lastCommit: 'On main: Release prep',
      stashRevision: 'abc123',
    },
  });

  assert.match(vscodeState.inputBoxRequests[0].prompt, /stash@\{1\}/);
  assert.equal(vscodeState.inputBoxRequests[0].value, 'Release prep');
  assert.equal(
    await vscodeState.inputBoxRequests[0].validateInput('Release prep'),
    'Please enter a different stash message.'
  );
  assert.equal(
    await vscodeState.inputBoxRequests[0].validateInput('   '),
    'Stash message cannot be empty.'
  );
  assert.deepEqual(renameCalls, [
    {
      repoRoot: '/repo',
      stashIdentifier: 'abc123',
      message: 'Hotfix prep',
    },
  ]);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: "Renamed stash 'stash@{1}' to 'Hotfix prep'.",
      options: { fetchRemoteState: false },
    },
  ]);
});

test('compareStashWithCurrent opens a multi diff editor for stash changes', async () => {
  const vscodeState = createVscodeState();
  const diffCalls = [];

  const { commandContext } = createStashCommandsModule({
    vscodeState,
    getGitApiImpl: async () => ({
      getRepository() {
        return {
          rootUri: {
            fsPath: '/repo',
            path: '/repo',
          },
        };
      },
      toGitUri(uri, ref) {
        return {
          fsPath: uri.fsPath,
          path: `${uri.path}@${ref}`,
          ref,
        };
      },
    }),
    gitMock: {
      async getDiffFilesBetweenRefs(repoRoot, leftRef, rightRef) {
        diffCalls.push({ repoRoot, leftRef, rightRef });
        return [
          { status: 'M', path: 'README.md' },
          { status: 'A', path: 'stash-only.txt' },
        ];
      },
    },
  });
  commandContext.state.currentBranch = {
    name: 'main',
    isCurrent: true,
    scope: 'local',
  };

  await vscodeState.registeredCommands['gitBranchesPanel.compareStashWithCurrent']({
    nodeType: 'stash',
    branchName: 'stash@{0}',
    repoRoot: '/repo',
    branchInfo: {
      stashRevision: 'stash-sha',
    },
  });

  assert.deepEqual(diffCalls, [{ repoRoot: '/repo', leftRef: 'main', rightRef: 'stash-sha' }]);
  assert.equal(vscodeState.executedCommands.length, 1);
  assert.equal(vscodeState.executedCommands[0].command, '_workbench.openMultiDiffEditor');
  assert.equal(
    vscodeState.executedCommands[0].args[0].title,
    "Compare stash 'stash@{0}' with current 'main'"
  );
  assert.equal(
    vscodeState.executedCommands[0].args[0].multiDiffSourceUri.path,
    '/repo/main..stash@{0}'
  );
  assert.deepEqual(vscodeState.executedCommands[0].args[0].resources, [
    {
      originalUri: {
        fsPath: '/repo/README.md',
        path: '/repo/README.md@main',
        ref: 'main',
      },
      modifiedUri: {
        fsPath: '/repo/README.md',
        path: '/repo/README.md@stash-sha',
        ref: 'stash-sha',
      },
    },
    {
      modifiedUri: {
        fsPath: '/repo/stash-only.txt',
        path: '/repo/stash-only.txt@stash-sha',
        ref: 'stash-sha',
      },
    },
  ]);
});
