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
    inputBoxRequests: [],
    inputBoxResponse: undefined,
    infoMessages: [],
    warningMessages: [],
    errorMessages: [],
  };
}

function createVscodeMock(state) {
  return {
    commands: {
      registerCommand(name, callback) {
        state.registeredCommands[name] = callback;
        return { dispose() {} };
      },
      async executeCommand() {
        return undefined;
      },
    },
    env: {
      clipboard: {
        async writeText() {},
      },
    },
    extensions: {
      getExtension() {
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
      async showInputBox(options) {
        state.inputBoxRequests.push(options);
        return state.inputBoxResponse;
      },
      async showInformationMessage(message) {
        state.infoMessages.push(message);
        return undefined;
      },
      async showWarningMessage(message) {
        state.warningMessages.push(message);
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
    successRefreshes: [],
    commandErrors: [],
  };

  return {
    state,
    context: {
      provider: {},
      activationTracker: {
        shouldCheckout() {
          return false;
        },
        reset() {},
      },
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

function createBranchCommandsModule({ vscodeState, gitMock, validateSpy }) {
  const commandContext = createCommandContext();
  const branchCommands = loadFresh('../out/commands/branchCommands.js', {
    vscode: createVscodeMock(vscodeState),
    '../errorUtils': {
      getErrorMessage(error) {
        return error instanceof Error ? error.message : String(error);
      },
    },
    '../extensionHelpers': {
      buildCurrentBranchAlreadyCheckedOutMessage(branchName) {
        return `Already on '${branchName}'.`;
      },
      buildRemoteBranchCheckoutMessage() {
        return 'remote';
      },
      buildSyncResultMessage() {
        return 'sync';
      },
      looksLikeMergeSafetyError() {
        return false;
      },
      validateBranchName(value, currentName) {
        validateSpy.push({ value, currentName });
        return undefined;
      },
    },
    '../git': gitMock,
    '../treeProvider': {
      BranchTreeItem: class BranchTreeItem {},
    },
    './shared': {
      NO_CURRENT_BRANCH_MESSAGE: 'No current branch',
    },
  });

  branchCommands.registerBranchDomainCommands({ subscriptions: [] }, commandContext.context);

  return {
    commandContext,
  };
}

test('newBranchFromSelected creates a branch from a local branch without checkout', async () => {
  const vscodeState = createVscodeState();
  vscodeState.inputBoxResponse = 'feature/child';
  const validateSpy = [];
  const createBranchFromRefCalls = [];

  const { commandContext } = createBranchCommandsModule({
    vscodeState,
    validateSpy,
    gitMock: {
      async checkoutBranch() {},
      async checkoutRemoteBranch() {},
      async createBranch() {},
      async createBranchFromRef(repoRoot, branchName, startPoint, options) {
        createBranchFromRefCalls.push({ repoRoot, branchName, startPoint, options });
      },
      async deleteBranch() {},
      async deleteRemoteBranch() {},
      async getDiffFilesBetweenRefs() {
        return [];
      },
      async mergeBranchIntoCurrent() {},
      async renameBranch() {},
      async syncBranch() {
        return { branchName: 'main', upstreamName: 'origin/main', didPull: false, didPush: false, publishedUpstream: false };
      },
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.newBranchFromSelected']({
    nodeType: 'branch',
    branchName: 'feature/source',
    repoRoot: '/repo',
  });

  assert.match(vscodeState.inputBoxRequests[0].prompt, /feature\/source/);
  assert.equal(await vscodeState.inputBoxRequests[0].validateInput('feature/child'), undefined);
  assert.deepEqual(validateSpy, [{ value: 'feature/child', currentName: 'feature/source' }]);
  assert.deepEqual(createBranchFromRefCalls, [
    {
      repoRoot: '/repo',
      branchName: 'feature/child',
      startPoint: 'feature/source',
      options: { checkout: false },
    },
  ]);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: "Created branch 'feature/child' from 'feature/source'.",
      options: { fetchRemoteState: false },
    },
  ]);
});

test('newBranchFromSelectedAndCheckout creates and checks out a branch from a remote branch', async () => {
  const vscodeState = createVscodeState();
  vscodeState.inputBoxResponse = 'feature/from-remote';
  const validateSpy = [];
  const createBranchFromRefCalls = [];

  const { commandContext } = createBranchCommandsModule({
    vscodeState,
    validateSpy,
    gitMock: {
      async checkoutBranch() {},
      async checkoutRemoteBranch() {},
      async createBranch() {},
      async createBranchFromRef(repoRoot, branchName, startPoint, options) {
        createBranchFromRefCalls.push({ repoRoot, branchName, startPoint, options });
      },
      async deleteBranch() {},
      async deleteRemoteBranch() {},
      async getDiffFilesBetweenRefs() {
        return [];
      },
      async mergeBranchIntoCurrent() {},
      async renameBranch() {},
      async syncBranch() {
        return { branchName: 'main', upstreamName: 'origin/main', didPull: false, didPush: false, publishedUpstream: false };
      },
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.newBranchFromSelectedAndCheckout']({
    nodeType: 'remoteBranch',
    branchName: 'origin/feature/source',
    repoRoot: '/repo',
  });

  assert.equal(
    await vscodeState.inputBoxRequests[0].validateInput('feature/from-remote'),
    undefined
  );
  assert.deepEqual(validateSpy, [{ value: 'feature/from-remote', currentName: undefined }]);
  assert.deepEqual(createBranchFromRefCalls, [
    {
      repoRoot: '/repo',
      branchName: 'feature/from-remote',
      startPoint: 'origin/feature/source',
      options: { checkout: true },
    },
  ]);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: "Created and switched to 'feature/from-remote' from 'origin/feature/source'.",
      options: { fetchRemoteState: false },
    },
  ]);
});
