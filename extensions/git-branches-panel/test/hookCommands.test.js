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
    openedDocuments: [],
    registeredCommands: {},
    shownDocuments: [],
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
    Uri: {
      file(value) {
        return { fsPath: value, path: value };
      },
    },
    window: {
      async showTextDocument(document, options) {
        state.shownDocuments.push({ document, options });
        return undefined;
      },
    },
    workspace: {
      async openTextDocument(uri) {
        state.openedDocuments.push(uri);
        return { uri };
      },
    },
  };
}

function createCommandContext() {
  const state = {
    activationDecisions: [],
    commandErrors: [],
    successRefreshes: [],
  };

  return {
    state,
    context: {
      provider: {},
      activationTracker: {
        shouldCheckout() {
          return state.activationDecisions.shift() ?? false;
        },
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

function createHookCommandsModule({ vscodeState, gitMock }) {
  const commandContext = createCommandContext();
  const hookCommands = loadFresh('../out/commands/hookCommands.js', {
    vscode: createVscodeMock(vscodeState),
    '../git': {
      async getHooks() {
        return [];
      },
      async setHookEnabled() {},
      ...gitMock,
    },
    '../treeProvider': {
      BranchTreeItem: class BranchTreeItem {},
    },
  });

  hookCommands.registerHookCommands({ subscriptions: [] }, commandContext.context);

  return {
    commandContext,
  };
}

test('editHook opens the selected hook file in the editor', async () => {
  const vscodeState = createVscodeState();

  createHookCommandsModule({
    vscodeState,
    gitMock: {},
  });

  await vscodeState.registeredCommands['gitBranchesPanel.editHook']({
    nodeType: 'hook',
    branchInfo: {
      scope: 'hook',
      hookName: 'pre-commit',
      hookPath: '/repo/.git/hooks/pre-commit',
    },
  });

  assert.deepEqual(vscodeState.openedDocuments, [
    {
      fsPath: '/repo/.git/hooks/pre-commit',
      path: '/repo/.git/hooks/pre-commit',
    },
  ]);
  assert.deepEqual(vscodeState.shownDocuments, [
    {
      document: {
        uri: {
          fsPath: '/repo/.git/hooks/pre-commit',
          path: '/repo/.git/hooks/pre-commit',
        },
      },
      options: { preview: false },
    },
  ]);
});

test('activateHookItem opens the hook only on the second activation', async () => {
  const vscodeState = createVscodeState();

  const { commandContext } = createHookCommandsModule({
    vscodeState,
    gitMock: {},
  });
  commandContext.state.activationDecisions.push(false, true);

  const item = {
    nodeType: 'hook',
    branchName: 'pre-commit · local',
    repoRoot: '/repo',
    branchInfo: {
      scope: 'hook',
      hookName: 'pre-commit',
      hookPath: '/repo/.git/hooks/pre-commit',
    },
  };

  await vscodeState.registeredCommands['gitBranchesPanel.activateHookItem'](item);
  await vscodeState.registeredCommands['gitBranchesPanel.activateHookItem'](item);

  assert.equal(vscodeState.openedDocuments.length, 1);
  assert.deepEqual(vscodeState.openedDocuments[0], {
    fsPath: '/repo/.git/hooks/pre-commit',
    path: '/repo/.git/hooks/pre-commit',
  });
});

test('disableHook disables the selected hook and refreshes the Hooks section', async () => {
  const vscodeState = createVscodeState();
  const hookToggleCalls = [];

  const { commandContext } = createHookCommandsModule({
    vscodeState,
    gitMock: {
      async setHookEnabled(target, enabled) {
        hookToggleCalls.push({ target, enabled });
      },
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.disableHook']({
    nodeType: 'hook',
    branchInfo: {
      scope: 'hook',
      hookEnabled: true,
      hookName: 'pre-commit',
      hookPath: '/repo/.git/hooks/pre-commit',
    },
  });

  assert.deepEqual(hookToggleCalls, [
    {
      target: {
        hookEnabled: true,
        hookPath: '/repo/.git/hooks/pre-commit',
      },
      enabled: false,
    },
  ]);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: "Disabled hook 'pre-commit'.",
      options: { sections: ['hooks'], fetchRemoteState: false, onlyIfLoaded: true },
    },
  ]);
});

test('enableHook enables the selected disabled hook and refreshes the Hooks section', async () => {
  const vscodeState = createVscodeState();
  const hookToggleCalls = [];

  const { commandContext } = createHookCommandsModule({
    vscodeState,
    gitMock: {
      async setHookEnabled(target, enabled) {
        hookToggleCalls.push({ target, enabled });
      },
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.enableHook']({
    nodeType: 'hook',
    branchInfo: {
      scope: 'hook',
      hookEnabled: false,
      hookName: 'commit-msg',
      hookPath: '/repo/.githooks/commit-msg.disabled',
    },
  });

  assert.deepEqual(hookToggleCalls, [
    {
      target: {
        hookEnabled: false,
        hookPath: '/repo/.githooks/commit-msg.disabled',
      },
      enabled: true,
    },
  ]);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: "Enabled hook 'commit-msg'.",
      options: { sections: ['hooks'], fetchRemoteState: false, onlyIfLoaded: true },
    },
  ]);
});

test('enableAllHooks enables only disabled hooks from the Hooks section', async () => {
  const vscodeState = createVscodeState();
  const hookToggleCalls = [];

  const { commandContext } = createHookCommandsModule({
    vscodeState,
    gitMock: {
      async getHooks() {
        return [
          {
            name: 'pre-commit · local',
            scope: 'hook',
            hookEnabled: false,
            hookPath: '/repo/.git/hooks/pre-commit.disabled',
          },
          {
            name: 'commit-msg · shared',
            scope: 'hook',
            hookEnabled: true,
            hookPath: '/repo/.githooks/commit-msg',
          },
        ];
      },
      async setHookEnabled(target, enabled) {
        hookToggleCalls.push({ target, enabled });
      },
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.enableAllHooks']({
    nodeType: 'section',
    containerScope: 'hook',
    repoRoot: '/repo',
  });

  assert.deepEqual(hookToggleCalls, [
    {
      target: {
        hookEnabled: false,
        hookPath: '/repo/.git/hooks/pre-commit.disabled',
      },
      enabled: true,
    },
  ]);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: 'Enabled 1 hook.',
      options: { sections: ['hooks'], fetchRemoteState: false, onlyIfLoaded: true },
    },
  ]);
});

test('disableAllHooks disables only enabled hooks from the Hooks section', async () => {
  const vscodeState = createVscodeState();
  const hookToggleCalls = [];

  const { commandContext } = createHookCommandsModule({
    vscodeState,
    gitMock: {
      async getHooks() {
        return [
          {
            name: 'pre-commit · local',
            scope: 'hook',
            hookEnabled: true,
            hookPath: '/repo/.git/hooks/pre-commit',
          },
          {
            name: 'post-commit · local',
            scope: 'hook',
            hookEnabled: false,
            hookPath: '/repo/.git/hooks/post-commit.disabled',
          },
          {
            name: 'prepare-commit-msg · shared',
            scope: 'hook',
            hookEnabled: true,
            hookPath: '/repo/.githooks/prepare-commit-msg',
          },
        ];
      },
      async setHookEnabled(target, enabled) {
        hookToggleCalls.push({ target, enabled });
      },
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.disableAllHooks']({
    nodeType: 'section',
    containerScope: 'hook',
    repoRoot: '/repo',
  });

  assert.deepEqual(hookToggleCalls, [
    {
      target: {
        hookEnabled: true,
        hookPath: '/repo/.git/hooks/pre-commit',
      },
      enabled: false,
    },
    {
      target: {
        hookEnabled: true,
        hookPath: '/repo/.githooks/prepare-commit-msg',
      },
      enabled: false,
    },
  ]);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: 'Disabled 2 hooks.',
      options: { sections: ['hooks'], fetchRemoteState: false, onlyIfLoaded: true },
    },
  ]);
});
