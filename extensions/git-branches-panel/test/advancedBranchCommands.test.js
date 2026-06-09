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
    configuration: {
      'advanced.enableForcePushWithLease': true,
      'advanced.defaultResetMode': 'mixed',
      'advanced.allowNonCurrentBranchRebase': true,
      'advanced.rebaseAutostash': true,
    },
    registeredCommands: {},
    executedCommands: [],
    quickPickRequests: [],
    quickPickResponses: [],
    warningMessages: [],
    warningResponses: [],
    infoMessages: [],
    infoResponses: [],
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
    workspace: {
      getConfiguration(section) {
        assert.equal(section, 'gitBranchesPanel');

        return {
          get(key, defaultValue) {
            return Object.prototype.hasOwnProperty.call(state.configuration, key)
              ? state.configuration[key]
              : defaultValue;
          },
          inspect() {
            return undefined;
          },
        };
      },
    },
    window: {
      async showQuickPick(items, options) {
        state.quickPickRequests.push({ items, options });
        const response = state.quickPickResponses.shift();
        if (typeof response === 'function') {
          return response(items, options);
        }

        return response;
      },
      async showWarningMessage(message, options, ...items) {
        state.warningMessages.push({ message, options, items });
        return state.warningResponses.shift();
      },
      async showInformationMessage(message, ...items) {
        state.infoMessages.push({ message, items });
        const response = state.infoResponses.shift();
        if (typeof response === 'function') {
          return response(message, items);
        }

        return response;
      },
    },
  };
}

function createCommandContext() {
  const state = {
    currentBranch: undefined,
    refreshCalls: [],
    successRefreshes: [],
    commandErrors: [],
  };

  return {
    state,
    context: {
      provider: {},
      activationTracker: {},
      async refresh(options = {}) {
        state.refreshCalls.push(options);
      },
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

function createAdvancedBranchCommandsModule({ vscodeState, gitMock }) {
  const commandContext = createCommandContext();
  const advancedBranchCommands = loadFresh('../out/commands/advancedBranchCommands.js', {
    vscode: createVscodeMock(vscodeState),
    '../git': gitMock,
    '../treeProvider': {
      BranchTreeItem: class BranchTreeItem {},
    },
    './shared': {
      NO_CURRENT_BRANCH_MESSAGE: 'No current git branch was found.',
    },
  });

  advancedBranchCommands.registerAdvancedBranchCommands({ subscriptions: [] }, commandContext.context);

  return {
    commandContext,
  };
}

test('showAdvancedBranchOperations routes the quick-pick selection to resetCurrentToSelected', async () => {
  const vscodeState = createVscodeState();
  vscodeState.quickPickResponses = [
    (items) => items.find((item) => item.label.includes('Reset Current to Selected')),
  ];

  const { commandContext } = createAdvancedBranchCommandsModule({
    vscodeState,
    gitMock: {
      async forcePushBranch() {
        throw new Error('forcePushBranch should not be called in this test');
      },
      async getGitOperationState() {
        return { inProgress: false };
      },
      async getWorkingTreeStatus() {
        return { hasStagedChanges: false, hasUnstagedChanges: false, hasUntrackedFiles: false, isDirty: false };
      },
      async rebaseBranchOnto() {},
      async resetCurrentBranchToRef() {},
      async squashMergeIntoCurrent() {},
    },
  });
  commandContext.state.currentBranch = {
    name: 'main',
    isCurrent: true,
  };

  await vscodeState.registeredCommands['gitBranchesPanel.showAdvancedBranchOperations']({
    nodeType: 'branch',
    branchName: 'feature/demo',
    repoRoot: '/repo',
    branchInfo: {
      name: 'feature/demo',
      isCurrent: false,
    },
  });

  assert.equal(vscodeState.executedCommands.length, 1);
  assert.equal(vscodeState.executedCommands[0].command, 'gitBranchesPanel.resetCurrentToSelected');
  assert.equal(vscodeState.executedCommands[0].args[0].branchName, 'feature/demo');
});

test('resetCurrentToSelected prompts for the mode, resets the branch, and refreshes on success', async () => {
  const vscodeState = createVscodeState();
  vscodeState.quickPickResponses = [
    (items) => items.find((item) => item.mode === 'hard'),
  ];
  vscodeState.warningResponses = ['Reset'];
  const resetCalls = [];

  const { commandContext } = createAdvancedBranchCommandsModule({
    vscodeState,
    gitMock: {
      async forcePushBranch() {
        throw new Error('forcePushBranch should not be called in this test');
      },
      async getGitOperationState() {
        return { inProgress: false };
      },
      async getWorkingTreeStatus() {
        return { hasStagedChanges: false, hasUnstagedChanges: false, hasUntrackedFiles: false, isDirty: false };
      },
      async rebaseBranchOnto() {},
      async resetCurrentBranchToRef(repoRoot, refName, mode) {
        resetCalls.push({ repoRoot, refName, mode });
      },
      async squashMergeIntoCurrent() {},
    },
  });
  commandContext.state.currentBranch = {
    name: 'main',
    isCurrent: true,
  };

  await vscodeState.registeredCommands['gitBranchesPanel.resetCurrentToSelected']({
    nodeType: 'branch',
    branchName: 'feature/demo',
    repoRoot: '/repo',
    branchInfo: {
      name: 'feature/demo',
      isCurrent: false,
    },
  });

  assert.deepEqual(resetCalls, [
    {
      repoRoot: '/repo',
      refName: 'feature/demo',
      mode: 'hard',
    },
  ]);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: "Reset current branch 'main' to 'feature/demo' with --hard.",
      options: { fetchRemoteState: false },
    },
  ]);
});

test('forcePushWithLease confirms and refreshes remote state after the push', async () => {
  const vscodeState = createVscodeState();
  vscodeState.warningResponses = ['Force Push with Lease'];
  const forcePushCalls = [];

  const { commandContext } = createAdvancedBranchCommandsModule({
    vscodeState,
    gitMock: {
      async forcePushBranch(repoRoot, branchName) {
        forcePushCalls.push({ repoRoot, branchName });
        return {
          branchName,
          upstreamName: `origin/${branchName}`,
          didPull: false,
          didPush: true,
          publishedUpstream: false,
        };
      },
      async getGitOperationState() {
        return { inProgress: false };
      },
      async getWorkingTreeStatus() {
        return { hasStagedChanges: false, hasUnstagedChanges: false, hasUntrackedFiles: false, isDirty: false };
      },
      async rebaseBranchOnto() {},
      async resetCurrentBranchToRef() {},
      async squashMergeIntoCurrent() {},
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.forcePushWithLease']({
    nodeType: 'branch',
    branchName: 'feature/demo',
    repoRoot: '/repo',
    branchInfo: {
      name: 'feature/demo',
      isCurrent: false,
      upstreamName: 'origin/feature/demo',
      upstreamMissing: false,
    },
  });

  assert.deepEqual(forcePushCalls, [{ repoRoot: '/repo', branchName: 'feature/demo' }]);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: "Force-pushed 'feature/demo' to 'origin/feature/demo' with lease.",
      options: { fetchRemoteState: true, forceFetchRemoteState: true },
    },
  ]);
});

test('rebaseCurrentOntoSelected offers autostash for dirty working trees and rebases with it', async () => {
  const vscodeState = createVscodeState();
  vscodeState.quickPickResponses = [
    (items) => items.find((item) => item.autostash === true),
  ];
  vscodeState.warningResponses = ['Rebase'];
  const rebaseCalls = [];

  const { commandContext } = createAdvancedBranchCommandsModule({
    vscodeState,
    gitMock: {
      async forcePushBranch() {
        throw new Error('forcePushBranch should not be called in this test');
      },
      async getGitOperationState() {
        return { inProgress: false };
      },
      async getWorkingTreeStatus() {
        return { hasStagedChanges: false, hasUnstagedChanges: true, hasUntrackedFiles: true, isDirty: true };
      },
      async rebaseBranchOnto(repoRoot, branchName, ontoRef, options) {
        rebaseCalls.push({ repoRoot, branchName, ontoRef, options });
      },
      async resetCurrentBranchToRef() {},
      async squashMergeIntoCurrent() {},
    },
  });
  commandContext.state.currentBranch = {
    name: 'main',
    isCurrent: true,
  };

  await vscodeState.registeredCommands['gitBranchesPanel.rebaseCurrentOntoSelected']({
    nodeType: 'branch',
    branchName: 'origin/release',
    repoRoot: '/repo',
    branchInfo: {
      name: 'origin/release',
      isCurrent: false,
      scope: 'remote',
    },
  });

  assert.deepEqual(rebaseCalls, [
    {
      repoRoot: '/repo',
      branchName: 'main',
      ontoRef: 'origin/release',
      options: { autostash: true },
    },
  ]);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: "Rebased current branch 'main' onto 'origin/release'.",
      options: { fetchRemoteState: false },
    },
  ]);
});

test('squashMergeIntoCurrent stops when another git operation is already in progress', async () => {
  const vscodeState = createVscodeState();
  const squashCalls = [];

  const { commandContext } = createAdvancedBranchCommandsModule({
    vscodeState,
    gitMock: {
      async forcePushBranch() {
        throw new Error('forcePushBranch should not be called in this test');
      },
      async getGitOperationState() {
        return { inProgress: true, message: 'A rebase is already in progress for this repository.' };
      },
      async getWorkingTreeStatus() {
        return { hasStagedChanges: false, hasUnstagedChanges: false, hasUntrackedFiles: false, isDirty: false };
      },
      async rebaseBranchOnto() {},
      async resetCurrentBranchToRef() {},
      async squashMergeIntoCurrent(repoRoot, refName) {
        squashCalls.push({ repoRoot, refName });
      },
    },
  });
  commandContext.state.currentBranch = {
    name: 'main',
    isCurrent: true,
  };

  await vscodeState.registeredCommands['gitBranchesPanel.squashMergeIntoCurrent']({
    nodeType: 'branch',
    branchName: 'feature/demo',
    repoRoot: '/repo',
    branchInfo: {
      name: 'feature/demo',
      isCurrent: false,
    },
  });

  assert.deepEqual(squashCalls, []);
  assert.match(vscodeState.warningMessages[0].message, /rebase is already in progress/i);
});
