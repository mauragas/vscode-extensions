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
      async pushBranch() {},
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

test('showAdvancedActions routes the quick-pick selection to the clean repository command', async () => {
  const vscodeState = createVscodeState();
  vscodeState.quickPickSelector = (items) =>
    items.find((item) => item.actionId === 'cleanRepository');

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
      async pushBranch() {},
      async syncBranch() {
        throw new Error('syncBranch should not be called in this test');
      },
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.showAdvancedActions']();

  assert.deepEqual(vscodeState.executedCommands, [
    {
      command: 'gitBranchesPanel.cleanRepository',
      args: [],
    },
  ]);
});

test('pruneMissingUpstreamBranches force deletes stale branches and refreshes once', async () => {
  const vscodeState = createVscodeState();
  vscodeState.warningResponses.push('Prune');

  const fetchRemoteStateCalls = [];
  const deleteBranchCalls = [];

  const { commandContext } = createBulkActionsModule({
    vscodeState,
    gitMock: {
      async deleteBranch(repoRoot, branchName, force) {
        deleteBranchCalls.push({ repoRoot, branchName, force });
      },
      async deleteRemoteBranch() {},
      async deleteTag() {},
      async fetchRemoteState(repoRoot) {
        fetchRemoteStateCalls.push(repoRoot);
      },
      async getBranches() {
        return [
          { name: 'main', isCurrent: true, upstreamName: 'origin/main', upstreamMissing: true },
          { name: 'feature/stale', isCurrent: false, upstreamName: 'origin/feature/stale', upstreamMissing: true },
          { name: 'feature/keep', isCurrent: false, upstreamName: 'origin/feature/keep', upstreamMissing: false },
          { name: 'feature/prune-me-too', isCurrent: false, upstreamName: 'origin/feature/prune-me-too', upstreamMissing: true },
        ];
      },
      async pushBranch() {},
      async syncBranch() {
        throw new Error('syncBranch should not be called in this test');
      },
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.pruneMissingUpstreamBranches']();

  assert.deepEqual(fetchRemoteStateCalls, ['/repo']);
  assert.deepEqual(deleteBranchCalls, [
    { repoRoot: '/repo', branchName: 'feature/stale', force: true },
    { repoRoot: '/repo', branchName: 'feature/prune-me-too', force: true },
  ]);
  assert.deepEqual(commandContext.state.refreshCalls, [{ fetchRemoteState: false }]);
  assert.equal(vscodeState.warningMessages[0].options.modal, true);
  assert.match(vscodeState.warningMessages[0].message, /feature\/stale/);
  assert.match(vscodeState.warningMessages[0].message, /feature\/prune-me-too/);
  assert.match(vscodeState.infoMessages.at(-1), /Pruned 2 local branches/);
});

test('syncFolderBranches only syncs tracked descendants and reports branches that need publishing', async () => {
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
        return [
          {
            name: 'feature/refresh',
            isCurrent: false,
            upstreamName: 'origin/feature/refresh',
            upstreamMissing: false,
          },
          {
            name: 'feature/publish',
            isCurrent: false,
          },
          {
            name: 'feature/tracked-push',
            isCurrent: false,
            upstreamName: 'origin/feature/tracked-push',
            upstreamMissing: false,
          },
        ];
      },
      async pushBranch() {
        throw new Error('pushBranch should not be called in this test');
      },
      async syncBranch(repoRoot, branchName, options) {
        syncBranchCalls.push({ repoRoot, branchName, options });
        return branchName === 'feature/tracked-push'
          ? {
              branchName,
              upstreamName: `origin/${branchName}`,
              didPull: false,
              didPush: true,
              publishedUpstream: false,
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
    {
      kind: 'branch',
      fullName: 'feature/tracked-push',
      label: 'tracked-push',
      path: 'feature/tracked-push',
      info: {
        name: 'feature/tracked-push',
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
      branchName: 'feature/tracked-push',
      options: { refreshRemoteState: false },
    },
  ]);
  assert.deepEqual(commandContext.state.refreshCalls, [
    { fetchRemoteState: true, forceFetchRemoteState: true },
  ]);
  assert.match(vscodeState.warningMessages.at(-1).message, /Processed 2 tracked local branches under 'feature'/);
  assert.match(vscodeState.warningMessages.at(-1).message, /need publishing/);
  assert.match(vscodeState.warningMessages.at(-1).message, /feature\/publish/);
});

test('syncFolderBranches also accepts the local section item to sync all loaded local branches', async () => {
  const vscodeState = createVscodeState();
  const syncBranchCalls = [];

  const { commandContext } = createBulkActionsModule({
    vscodeState,
    gitMock: {
      async deleteBranch() {},
      async deleteRemoteBranch() {},
      async deleteTag() {},
      async fetchRemoteState() {},
      async getBranches() {
        return [
          {
            name: 'feature/one',
            isCurrent: false,
            upstreamName: 'origin/feature/one',
            upstreamMissing: false,
          },
          {
            name: 'feature/two',
            isCurrent: false,
            upstreamName: 'origin/feature/two',
            upstreamMissing: false,
          },
        ];
      },
      async pushBranch() {
        throw new Error('pushBranch should not be called in this test');
      },
      async syncBranch(repoRoot, branchName, options) {
        syncBranchCalls.push({ repoRoot, branchName, options });
        return {
          branchName,
          upstreamName: `origin/${branchName}`,
          didPull: false,
          didPush: false,
          publishedUpstream: false,
        };
      },
    },
  });

  commandContext.state.descendantBranches.set('section:local', [
    {
      kind: 'branch',
      fullName: 'feature/one',
      label: 'one',
      path: 'feature/one',
      info: {
        name: 'feature/one',
        isCurrent: false,
      },
    },
    {
      kind: 'branch',
      fullName: 'feature/two',
      label: 'two',
      path: 'feature/two',
      info: {
        name: 'feature/two',
        isCurrent: false,
      },
    },
  ]);

  await vscodeState.registeredCommands['gitBranchesPanel.syncFolderBranches']({
    nodeType: 'section',
    containerScope: 'local',
    containerKey: 'section:local',
    containerPath: 'section:local',
    repoRoot: '/repo',
    label: 'Local',
  });

  assert.deepEqual(syncBranchCalls, [
    {
      repoRoot: '/repo',
      branchName: 'feature/one',
      options: { refreshRemoteState: false },
    },
    {
      repoRoot: '/repo',
      branchName: 'feature/two',
      options: { refreshRemoteState: false },
    },
  ]);
  assert.match(vscodeState.infoMessages.at(-1), /Local/);
});

test('syncFolderBranches counts failed tracked branches in the processed summary', async () => {
  const vscodeState = createVscodeState();

  createBulkActionsModule({
    vscodeState,
    gitMock: {
      async deleteBranch() {},
      async deleteRemoteBranch() {},
      async deleteTag() {},
      async fetchRemoteState() {},
      async getBranches() {
        return [
          {
            name: 'feature/one',
            isCurrent: false,
            upstreamName: 'origin/feature/one',
            upstreamMissing: false,
          },
          {
            name: 'feature/two',
            isCurrent: false,
            upstreamName: 'origin/feature/two',
            upstreamMissing: false,
          },
        ];
      },
      async pushBranch() {
        throw new Error('pushBranch should not be called in this test');
      },
      async syncBranch(_repoRoot, branchName) {
        throw new Error(`sync failed for ${branchName}`);
      },
    },
  }).commandContext.state.descendantBranches.set('folder:local:feature', [
    {
      kind: 'branch',
      fullName: 'feature/one',
      label: 'one',
      path: 'feature/one',
      info: {
        name: 'feature/one',
        isCurrent: false,
      },
    },
    {
      kind: 'branch',
      fullName: 'feature/two',
      label: 'two',
      path: 'feature/two',
      info: {
        name: 'feature/two',
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

  assert.match(vscodeState.warningMessages.at(-1).message, /Processed 2 tracked local branches under 'feature'/);
  assert.match(vscodeState.warningMessages.at(-1).message, /2 failed/);
});

test('pushFolderBranches pushes tracked branches and publishes unpublished descendants', async () => {
  const vscodeState = createVscodeState();
  vscodeState.warningResponses.push('Push');
  const fetchRemoteStateCalls = [];
  const pushBranchCalls = [];

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
      async pushBranch(repoRoot, branchName, options) {
        pushBranchCalls.push({ repoRoot, branchName, options });
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
              didPull: false,
              didPush: true,
              publishedUpstream: false,
            };
      },
      async syncBranch() {
        throw new Error('syncBranch should not be called in this test');
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

  await vscodeState.registeredCommands['gitBranchesPanel.pushFolderBranches']({
    nodeType: 'folder',
    containerScope: 'local',
    containerKey: 'folder:local:feature',
    containerPath: 'feature',
    repoRoot: '/repo',
    label: 'feature',
  });

  assert.equal(vscodeState.warningMessages[0].options.modal, true);
  assert.deepEqual(fetchRemoteStateCalls, ['/repo']);
  assert.deepEqual(pushBranchCalls, [
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
  assert.match(vscodeState.infoMessages.at(-1), /pushed/);
  assert.match(vscodeState.infoMessages.at(-1), /published/);
});

test('pushFolderBranches counts failed branches in the processed summary', async () => {
  const vscodeState = createVscodeState();
  vscodeState.warningResponses.push('Push');

  const { commandContext } = createBulkActionsModule({
    vscodeState,
    gitMock: {
      async deleteBranch() {},
      async deleteRemoteBranch() {},
      async deleteTag() {},
      async fetchRemoteState() {},
      async getBranches() {
        return [];
      },
      async pushBranch(_repoRoot, branchName) {
        throw new Error(`push failed for ${branchName}`);
      },
      async syncBranch() {
        throw new Error('syncBranch should not be called in this test');
      },
    },
  });

  commandContext.state.descendantBranches.set('folder:local:feature', [
    {
      kind: 'branch',
      fullName: 'feature/one',
      label: 'one',
      path: 'feature/one',
      info: {
        name: 'feature/one',
        isCurrent: false,
      },
    },
    {
      kind: 'branch',
      fullName: 'feature/two',
      label: 'two',
      path: 'feature/two',
      info: {
        name: 'feature/two',
        isCurrent: false,
      },
    },
  ]);

  await vscodeState.registeredCommands['gitBranchesPanel.pushFolderBranches']({
    nodeType: 'folder',
    containerScope: 'local',
    containerKey: 'folder:local:feature',
    containerPath: 'feature',
    repoRoot: '/repo',
    label: 'feature',
  });

  assert.match(vscodeState.warningMessages.at(-1).message, /Processed 2 local branches under 'feature'/);
  assert.match(vscodeState.warningMessages.at(-1).message, /2 failed/);
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
      async pushBranch() {
        throw new Error('pushBranch should not be called in this test');
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

test('deleteFolderBranches reports current-only folders without claiming they are empty', async () => {
  const vscodeState = createVscodeState();
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
      async pushBranch() {
        throw new Error('pushBranch should not be called in this test');
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
  ]);

  await vscodeState.registeredCommands['gitBranchesPanel.deleteFolderBranches']({
    nodeType: 'folder',
    containerScope: 'local',
    containerKey: 'folder:local:feature',
    containerPath: 'feature',
    repoRoot: '/repo',
    label: 'feature',
  });

  assert.deepEqual(deleteBranchCalls, []);
  assert.deepEqual(commandContext.state.refreshCalls, []);
  assert.equal(vscodeState.warningMessages.length, 0);
  assert.match(vscodeState.infoMessages.at(-1), /No non-current local branches were found under 'feature'/);
  assert.match(vscodeState.infoMessages.at(-1), /Skipped current branch: feature\/current/);
});
