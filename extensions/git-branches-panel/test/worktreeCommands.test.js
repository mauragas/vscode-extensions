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
    window: {
      async showInformationMessage() {
        return undefined;
      },
      async showInputBox(options) {
        state.inputBoxRequests.push(options);
        return state.inputBoxResponse;
      },
      async showWarningMessage() {
        return undefined;
      },
    },
    Uri: {
      file(value) {
        return { fsPath: value, path: value };
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

function createWorktreeCommandsModule({ vscodeState, gitMock }) {
  const commandContext = createCommandContext();
  const worktreeCommands = loadFresh('../out/commands/worktreeCommands.js', {
    vscode: createVscodeMock(vscodeState),
    '../errorUtils': {
      getErrorMessage(error) {
        return error instanceof Error ? error.message : String(error);
      },
    },
    '../git': gitMock,
    '../treeProvider': {
      BranchTreeItem: class BranchTreeItem {},
    },
  });

  worktreeCommands.registerWorktreeCommands({ subscriptions: [] }, commandContext.context);

  return {
    commandContext,
  };
}

test('createWorktreeFromRef creates a worktree from a local branch', async () => {
  const vscodeState = createVscodeState();
  vscodeState.inputBoxResponse = '/tmp/repo-feature-demo';
  const createWorktreeCalls = [];

  const { commandContext } = createWorktreeCommandsModule({
    vscodeState,
    gitMock: {
      async createWorktree(repoRoot, worktreePath, refName, options) {
        createWorktreeCalls.push({ repoRoot, worktreePath, refName, options });
      },
      async removeWorktree() {},
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.createWorktreeFromRef']({
    nodeType: 'branch',
    branchName: 'feature/demo',
    repoRoot: '/repo',
  });

  assert.match(vscodeState.inputBoxRequests[0].prompt, /feature\/demo/);
  assert.deepEqual(createWorktreeCalls, [
    {
      repoRoot: '/repo',
      worktreePath: '/tmp/repo-feature-demo',
      refName: 'feature/demo',
      options: { detach: false },
    },
  ]);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: "Created worktree 'repo-feature-demo' from 'feature/demo'.",
      options: { fetchRemoteState: false },
    },
  ]);
});

test('createWorktreeFromRef creates a detached worktree from a tag', async () => {
  const vscodeState = createVscodeState();
  vscodeState.inputBoxResponse = '/tmp/repo-v1.0.0';
  const createWorktreeCalls = [];

  createWorktreeCommandsModule({
    vscodeState,
    gitMock: {
      async createWorktree(repoRoot, worktreePath, refName, options) {
        createWorktreeCalls.push({ repoRoot, worktreePath, refName, options });
      },
      async removeWorktree() {},
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.createWorktreeFromRef']({
    nodeType: 'tag',
    branchName: 'v1.0.0',
    repoRoot: '/repo',
  });

  assert.deepEqual(createWorktreeCalls, [
    {
      repoRoot: '/repo',
      worktreePath: '/tmp/repo-v1.0.0',
      refName: 'refs/tags/v1.0.0',
      options: { detach: true },
    },
  ]);
});

test('createWorktreeFromCurrentBranch creates a new worktree from the current branch when triggered from the Worktree section', async () => {
  const vscodeState = createVscodeState();
  vscodeState.inputBoxResponse = '/tmp/repo-feature-main';
  const createWorktreeCalls = [];

  const { commandContext } = createWorktreeCommandsModule({
    vscodeState,
    gitMock: {
      async createWorktree(repoRoot, worktreePath, refName, options) {
        createWorktreeCalls.push({ repoRoot, worktreePath, refName, options });
      },
      async removeWorktree() {},
    },
  });
  commandContext.state.currentBranch = {
    name: 'main',
    isCurrent: true,
  };

  await vscodeState.registeredCommands['gitBranchesPanel.createWorktreeFromCurrentBranch']({
    nodeType: 'section',
    containerPath: 'section:worktree',
    repoRoot: '/repo',
  });

  assert.match(vscodeState.inputBoxRequests[0].prompt, /current branch 'main'/);
  assert.deepEqual(createWorktreeCalls, [
    {
      repoRoot: '/repo',
      worktreePath: '/tmp/repo-feature-main',
      refName: 'main',
      options: { detach: false },
    },
  ]);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: "Created worktree 'repo-feature-main' from current branch 'main'.",
      options: { fetchRemoteState: false },
    },
  ]);
});
