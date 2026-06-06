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
    configurationValues: {
      normalizeNewBranchNames: false,
    },
    registeredCommands: {},
    executedCommands: [],
    inputBoxRequests: [],
    inputBoxResponse: undefined,
    infoMessages: [],
    quickPickRequests: [],
    quickPickSelector: undefined,
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
      async executeCommand(command, ...args) {
        state.executedCommands.push({ command, args });
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
    workspace: {
      getConfiguration(section) {
        return {
          get(key, defaultValue) {
            if (
              section === 'gitBranchesPanel' &&
              Object.prototype.hasOwnProperty.call(state.configurationValues, key)
            ) {
              return state.configurationValues[key];
            }

            return defaultValue;
          },
        };
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
    currentBranch: undefined,
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

function createBranchCommandsModule({
  vscodeState,
  gitMock,
  validateSpy,
  normalizeSpy = [],
  normalizeImpl = (value) => value.trim(),
}) {
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
      normalizeBranchName(value) {
        normalizeSpy.push(value);
        return normalizeImpl(value);
      },
      validateBranchName(value, currentName, options) {
        validateSpy.push({ value, currentName, options });
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

test('newBranch keeps the entered branch name unchanged when normalization is disabled', async () => {
  const vscodeState = createVscodeState();
  vscodeState.inputBoxResponse = ' Feature/make-Fix ';
  const validateSpy = [];
  const normalizeSpy = [];
  const createBranchCalls = [];

  const { commandContext } = createBranchCommandsModule({
    vscodeState,
    validateSpy,
    normalizeSpy,
    gitMock: {
      async checkoutBranch() {},
      async checkoutRemoteBranch() {},
      async createBranch(repoRoot, branchName) {
        createBranchCalls.push({ repoRoot, branchName });
      },
      async createBranchFromRef() {},
      async deleteBranch() {},
      async deleteRemoteBranch() {},
      async getDiffFilesBetweenRefs() {
        return [];
      },
      async mergeBranchIntoCurrent() {},
      async pushBranch() {
        return {
          branchName: 'main',
          upstreamName: 'origin/main',
          didPull: false,
          didPush: false,
          publishedUpstream: false,
        };
      },
      async renameBranch() {},
      async syncBranch() {
        return {
          branchName: 'main',
          upstreamName: 'origin/main',
          didPull: false,
          didPush: false,
          publishedUpstream: false,
        };
      },
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.newBranch']();

  assert.equal(await vscodeState.inputBoxRequests[0].validateInput(' Feature/make-Fix '), undefined);
  assert.deepEqual(validateSpy, [
    {
      value: ' Feature/make-Fix ',
      currentName: undefined,
      options: { normalize: false },
    },
  ]);
  assert.deepEqual(normalizeSpy, []);
  assert.deepEqual(createBranchCalls, [{ repoRoot: '/repo', branchName: 'Feature/make-Fix' }]);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: "Created and switched to 'Feature/make-Fix'.",
      options: {},
    },
  ]);
});

test('newBranch normalizes the created branch name when the setting is enabled', async () => {
  const vscodeState = createVscodeState();
  vscodeState.configurationValues.normalizeNewBranchNames = true;
  vscodeState.inputBoxResponse = ' Feature/make Fix ';
  const validateSpy = [];
  const normalizeSpy = [];
  const createBranchCalls = [];

  const { commandContext } = createBranchCommandsModule({
    vscodeState,
    validateSpy,
    normalizeSpy,
    normalizeImpl() {
      return 'feature/make-fix';
    },
    gitMock: {
      async checkoutBranch() {},
      async checkoutRemoteBranch() {},
      async createBranch(repoRoot, branchName) {
        createBranchCalls.push({ repoRoot, branchName });
      },
      async createBranchFromRef() {},
      async deleteBranch() {},
      async deleteRemoteBranch() {},
      async getDiffFilesBetweenRefs() {
        return [];
      },
      async mergeBranchIntoCurrent() {},
      async pushBranch() {
        return {
          branchName: 'main',
          upstreamName: 'origin/main',
          didPull: false,
          didPush: false,
          publishedUpstream: false,
        };
      },
      async renameBranch() {},
      async syncBranch() {
        return {
          branchName: 'main',
          upstreamName: 'origin/main',
          didPull: false,
          didPush: false,
          publishedUpstream: false,
        };
      },
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.newBranch']();

  assert.equal(await vscodeState.inputBoxRequests[0].validateInput(' Feature/make Fix '), undefined);
  assert.deepEqual(validateSpy, [
    {
      value: ' Feature/make Fix ',
      currentName: undefined,
      options: { normalize: true },
    },
  ]);
  assert.deepEqual(normalizeSpy, [' Feature/make Fix ']);
  assert.deepEqual(createBranchCalls, [{ repoRoot: '/repo', branchName: 'feature/make-fix' }]);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: "Created and switched to 'feature/make-fix'.",
      options: {},
    },
  ]);
});

test('newBranchFromSelected creates a branch from a local branch without checkout', async () => {
  const vscodeState = createVscodeState();
  vscodeState.inputBoxResponse = ' feature/child ';
  const validateSpy = [];
  const normalizeSpy = [];
  const createBranchFromRefCalls = [];

  const { commandContext } = createBranchCommandsModule({
    vscodeState,
    validateSpy,
    normalizeSpy,
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
      async pushBranch() {
        return { branchName: 'main', upstreamName: 'origin/main', didPull: false, didPush: false, publishedUpstream: false };
      },
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
  assert.equal(await vscodeState.inputBoxRequests[0].validateInput(' feature/child '), undefined);
  assert.deepEqual(validateSpy, [
    {
      value: ' feature/child ',
      currentName: 'feature/source',
      options: { normalize: false },
    },
  ]);
  assert.deepEqual(normalizeSpy, []);
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
  vscodeState.configurationValues.normalizeNewBranchNames = true;
  vscodeState.inputBoxResponse = ' Feature/from Remote ';
  const validateSpy = [];
  const normalizeSpy = [];
  const createBranchFromRefCalls = [];

  const { commandContext } = createBranchCommandsModule({
    vscodeState,
    validateSpy,
    normalizeSpy,
    normalizeImpl() {
      return 'feature/from-remote';
    },
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
      async pushBranch() {
        return { branchName: 'main', upstreamName: 'origin/main', didPull: false, didPush: false, publishedUpstream: false };
      },
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
    await vscodeState.inputBoxRequests[0].validateInput(' Feature/from Remote '),
    undefined
  );
  assert.deepEqual(validateSpy, [
    {
      value: ' Feature/from Remote ',
      currentName: undefined,
      options: { normalize: true },
    },
  ]);
  assert.deepEqual(normalizeSpy, [' Feature/from Remote ']);
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

test('publishBranch pushes the selected branch and refreshes remote state', async () => {
  const vscodeState = createVscodeState();
  const validateSpy = [];
  const pushBranchCalls = [];

  const { commandContext } = createBranchCommandsModule({
    vscodeState,
    validateSpy,
    gitMock: {
      async checkoutBranch() {},
      async checkoutRemoteBranch() {},
      async createBranch() {},
      async createBranchFromRef() {},
      async deleteBranch() {},
      async deleteRemoteBranch() {},
      async getDiffFilesBetweenRefs() {
        return [];
      },
      async mergeBranchIntoCurrent() {},
      async pushBranch(repoRoot, branchName) {
        pushBranchCalls.push({ repoRoot, branchName });
        return {
          branchName,
          upstreamName: `origin/${branchName}`,
          didPull: false,
          didPush: true,
          publishedUpstream: true,
        };
      },
      async renameBranch() {},
      async syncBranch() {
        return { branchName: 'main', upstreamName: 'origin/main', didPull: false, didPush: false, publishedUpstream: false };
      },
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.publishBranch']({
    nodeType: 'branch',
    branchName: 'feature/offline',
    repoRoot: '/repo',
  });

  assert.deepEqual(validateSpy, []);
  assert.deepEqual(pushBranchCalls, [{ repoRoot: '/repo', branchName: 'feature/offline' }]);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: 'sync',
      options: { fetchRemoteState: true, forceFetchRemoteState: true },
    },
  ]);
});

test('showBranchActions opens an iconized quick pick for publishable branches and routes the selection', async () => {
  const vscodeState = createVscodeState();
  vscodeState.quickPickSelector = (items) =>
    items.find((item) => item.actionId === 'publishBranch');
  const validateSpy = [];

  createBranchCommandsModule({
    vscodeState,
    validateSpy,
    gitMock: {
      async checkoutBranch() {},
      async checkoutRemoteBranch() {},
      async createBranch() {},
      async createBranchFromRef() {},
      async deleteBranch() {},
      async deleteRemoteBranch() {},
      async getDiffFilesBetweenRefs() {
        return [];
      },
      async mergeBranchIntoCurrent() {},
      async pushBranch() {
        return { branchName: 'main', upstreamName: 'origin/main', didPull: false, didPush: false, publishedUpstream: false };
      },
      async renameBranch() {},
      async syncBranch() {
        return { branchName: 'main', upstreamName: 'origin/main', didPull: false, didPush: false, publishedUpstream: false };
      },
    },
  });

  const item = {
    nodeType: 'branch',
    contextValue: 'publishableBranch',
    branchName: 'feature/offline',
    repoRoot: '/repo',
  };

  await vscodeState.registeredCommands['gitBranchesPanel.showBranchActions'](item);

  assert.deepEqual(validateSpy, []);
  assert.equal(vscodeState.quickPickRequests.length, 1);
  assert.match(vscodeState.quickPickRequests[0].options.placeHolder, /feature\/offline/);
  assert.ok(
    vscodeState.quickPickRequests[0].items.some(
      (quickPickItem) => quickPickItem.label === '$(cloud-upload) Publish Branch'
    )
  );
  assert.ok(
    vscodeState.quickPickRequests[0].items.some(
      (quickPickItem) => quickPickItem.label === '$(arrow-right) Checkout Branch'
    )
  );
  assert.ok(
    vscodeState.quickPickRequests[0].items.some(
      (quickPickItem) => quickPickItem.label === '$(trash) Delete Branch'
    )
  );
  assert.ok(
    !vscodeState.quickPickRequests[0].items.some(
      (quickPickItem) => quickPickItem.label === '$(sync) Sync Branch'
    )
  );
  assert.deepEqual(vscodeState.executedCommands, [
    {
      command: 'gitBranchesPanel.publishBranch',
      args: [item],
    },
  ]);
});

test('showBranchActions adapts the quick pick for remote branches', async () => {
  const vscodeState = createVscodeState();
  vscodeState.quickPickSelector = (items) => items.find((item) => item.actionId === 'deleteBranch');
  const validateSpy = [];

  createBranchCommandsModule({
    vscodeState,
    validateSpy,
    gitMock: {
      async checkoutBranch() {},
      async checkoutRemoteBranch() {},
      async createBranch() {},
      async createBranchFromRef() {},
      async deleteBranch() {},
      async deleteRemoteBranch() {},
      async getDiffFilesBetweenRefs() {
        return [];
      },
      async mergeBranchIntoCurrent() {},
      async pushBranch() {
        return { branchName: 'main', upstreamName: 'origin/main', didPull: false, didPush: false, publishedUpstream: false };
      },
      async renameBranch() {},
      async syncBranch() {
        return { branchName: 'main', upstreamName: 'origin/main', didPull: false, didPush: false, publishedUpstream: false };
      },
    },
  });

  const item = {
    nodeType: 'remoteBranch',
    contextValue: 'remoteBranch',
    branchName: 'origin/feature/demo',
    repoRoot: '/repo',
  };

  await vscodeState.registeredCommands['gitBranchesPanel.showBranchActions'](item);

  assert.deepEqual(validateSpy, []);
  assert.equal(vscodeState.quickPickRequests.length, 1);
  assert.ok(
    !vscodeState.quickPickRequests[0].items.some((quickPickItem) => /Sync Branch/.test(quickPickItem.label))
  );
  assert.ok(
    !vscodeState.quickPickRequests[0].items.some((quickPickItem) => /Publish Branch/.test(quickPickItem.label))
  );
  assert.ok(
    !vscodeState.quickPickRequests[0].items.some((quickPickItem) => /Rename Branch/.test(quickPickItem.label))
  );
  assert.ok(
    vscodeState.quickPickRequests[0].items.some(
      (quickPickItem) => quickPickItem.label === '$(trash) Delete Branch'
    )
  );
  assert.deepEqual(vscodeState.executedCommands, [
    {
      command: 'gitBranchesPanel.deleteBranch',
      args: [item],
    },
  ]);
});
