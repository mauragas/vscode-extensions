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
    errorMessages: [],
    warningResponses: [],
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
      async executeCommand(command, ...args) {
        state.executedCommands.push({ command, args });
      },
    },
    window: {
      async showQuickPick(items, options) {
        state.quickPickRequests.push({ items, options });
        return typeof state.quickPickSelector === 'function'
          ? state.quickPickSelector(items, options)
          : undefined;
      },
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
    refreshCalls: [],
    repoRoot: '/repo',
    descendantBranches: new Map(),
    commandErrors: [],
  };

  return {
    state,
    context: {
      provider: {
        getDescendantBranches(containerKey) {
          return state.descendantBranches.get(containerKey) ?? [];
        },
      },
      activationTracker: {},
      async refresh(options = {}) {
        state.refreshCalls.push(options);
      },
      async requireRepoRoot() {
        return state.repoRoot;
      },
      async requireCurrentBranch() {
        return undefined;
      },
      async showSuccessAndRefresh() {},
      showCommandError(prefix, error) {
        state.commandErrors.push({
          prefix,
          message: error instanceof Error ? error.message : String(error),
        });
      },
    },
  };
}

function createBulkActionsModule({ vscodeState, gitMock }) {
  const commandContext = createCommandContext();
  const bulkActions = loadFresh('../out/commands/bulkActions.js', {
    vscode: createVscodeMock(vscodeState),
    '../errorUtils': {
      getErrorMessage(error) {
        return error instanceof Error ? error.message : String(error);
      },
    },
    '../extensionHelpers': {
      looksLikeMergeSafetyError(message) {
        return /not fully merged/i.test(message);
      },
    },
    '../git': gitMock,
  });

  bulkActions.registerBulkActionCommands({ subscriptions: [] }, commandContext.context);

  return {
    bulkActions,
    commandContext,
  };
}

test('showAdvancedActions routes the quick-pick selection to the prune command', async () => {
  const vscodeState = createVscodeState();
  vscodeState.quickPickSelector = (items) =>
    items.find((item) => item.actionId === 'pruneMissingUpstream');

  createBulkActionsModule({
    vscodeState,
    gitMock: {
      async deleteBranch() {},
      async deleteRemoteBranch() {},
      async deleteTag() {},
      async fetchRemoteState() {},
      async getBranches() {
        return [];
      },
      async syncBranch() {
        throw new Error('syncBranch should not be called in this test');
      },
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.showAdvancedActions']();

  assert.equal(vscodeState.quickPickRequests.length, 1);
  assert.deepEqual(vscodeState.executedCommands, [
    {
      command: 'gitBranchesPanel.pruneMissingUpstreamBranches',
      args: [],
    },
  ]);
});

test('pruneMissingUpstreamBranches filters candidates, skips merge-protected branches, and refreshes once', async () => {
  const vscodeState = createVscodeState();
  vscodeState.warningResponses.push('Prune');

  const fetchRemoteStateCalls = [];
  const deleteBranchCalls = [];

  const { commandContext } = createBulkActionsModule({
    vscodeState,
    gitMock: {
      async deleteBranch(repoRoot, branchName) {
        deleteBranchCalls.push({ repoRoot, branchName });
        if (branchName === 'feature/merge-protected') {
          throw new Error('branch is not fully merged');
        }
      },
      async deleteRemoteBranch() {},
      async deleteTag() {},
      async fetchRemoteState(repoRoot) {
        fetchRemoteStateCalls.push(repoRoot);
      },
      async getBranches() {
        return [
          { name: 'main', isCurrent: true, upstreamMissing: true },
          { name: 'feature/stale', isCurrent: false, upstreamMissing: true },
          { name: 'feature/keep', isCurrent: false, upstreamMissing: false },
          { name: 'feature/merge-protected', isCurrent: false, upstreamMissing: true },
        ];
      },
      async syncBranch() {
        throw new Error('syncBranch should not be called in this test');
      },
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.pruneMissingUpstreamBranches']();

  assert.deepEqual(fetchRemoteStateCalls, ['/repo']);
  assert.deepEqual(deleteBranchCalls, [
    { repoRoot: '/repo', branchName: 'feature/stale' },
    { repoRoot: '/repo', branchName: 'feature/merge-protected' },
  ]);
  assert.deepEqual(commandContext.state.refreshCalls, [{ fetchRemoteState: false }]);
  assert.equal(vscodeState.warningMessages[0].options.modal, true);
  assert.match(vscodeState.warningMessages[0].message, /feature\/stale/);
  assert.match(vscodeState.warningMessages.at(-1).message, /Pruned 1 local branch/);
  assert.match(vscodeState.warningMessages.at(-1).message, /feature\/merge-protected/);
});

test('syncFolderBranches fetches once, syncs each descendant branch, and refreshes remote state after pushes', async () => {
  const vscodeState = createVscodeState();
  const fetchRemoteStateCalls = [];
  const syncBranchCalls = [];

  const { commandContext } = createBulkActionsModule({
    vscodeState,
    gitMock: {
      async deleteBranch() {},
      async deleteRemoteBranch() {},
      async deleteTag() {},
      async fetchRemoteState(repoRoot) {
        fetchRemoteStateCalls.push(repoRoot);
      },
      async getBranches() {
        return [];
      },
      async syncBranch(repoRoot, branchName, options) {
        syncBranchCalls.push({ repoRoot, branchName, options });
        return branchName === 'feature/publish'
          ? {
              branchName,
              upstreamName: `origin/${branchName}`,
              didPull: false,
              didPush: true,
              publishedUpstream: true,
            }
          : {
              branchName,
              upstreamName: `origin/${branchName}`,
              didPull: true,
              didPush: false,
              publishedUpstream: false,
            };
      },
    },
  });

  commandContext.state.descendantBranches.set('folder:local:feature', [
    {
      kind: 'branch',
      fullName: 'feature/refresh',
      label: 'refresh',
      path: 'feature/refresh',
      info: {
        name: 'feature/refresh',
        isCurrent: false,
      },
    },
    {
      kind: 'branch',
      fullName: 'feature/publish',
      label: 'publish',
      path: 'feature/publish',
      info: {
        name: 'feature/publish',
        isCurrent: false,
      },
    },
  ]);

  await vscodeState.registeredCommands['gitBranchesPanel.syncFolderBranches']({
    nodeType: 'folder',
    containerScope: 'local',
    containerKey: 'folder:local:feature',
    containerPath: 'feature',
    repoRoot: '/repo',
    label: 'feature',
  });

  assert.deepEqual(fetchRemoteStateCalls, ['/repo']);
  assert.deepEqual(syncBranchCalls, [
    {
      repoRoot: '/repo',
      branchName: 'feature/refresh',
      options: { refreshRemoteState: false },
    },
    {
      repoRoot: '/repo',
      branchName: 'feature/publish',
      options: { refreshRemoteState: false },
    },
  ]);
  assert.deepEqual(commandContext.state.refreshCalls, [
    { fetchRemoteState: true, forceFetchRemoteState: true },
  ]);
  assert.match(vscodeState.infoMessages.at(-1), /Processed 2 local branches under 'feature'/);
  assert.match(vscodeState.infoMessages.at(-1), /published upstream/);
});

test('deleteFolderBranches confirms once, skips the current branch, and refreshes after deletions', async () => {
  const vscodeState = createVscodeState();
  vscodeState.warningResponses.push('Delete');

  const deleteBranchCalls = [];

  const { commandContext } = createBulkActionsModule({
    vscodeState,
    gitMock: {
      async deleteBranch(repoRoot, branchName) {
        deleteBranchCalls.push({ repoRoot, branchName });
      },
      async deleteRemoteBranch() {},
      async deleteTag() {},
      async fetchRemoteState() {},
      async getBranches() {
        return [];
      },
      async syncBranch() {
        throw new Error('syncBranch should not be called in this test');
      },
    },
  });

  commandContext.state.descendantBranches.set('folder:local:feature', [
    {
      kind: 'branch',
      fullName: 'feature/current',
      label: 'current',
      path: 'feature/current',
      info: {
        name: 'feature/current',
        isCurrent: true,
      },
    },
    {
      kind: 'branch',
      fullName: 'feature/old',
      label: 'old',
      path: 'feature/old',
      info: {
        name: 'feature/old',
        isCurrent: false,
      },
    },
  ]);

  await vscodeState.registeredCommands['gitBranchesPanel.deleteFolderBranches']({
    nodeType: 'folder',
    containerScope: 'local',
    containerKey: 'folder:local:feature',
    containerPath: 'feature',
    repoRoot: '/repo',
    label: 'feature',
  });

  assert.equal(vscodeState.warningMessages[0].options.modal, true);
  assert.match(vscodeState.warningMessages[0].message, /current branch will be skipped automatically/i);
  assert.deepEqual(deleteBranchCalls, [{ repoRoot: '/repo', branchName: 'feature/old' }]);
  assert.deepEqual(commandContext.state.refreshCalls, [{ fetchRemoteState: false }]);
  assert.match(vscodeState.infoMessages.at(-1), /Deleted 1 local branch under 'feature'/);
  assert.match(vscodeState.infoMessages.at(-1), /Skipped current branch: feature\/current/);
});
