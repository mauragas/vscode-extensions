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
    infoSelector: undefined,
    quickPickRequests: [],
    quickPickSelector: undefined,
    warningMessages: [],
    warningSelector: undefined,
    warningResponses: [],
    errorMessages: [],
    errorSelector: undefined,
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
      async showInformationMessage(message, ...items) {
        state.infoMessages.push(message);
        return typeof state.infoSelector === 'function'
          ? state.infoSelector(message, items)
          : undefined;
      },
      async showWarningMessage(message, options, ...items) {
        state.warningMessages.push({ message, options, items });
        if (typeof state.warningSelector === 'function') {
          return state.warningSelector(message, options, items);
        }

        if (options && options.modal) {
          return state.warningResponses.shift();
        }

        return undefined;
      },
      async showErrorMessage(message, ...items) {
        state.errorMessages.push({ message, items });
        return typeof state.errorSelector === 'function'
          ? state.errorSelector(message, items)
          : undefined;
      },
    },
  };
}

function createCommandContext() {
  const state = {
    currentBranch: undefined,
    loadingTitles: [],
    successRefreshes: [],
    commandErrors: [],
    revealedBranches: [],
  };

  return {
    state,
    context: {
      provider: {
        async withBusyBranch(_repoRoot, _branchName, operation) {
          return operation();
        },
        async revealBranch(repoRoot, branchName, options) {
          state.revealedBranches.push({ repoRoot, branchName, options });
          return true;
        },
      },
      activationTracker: {
        shouldCheckout() {
          return false;
        },
        reset() {},
      },
      async runWithLoadingIndicator(title, operation) {
        state.loadingTitles.push(title);
        return operation();
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
  validateImpl = () => undefined,
  sanitizeSpy = [],
  sanitizeImpl = (value) => value.trim(),
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
      sanitizeNewBranchName(value) {
        sanitizeSpy.push(value);
        return sanitizeImpl(value);
      },
      normalizeBranchName(value) {
        normalizeSpy.push(value);
        return normalizeImpl(value);
      },
      validateBranchName() {
        return undefined;
      },
      validateNewBranchNameInput(value, currentName, options) {
        validateSpy.push({ value, currentName, options });
        return validateImpl(value, currentName, options);
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

test('newBranch sanitizes the entered branch name when normalization is disabled', async () => {
  const vscodeState = createVscodeState();
  vscodeState.inputBoxResponse = ' - Feature / Hello--- World - ';
  const validateSpy = [];
  const sanitizeSpy = [];
  const normalizeSpy = [];
  const createBranchCalls = [];

  const { commandContext } = createBranchCommandsModule({
    vscodeState,
    validateSpy,
    sanitizeSpy,
    sanitizeImpl() {
      return 'Feature/Hello---World';
    },
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

  assert.equal(await vscodeState.inputBoxRequests[0].validateInput('anything at all'), undefined);
  assert.deepEqual(validateSpy, [
    {
      value: 'anything at all',
      currentName: undefined,
      options: { normalize: false },
    },
  ]);
  assert.deepEqual(sanitizeSpy, [' - Feature / Hello--- World - ']);
  assert.deepEqual(normalizeSpy, []);
  assert.deepEqual(createBranchCalls, [{ repoRoot: '/repo', branchName: 'Feature/Hello---World' }]);
  assert.deepEqual(vscodeState.errorMessages, []);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: "Created and switched to 'Feature/Hello---World'.",
      options: {},
    },
  ]);
  assert.deepEqual(commandContext.state.revealedBranches, [
    {
      repoRoot: '/repo',
      branchName: 'Feature/Hello---World',
      options: { clearFilter: true },
    },
  ]);
});

test('newBranch normalizes the created branch name when the setting is enabled', async () => {
  const vscodeState = createVscodeState();
  vscodeState.configurationValues.normalizeNewBranchNames = true;
  vscodeState.inputBoxResponse = ' - Feature / Hello--- World - ';
  const validateSpy = [];
  const sanitizeSpy = [];
  const normalizeSpy = [];
  const createBranchCalls = [];

  const { commandContext } = createBranchCommandsModule({
    vscodeState,
    validateSpy,
    sanitizeSpy,
    normalizeSpy,
    normalizeImpl() {
      return 'feature/hello-world';
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

  assert.equal(await vscodeState.inputBoxRequests[0].validateInput('anything at all'), undefined);
  assert.deepEqual(validateSpy, [
    {
      value: 'anything at all',
      currentName: undefined,
      options: { normalize: true },
    },
  ]);
  assert.deepEqual(sanitizeSpy, []);
  assert.deepEqual(normalizeSpy, [' - Feature / Hello--- World - ']);
  assert.deepEqual(createBranchCalls, [{ repoRoot: '/repo', branchName: 'feature/hello-world' }]);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: "Created and switched to 'feature/hello-world'.",
      options: {},
    },
  ]);
});

test('newBranch prefills the selected configured branch prefix before creating the branch', async () => {
  const vscodeState = createVscodeState();
  vscodeState.configurationValues.newBranchPrefixes = ['feature', 'bugfix', 'hotfix'];
  vscodeState.quickPickSelector = (items) => items.find((item) => item.prefix === 'bugfix');
  vscodeState.inputBoxResponse = ' bugfix/issue 123 ';
  const createBranchCalls = [];

  createBranchCommandsModule({
    vscodeState,
    validateSpy: [],
    sanitizeSpy: [],
    sanitizeImpl() {
      return 'bugfix/issue-123';
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

  assert.equal(vscodeState.quickPickRequests.length, 1);
  assert.equal(vscodeState.inputBoxRequests[0].value, 'bugfix/');
  assert.deepEqual(vscodeState.inputBoxRequests[0].valueSelection, [7, 7]);
  assert.deepEqual(createBranchCalls, [{ repoRoot: '/repo', branchName: 'bugfix/issue-123' }]);
});

test('newBranchFromSelected creates a branch from a local branch without checkout', async () => {
  const vscodeState = createVscodeState();
  vscodeState.inputBoxResponse = ' feature/child name?? ';
  const validateSpy = [];
  const sanitizeSpy = [];
  const normalizeSpy = [];
  const createBranchFromRefCalls = [];

  const { commandContext } = createBranchCommandsModule({
    vscodeState,
    validateSpy,
    sanitizeSpy,
    sanitizeImpl() {
      return 'feature/child-name';
    },
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

  await vscodeState.registeredCommands['gitBranchesPanel.newBranchFromSelected']({
    nodeType: 'branch',
    branchName: 'feature/source',
    repoRoot: '/repo',
  });

  assert.match(vscodeState.inputBoxRequests[0].prompt, /feature\/source/);
  assert.equal(await vscodeState.inputBoxRequests[0].validateInput('anything at all'), undefined);
  assert.deepEqual(validateSpy, [
    {
      value: 'anything at all',
      currentName: 'feature/source',
      options: { normalize: false },
    },
  ]);
  assert.deepEqual(sanitizeSpy, [' feature/child name?? ']);
  assert.deepEqual(normalizeSpy, []);
  assert.deepEqual(createBranchFromRefCalls, [
    {
      repoRoot: '/repo',
      branchName: 'feature/child-name',
      startPoint: 'feature/source',
      options: { checkout: false },
    },
  ]);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: "Created branch 'feature/child-name' from 'feature/source'.",
      options: { fetchRemoteState: false },
    },
  ]);
  assert.deepEqual(commandContext.state.revealedBranches, [
    {
      repoRoot: '/repo',
      branchName: 'feature/child-name',
      options: { clearFilter: true },
    },
  ]);
});

test('newBranchFromSelectedAndCheckout creates and checks out a branch from a remote branch', async () => {
  const vscodeState = createVscodeState();
  vscodeState.configurationValues.normalizeNewBranchNames = true;
  vscodeState.inputBoxResponse = ' - Feature / Hello--- World - ';
  const validateSpy = [];
  const sanitizeSpy = [];
  const normalizeSpy = [];
  const createBranchFromRefCalls = [];

  const { commandContext } = createBranchCommandsModule({
    vscodeState,
    validateSpy,
    sanitizeSpy,
    normalizeSpy,
    normalizeImpl() {
      return 'feature/hello-world';
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

  await vscodeState.registeredCommands['gitBranchesPanel.newBranchFromSelectedAndCheckout']({
    nodeType: 'remoteBranch',
    branchName: 'origin/feature/source',
    repoRoot: '/repo',
  });

  assert.equal(await vscodeState.inputBoxRequests[0].validateInput('anything at all'), undefined);
  assert.deepEqual(validateSpy, [
    {
      value: 'anything at all',
      currentName: undefined,
      options: { normalize: true },
    },
  ]);
  assert.deepEqual(sanitizeSpy, []);
  assert.deepEqual(normalizeSpy, [' - Feature / Hello--- World - ']);
  assert.deepEqual(createBranchFromRefCalls, [
    {
      repoRoot: '/repo',
      branchName: 'feature/hello-world',
      startPoint: 'origin/feature/source',
      options: { checkout: true },
    },
  ]);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: "Created and switched to 'feature/hello-world' from 'origin/feature/source'.",
      options: { fetchRemoteState: false },
    },
  ]);
  assert.deepEqual(commandContext.state.revealedBranches, [
    {
      repoRoot: '/repo',
      branchName: 'feature/hello-world',
      options: { clearFilter: true },
    },
  ]);
});

test('newBranch stops when sanitization removes every valid branch-name character', async () => {
  const vscodeState = createVscodeState();
  vscodeState.inputBoxResponse = ' ??? ';
  const validateSpy = [];
  const sanitizeSpy = [];
  const normalizeSpy = [];
  const createBranchCalls = [];

  const { commandContext } = createBranchCommandsModule({
    vscodeState,
    validateSpy,
    validateImpl() {
      return 'Branch name must include at least one valid character.';
    },
    sanitizeSpy,
    sanitizeImpl() {
      return '';
    },
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

  assert.equal(
    await vscodeState.inputBoxRequests[0].validateInput(' ??? '),
    'Branch name must include at least one valid character.'
  );
  assert.deepEqual(validateSpy, [
    {
      value: ' ??? ',
      currentName: undefined,
      options: { normalize: false },
    },
  ]);
  assert.deepEqual(sanitizeSpy, [' ??? ']);
  assert.deepEqual(normalizeSpy, []);
  assert.deepEqual(createBranchCalls, []);
  assert.deepEqual(commandContext.state.successRefreshes, []);
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
  assert.deepEqual(commandContext.state.loadingTitles, ["Publishing 'feature/offline'…"]);
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
      (quickPickItem) => quickPickItem.label === '$(new-folder) Create Worktree...'
    )
  );
  assert.ok(
    vscodeState.quickPickRequests[0].items.some(
      (quickPickItem) =>
        quickPickItem.label === '$(git-commit) Cherry-pick into Current Branch'
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

test('showBranchActions keeps current-branch checkout available even when the primary menu setting hides it', async () => {
  const vscodeState = createVscodeState();
  vscodeState.configurationValues['branchContextMenu.primaryActions'] = ['copyBranchName'];

  createBranchCommandsModule({
    vscodeState,
    validateSpy: [],
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

  await vscodeState.registeredCommands['gitBranchesPanel.showBranchActions']({
    nodeType: 'currentBranch',
    contextValue: 'currentBranch',
    branchName: 'main',
    repoRoot: '/repo',
    branchInfo: {
      name: 'main',
      isCurrent: true,
      scope: 'local',
    },
  });

  assert.equal(vscodeState.quickPickRequests.length, 1);
  assert.ok(
    vscodeState.quickPickRequests[0].items.some(
      (quickPickItem) => quickPickItem.label === '$(arrow-right) Checkout Branch'
    )
  );
  assert.ok(
    vscodeState.quickPickRequests[0].items.some(
      (quickPickItem) => quickPickItem.label === '$(copy) Copy Branch Name'
    )
  );
});

test('showBranchActions exposes compare-with-upstream, history, and advanced actions for tracked local branches', async () => {
  const vscodeState = createVscodeState();

  createBranchCommandsModule({
    vscodeState,
    validateSpy: [],
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
      async getRemoteDefaultBranch() {
        return 'main';
      },
      async getRemoteDetails() {
        return [
          {
            name: 'origin',
            fetchUrl: 'https://github.com/octo/repo.git',
            pushUrl: 'https://github.com/octo/repo.git',
          },
        ];
      },
      async mergeBranchIntoCurrent() {},
      parseCustomRemoteHostingProviders() {
        return [];
      },
      async pushBranch() {
        return {
          branchName: 'main',
          upstreamName: 'origin/main',
          didPull: false,
          didPush: false,
          publishedUpstream: false,
        };
      },
      async removeRemoteTrackingRef() {},
      resolveCompareBaseBranch() {
        return 'main';
      },
      resolveHostedRepository() {
        return {
          provider: 'github',
          providerLabel: 'GitHub',
          remoteName: 'origin',
          remoteUrl: 'https://github.com/octo/repo.git',
          hostRoot: 'https://github.com',
          namespace: 'octo',
          repository: 'repo',
        };
      },
      resolveRemoteBranchName(branchName) {
        return branchName;
      },
      resolveRemoteNameForBranch() {
        return 'origin';
      },
      getUpstreamBranchName(upstreamName) {
        return upstreamName?.split('/').slice(1).join('/');
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
      buildBranchWebUrl() {
        return 'https://github.com/octo/repo/tree/feature/demo';
      },
      buildCompareWebUrl() {
        return 'https://github.com/octo/repo/compare/main...feature/demo';
      },
      buildPullRequestWebUrl() {
        return 'https://github.com/octo/repo/compare/main...feature/demo?expand=1';
      },
      async cherryPickRef() {},
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.showBranchActions']({
    nodeType: 'branch',
    contextValue: 'branch',
    branchName: 'feature/demo',
    repoRoot: '/repo',
    branchInfo: {
      name: 'feature/demo',
      isCurrent: false,
      scope: 'local',
      upstreamName: 'origin/feature/demo',
    },
  });

  assert.ok(
    vscodeState.quickPickRequests[0].items.some(
      (quickPickItem) => quickPickItem.label === '$(diff-multiple) Compare with Upstream'
    )
  );
  assert.ok(
    vscodeState.quickPickRequests[0].items.some(
      (quickPickItem) => quickPickItem.label === '$(history) Show Branch Commits'
    )
  );
  assert.ok(
    vscodeState.quickPickRequests[0].items.some(
      (quickPickItem) => quickPickItem.label === '$(diff-multiple) Open Changed Files for Ref'
    )
  );
  assert.ok(
    vscodeState.quickPickRequests[0].items.some(
      (quickPickItem) => quickPickItem.label === '$(git-merge) Rebase Current onto Selected'
    )
  );
  assert.ok(
    vscodeState.quickPickRequests[0].items.some(
      (quickPickItem) => quickPickItem.label === '$(git-merge) Rebase Selected onto Current'
    )
  );
  assert.ok(
    vscodeState.quickPickRequests[0].items.some(
      (quickPickItem) => quickPickItem.label === '$(git-merge) Squash Merge into Current'
    )
  );
  assert.ok(
    vscodeState.quickPickRequests[0].items.some(
      (quickPickItem) => quickPickItem.label === '$(discard) Reset Current to Selected…'
    )
  );
  assert.ok(
    !vscodeState.quickPickRequests[0].items.some(
      (quickPickItem) => quickPickItem.label === '$(tools) Advanced Branch Operations...'
    )
  );
});

test('deleteBranch blocks deletion of protected branches before any git command runs', async () => {
  const vscodeState = createVscodeState();
  vscodeState.configurationValues.protectedBranchNames = ['release/2026.06'];
  const deleteBranchCalls = [];

  createBranchCommandsModule({
    vscodeState,
    validateSpy: [],
    gitMock: {
      async checkoutBranch() {},
      async checkoutRemoteBranch() {},
      async createBranch() {},
      async createBranchFromRef() {},
      async deleteBranch(repoRoot, branchName, force) {
        deleteBranchCalls.push({ repoRoot, branchName, force });
      },
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

  await vscodeState.registeredCommands['gitBranchesPanel.deleteBranch']({
    nodeType: 'branch',
    branchName: 'release/2026.06',
    repoRoot: '/repo',
  });

  assert.deepEqual(deleteBranchCalls, []);
  assert.match(
    vscodeState.warningMessages[0].message,
    /protected from deletion by 'gitBranchesPanel\.protectedBranchNames'/
  );
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

test('showBranchActions exposes stale remote-tracking cleanup instead of remote delete', async () => {
  const vscodeState = createVscodeState();
  vscodeState.quickPickSelector = (items) =>
    items.find((item) => item.actionId === 'removeStaleRemoteTrackingRef');

  createBranchCommandsModule({
    vscodeState,
    validateSpy: [],
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
      async getRemoteBranchTrackingState() {
        return 'stale';
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
      async removeRemoteTrackingRef() {},
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

  const item = {
    nodeType: 'staleRemoteBranch',
    contextValue: 'staleRemoteBranch',
    branchName: 'ghost/feature/demo',
    branchInfo: {
      name: 'ghost/feature/demo',
      isCurrent: false,
      scope: 'remote',
      remoteName: 'ghost',
      remoteTrackingState: 'stale',
    },
    repoRoot: '/repo',
  };

  await vscodeState.registeredCommands['gitBranchesPanel.showBranchActions'](item);

  assert.ok(
    vscodeState.quickPickRequests[0].items.some(
      (quickPickItem) => quickPickItem.label === '$(trash) Remove Stale Tracking Ref'
    )
  );
  assert.ok(
    !vscodeState.quickPickRequests[0].items.some(
      (quickPickItem) => quickPickItem.label === '$(trash) Delete Branch'
    )
  );
  assert.ok(
    !vscodeState.quickPickRequests[0].items.some(
      (quickPickItem) => quickPickItem.label === '$(arrow-right) Checkout Branch'
    )
  );
  assert.deepEqual(vscodeState.executedCommands, [
    {
      command: 'gitBranchesPanel.removeStaleRemoteTrackingRef',
      args: [item],
    },
  ]);
});

test('deleteBranch offers retry without hook when remote deletion is blocked by a local pre-push hook', async () => {
  const vscodeState = createVscodeState();
  vscodeState.warningResponses.push('Delete', 'Retry Without Hook');
  vscodeState.errorSelector = (_message, items) => items[0];
  const deleteRemoteBranchCalls = [];

  const { commandContext } = createBranchCommandsModule({
    vscodeState,
    validateSpy: [],
    gitMock: {
      async checkoutBranch() {},
      async checkoutRemoteBranch() {},
      async createBranch() {},
      async createBranchFromRef() {},
      async deleteBranch() {},
      async deleteRemoteBranch(repoRoot, branchName, options = {}) {
        deleteRemoteBranchCalls.push({ repoRoot, branchName, options });
        if (!options.skipPushHooks) {
          throw new Error(
            "Command failed: git push origin --delete feature/demo\npre-push: blocked branch deletion push to refs/heads/feature/demo on origin.\nerror: failed to push some refs to 'https://github.com/example/repo.git'"
          );
        }
      },
      async getDiffFilesBetweenRefs() {
        return [];
      },
      async getRemoteBranchTrackingState() {
        return 'live';
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
      async removeRemoteTrackingRef() {},
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

  await vscodeState.registeredCommands['gitBranchesPanel.deleteBranch']({
    nodeType: 'remoteBranch',
    branchName: 'origin/feature/demo',
    repoRoot: '/repo',
    branchInfo: {
      name: 'origin/feature/demo',
      isCurrent: false,
      scope: 'remote',
      remoteName: 'origin',
      remoteTrackingState: 'live',
    },
  });

  assert.deepEqual(deleteRemoteBranchCalls, [
    {
      repoRoot: '/repo',
      branchName: 'origin/feature/demo',
      options: { skipPushHooks: undefined },
    },
    {
      repoRoot: '/repo',
      branchName: 'origin/feature/demo',
      options: { skipPushHooks: true },
    },
  ]);
  assert.equal(vscodeState.warningMessages[0].options.modal, true);
  assert.match(vscodeState.errorMessages[0].message, /blocked by a local Git pre-push hook/i);
  assert.deepEqual(commandContext.state.successRefreshes.at(-1), {
    message: "Deleted remote branch 'origin/feature/demo'.",
    options: { fetchRemoteState: true, forceFetchRemoteState: true },
  });
});

test('deleteBranch offers stale tracking cleanup when the remote is missing', async () => {
  const vscodeState = createVscodeState();
  vscodeState.errorSelector = (_message, items) => items[0];
  const removeRemoteTrackingRefCalls = [];

  const { commandContext } = createBranchCommandsModule({
    vscodeState,
    validateSpy: [],
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
      async getRemoteBranchTrackingState() {
        return 'stale';
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
      async removeRemoteTrackingRef(repoRoot, branchName) {
        removeRemoteTrackingRefCalls.push({ repoRoot, branchName });
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

  await vscodeState.registeredCommands['gitBranchesPanel.deleteBranch']({
    nodeType: 'remoteBranch',
    branchName: 'ghost/feature/demo',
    repoRoot: '/repo',
    branchInfo: {
      name: 'ghost/feature/demo',
      isCurrent: false,
      scope: 'remote',
      remoteName: 'ghost',
      remoteTrackingState: 'stale',
    },
  });

  assert.deepEqual(removeRemoteTrackingRefCalls, [
    {
      repoRoot: '/repo',
      branchName: 'ghost/feature/demo',
    },
  ]);
  assert.match(vscodeState.errorMessages[0].message, /remote 'ghost'/i);
  assert.deepEqual(commandContext.state.successRefreshes.at(-1), {
    message: "Removed stale tracking ref 'ghost/feature/demo'.",
    options: { fetchRemoteState: false },
  });
});

test('newBranchFromSelectedAndCheckout creates a branch from a missing upstream branch', async () => {
  const vscodeState = createVscodeState();
  vscodeState.inputBoxResponse = ' feature/new-feature ';
  const validateSpy = [];
  const sanitizeSpy = [];
  const normalizeSpy = [];
  const createBranchFromRefCalls = [];

  const { commandContext } = createBranchCommandsModule({
    vscodeState,
    validateSpy,
    sanitizeSpy,
    sanitizeImpl() {
      return 'feature/new-feature';
    },
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

  await vscodeState.registeredCommands['gitBranchesPanel.newBranchFromSelectedAndCheckout']({
    nodeType: 'missingUpstreamBranch',
    branchName: 'feature/old-feature',
    repoRoot: '/repo',
  });

  assert.equal(await vscodeState.inputBoxRequests[0].validateInput('anything at all'), undefined);
  assert.deepEqual(validateSpy, [
    {
      value: 'anything at all',
      currentName: 'feature/old-feature',
      options: { normalize: false },
    },
  ]);
  assert.deepEqual(sanitizeSpy, [' feature/new-feature ']);
  assert.deepEqual(normalizeSpy, []);
  assert.deepEqual(createBranchFromRefCalls, [
    {
      repoRoot: '/repo',
      branchName: 'feature/new-feature',
      startPoint: 'feature/old-feature',
      options: { checkout: true },
    },
  ]);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: "Created and switched to 'feature/new-feature' from 'feature/old-feature'.",
      options: { fetchRemoteState: false },
    },
  ]);
});

test('deleteBranch deletes a missing upstream branch with confirmation', async () => {
  const vscodeState = createVscodeState();
  vscodeState.warningResponses.push('Delete');
  const deleteBranchCalls = [];

  const { commandContext } = createBranchCommandsModule({
    vscodeState,
    validateSpy: [],
    gitMock: {
      async checkoutBranch() {},
      async checkoutRemoteBranch() {},
      async createBranch() {},
      async createBranchFromRef() {},
      async deleteBranch(repoRoot, branchName, force) {
        deleteBranchCalls.push({ repoRoot, branchName, force });
      },
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

  await vscodeState.registeredCommands['gitBranchesPanel.deleteBranch']({
    nodeType: 'missingUpstreamBranch',
    branchName: 'feature/old-feature',
    repoRoot: '/repo',
  });

  assert.deepEqual(deleteBranchCalls, [
    { repoRoot: '/repo', branchName: 'feature/old-feature', force: false },
  ]);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: "Deleted branch 'feature/old-feature'.",
      options: {},
    },
  ]);
});

test('showBranchActions exposes actions for missing upstream branches', async () => {
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

  const item = {
    nodeType: 'missingUpstreamBranch',
    contextValue: 'missingUpstreamBranch',
    branchName: 'feature/old-feature',
    repoRoot: '/repo',
  };

  await vscodeState.registeredCommands['gitBranchesPanel.showBranchActions'](item);

  assert.deepEqual(validateSpy, []);
  assert.equal(vscodeState.quickPickRequests.length, 1);
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
      command: 'gitBranchesPanel.deleteBranch',
      args: [item],
    },
  ]);
});

test('cherryPickIntoCurrent confirms, cherry-picks, and refreshes once', async () => {
  const vscodeState = createVscodeState();
  vscodeState.warningResponses.push('Cherry-pick');
  const cherryPickCalls = [];

  const { commandContext } = createBranchCommandsModule({
    vscodeState,
    validateSpy: [],
    gitMock: {
      async checkoutBranch() {},
      async checkoutRemoteBranch() {},
      async cherryPickRef(repoRoot, refName) {
        cherryPickCalls.push({ repoRoot, refName });
      },
      async createBranch() {},
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
  commandContext.state.currentBranch = {
    name: 'main',
    isCurrent: true,
  };

  await vscodeState.registeredCommands['gitBranchesPanel.cherryPickIntoCurrent']({
    nodeType: 'branch',
    branchName: 'feature/demo',
    repoRoot: '/repo',
  });

  assert.deepEqual(cherryPickCalls, [{ repoRoot: '/repo', refName: 'feature/demo' }]);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: "Cherry-picked 'feature/demo' into 'main'.",
      options: { fetchRemoteState: false },
    },
  ]);
});
