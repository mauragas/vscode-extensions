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
    inputBoxRequests: [],
    inputBoxResponse: undefined,
    inputBoxResponses: [],
    clipboardWrites: [],
    infoMessages: [],
    warningMessages: [],
    warningResponses: [],
    terminals: [],
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
        async writeText(value) {
          state.clipboardWrites.push(value);
        },
      },
    },
    window: {
      createTerminal(options) {
        const terminal = {
          options,
          shown: false,
          show() {
            terminal.shown = true;
          },
        };
        state.terminals.push(terminal);
        return terminal;
      },
      async showInformationMessage(message) {
        state.infoMessages.push(message);
        return undefined;
      },
      async showInputBox(options) {
        state.inputBoxRequests.push(options);
        return state.inputBoxResponses.length > 0 ? state.inputBoxResponses.shift() : state.inputBoxResponse;
      },
      async showWarningMessage(message, options, ...items) {
        state.warningMessages.push({ message, options, items });
        if (options && options.modal) {
          return state.warningResponses.shift();
        }

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
      async renameWorktree() {},
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
      async renameWorktree() {},
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
      async renameWorktree() {},
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

test('openWorktree opens the selected worktree in the current window', async () => {
  const vscodeState = createVscodeState();

  createWorktreeCommandsModule({
    vscodeState,
    gitMock: {
      async createWorktree() {},
      async renameWorktree() {},
      async removeWorktree() {},
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.openWorktree']({
    nodeType: 'worktree',
    branchName: '/tmp/repo-feature-demo',
  });

  assert.deepEqual(vscodeState.executedCommands, [
    {
      command: 'vscode.openFolder',
      args: [{ fsPath: '/tmp/repo-feature-demo', path: '/tmp/repo-feature-demo' }, false],
    },
  ]);
});

test('openWorktreeInNewWindow opens the selected worktree in a new window', async () => {
  const vscodeState = createVscodeState();

  createWorktreeCommandsModule({
    vscodeState,
    gitMock: {
      async createWorktree() {},
      async renameWorktree() {},
      async removeWorktree() {},
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.openWorktreeInNewWindow']({
    nodeType: 'worktree',
    branchName: '/tmp/repo-feature-demo',
  });

  assert.deepEqual(vscodeState.executedCommands, [
    {
      command: 'vscode.openFolder',
      args: [{ fsPath: '/tmp/repo-feature-demo', path: '/tmp/repo-feature-demo' }, true],
    },
  ]);
});

test('renameWorktree renames the selected linked worktree path', async () => {
  const vscodeState = createVscodeState();
  vscodeState.inputBoxResponse = '/tmp/repo-feature-renamed';
  const renameWorktreeCalls = [];

  const { commandContext } = createWorktreeCommandsModule({
    vscodeState,
    gitMock: {
      async createWorktree() {},
      async renameWorktree(repoRoot, worktreePath, newWorktreePath) {
        renameWorktreeCalls.push({ repoRoot, worktreePath, newWorktreePath });
      },
      async removeWorktree() {},
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.renameWorktree']({
    nodeType: 'worktree',
    branchName: '/tmp/repo-feature-demo',
    repoRoot: '/repo',
  });

  assert.match(vscodeState.inputBoxRequests[0].prompt, /repo-feature-demo/);
  assert.equal(vscodeState.inputBoxRequests[0].value, '/tmp/repo-feature-demo');
  assert.deepEqual(renameWorktreeCalls, [
    {
      repoRoot: '/repo',
      worktreePath: '/tmp/repo-feature-demo',
      newWorktreePath: '/tmp/repo-feature-renamed',
    },
  ]);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: "Renamed worktree to 'repo-feature-renamed'.",
      options: { fetchRemoteState: false },
    },
  ]);
});

test('renameWorktree ignores the current worktree', async () => {
  const vscodeState = createVscodeState();

  createWorktreeCommandsModule({
    vscodeState,
    gitMock: {
      async createWorktree() {},
      async renameWorktree() {
        throw new Error('renameWorktree should not be called');
      },
      async removeWorktree() {},
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.renameWorktree']({
    nodeType: 'worktree',
    branchName: '/repo',
    repoRoot: '/repo',
    branchInfo: {
      isCurrent: true,
    },
  });

  assert.equal(vscodeState.inputBoxRequests.length, 0);
});

test('copyWorktreeRef copies the worktree reference and reports success', async () => {
  const vscodeState = createVscodeState();

  createWorktreeCommandsModule({
    vscodeState,
    gitMock: {
      async createWorktree() {},
      async renameWorktree() {},
      async removeWorktree() {},
      async pruneWorktrees() {},
      async lockWorktree() {},
      async unlockWorktree() {},
      async getWorktrees() {
        return [];
      },
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.copyWorktreeRef']({
    nodeType: 'worktree',
    branchName: '/tmp/repo-feature-demo',
    branchInfo: {
      worktreeRef: 'feature/demo',
    },
  });

  assert.deepEqual(vscodeState.clipboardWrites, ['feature/demo']);
  assert.deepEqual(vscodeState.infoMessages, [
    "Copied worktree reference 'feature/demo' to the clipboard.",
  ]);
});

test('openWorktreeInTerminal creates and shows a terminal rooted at the worktree path', async () => {
  const vscodeState = createVscodeState();

  createWorktreeCommandsModule({
    vscodeState,
    gitMock: {
      async createWorktree() {},
      async renameWorktree() {},
      async removeWorktree() {},
      async pruneWorktrees() {},
      async lockWorktree() {},
      async unlockWorktree() {},
      async getWorktrees() {
        return [];
      },
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.openWorktreeInTerminal']({
    nodeType: 'worktree',
    branchName: '/tmp/repo-feature-demo',
  });

  assert.equal(vscodeState.terminals.length, 1);
  assert.deepEqual(vscodeState.terminals[0].options, {
    name: 'Worktree: repo-feature-demo',
    cwd: '/tmp/repo-feature-demo',
  });
  assert.equal(vscodeState.terminals[0].shown, true);
});

test('lockWorktree prompts for an optional reason and refreshes the worktree section', async () => {
  const vscodeState = createVscodeState();
  vscodeState.inputBoxResponses.push('In use elsewhere');
  const lockWorktreeCalls = [];

  const { commandContext } = createWorktreeCommandsModule({
    vscodeState,
    gitMock: {
      async createWorktree() {},
      async renameWorktree() {},
      async removeWorktree() {},
      async pruneWorktrees() {},
      async lockWorktree(repoRoot, worktreePath, reason) {
        lockWorktreeCalls.push({ repoRoot, worktreePath, reason });
      },
      async unlockWorktree() {},
      async getWorktrees() {
        return [];
      },
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.lockWorktree']({
    nodeType: 'worktree',
    branchName: '/tmp/repo-feature-demo',
    repoRoot: '/repo',
    branchInfo: {
      isCurrent: false,
    },
  });

  assert.match(vscodeState.inputBoxRequests[0].prompt, /optional lock reason/i);
  assert.deepEqual(lockWorktreeCalls, [
    {
      repoRoot: '/repo',
      worktreePath: '/tmp/repo-feature-demo',
      reason: 'In use elsewhere',
    },
  ]);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: "Locked worktree 'repo-feature-demo' (In use elsewhere).",
      options: { sections: ['worktree'], repoRoots: ['/repo'], fetchRemoteState: false },
    },
  ]);
});

test('unlockWorktree refreshes the worktree section for locked worktrees', async () => {
  const vscodeState = createVscodeState();
  const unlockWorktreeCalls = [];

  const { commandContext } = createWorktreeCommandsModule({
    vscodeState,
    gitMock: {
      async createWorktree() {},
      async renameWorktree() {},
      async removeWorktree() {},
      async pruneWorktrees() {},
      async lockWorktree() {},
      async unlockWorktree(repoRoot, worktreePath) {
        unlockWorktreeCalls.push({ repoRoot, worktreePath });
      },
      async getWorktrees() {
        return [];
      },
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.unlockWorktree']({
    nodeType: 'worktree',
    branchName: '/tmp/repo-feature-demo',
    repoRoot: '/repo',
    branchInfo: {
      worktreeLockedReason: 'In use elsewhere',
    },
  });

  assert.deepEqual(unlockWorktreeCalls, [
    {
      repoRoot: '/repo',
      worktreePath: '/tmp/repo-feature-demo',
    },
  ]);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: "Unlocked worktree 'repo-feature-demo'.",
      options: { sections: ['worktree'], repoRoots: ['/repo'], fetchRemoteState: false },
    },
  ]);
});

test('pruneWorktrees prunes stale worktree metadata and refreshes the worktree section', async () => {
  const vscodeState = createVscodeState();
  vscodeState.warningResponses.push('Prune');
  const pruneWorktreeCalls = [];

  const { commandContext } = createWorktreeCommandsModule({
    vscodeState,
    gitMock: {
      async createWorktree() {},
      async renameWorktree() {},
      async removeWorktree() {},
      async pruneWorktrees(repoRoot) {
        pruneWorktreeCalls.push(repoRoot);
      },
      async lockWorktree() {},
      async unlockWorktree() {},
      async getWorktrees() {
        return [
          {
            name: '/tmp/repo-missing-worktree',
            isCurrent: false,
            scope: 'worktree',
            worktreePrunableReason: 'gitdir file points to non-existent location',
          },
        ];
      },
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.pruneWorktrees']({
    nodeType: 'section',
    containerPath: 'section:worktree',
    repoRoot: '/repo',
  });

  assert.equal(vscodeState.warningMessages[0].options.modal, true);
  assert.match(vscodeState.warningMessages[0].message, /Prune stale worktree metadata/i);
  assert.deepEqual(pruneWorktreeCalls, ['/repo']);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: 'Pruned stale worktree metadata.',
      options: { sections: ['worktree'], repoRoots: ['/repo'], fetchRemoteState: false },
    },
  ]);
});

test('pruneWorktrees can target the clicked repository item directly', async () => {
  const vscodeState = createVscodeState();
  vscodeState.warningResponses.push('Prune');
  const pruneWorktreeCalls = [];

  const { commandContext } = createWorktreeCommandsModule({
    vscodeState,
    gitMock: {
      async createWorktree() {},
      async renameWorktree() {},
      async removeWorktree() {},
      async pruneWorktrees(repoRoot) {
        pruneWorktreeCalls.push(repoRoot);
      },
      async lockWorktree() {},
      async unlockWorktree() {},
      async getWorktrees() {
        return [
          {
            name: '/tmp/repo-b-missing-worktree',
            isCurrent: false,
            scope: 'worktree',
            worktreePrunableReason: 'gitdir file points to non-existent location',
          },
        ];
      },
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.pruneWorktrees']({
    nodeType: 'repository',
    repoRoot: '/repo-b',
  });

  assert.deepEqual(pruneWorktreeCalls, ['/repo-b']);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: 'Pruned stale worktree metadata.',
      options: { sections: ['worktree'], repoRoots: ['/repo-b'], fetchRemoteState: false },
    },
  ]);
});
