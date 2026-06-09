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
      'tags.defaultType': 'annotated',
      'tags.pushAfterCreate': false,
      'tags.requireMessageForAnnotated': true,
    },
    registeredCommands: {},
    executedCommands: [],
    errorMessages: [],
    infoMessages: [],
    inputBoxRequests: [],
    inputBoxResponses: [],
    quickPickRequests: [],
    quickPickResponses: [],
    warningMessages: [],
    warningResponses: [],
    clipboardWrites: [],
    openedDocuments: [],
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
      async openTextDocument(options) {
        state.openedDocuments.push(options);
        return {
          ...options,
          getText() {
            return options.content ?? '';
          },
        };
      },
    },
    window: {
      async showErrorMessage(message) {
        state.errorMessages.push(message);
        return undefined;
      },
      async showInformationMessage(message) {
        state.infoMessages.push(message);
        return undefined;
      },
      async showInputBox(options) {
        state.inputBoxRequests.push(options);
        return state.inputBoxResponses.shift();
      },
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
      async showTextDocument(document, options) {
        state.shownDocuments.push({ document, options });
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

function createTagCommandsModule({ vscodeState, gitMock, getGitApiImpl = async () => undefined }) {
  const commandContext = createCommandContext();
  const tagCommands = loadFresh('../out/commands/tagCommands.js', {
    vscode: createVscodeMock(vscodeState),
    '../extensionHelpers': {
      validateTagName() {
        return undefined;
      },
    },
    '../git': gitMock,
    '../treeProvider': {
      BranchTreeItem: class BranchTreeItem {},
    },
    './shared': {
      getGitApi: getGitApiImpl,
      NO_CURRENT_BRANCH_MESSAGE: 'No current git branch was found.',
    },
  });

  tagCommands.registerTagCommands({ subscriptions: [] }, commandContext.context);

  return {
    commandContext,
  };
}

test('createTag guides tag creation from the Tags section and creates an annotated tag on the selected ref', async () => {
  const vscodeState = createVscodeState();
  vscodeState.quickPickResponses = [
    (items) => items.find((item) => item.source?.refName === 'main'),
    (items) => items.find((item) => item.tagType === 'annotated'),
  ];
  vscodeState.inputBoxResponses = ['v2.0.0', 'Release 2.0.0'];
  const createTagCalls = [];

  const { commandContext } = createTagCommandsModule({
    vscodeState,
    gitMock: {
      async checkoutTag() {},
      async createTag(repoRoot, tagName, refName, options) {
        createTagCalls.push({ repoRoot, tagName, refName, options });
      },
      async deleteRemoteTag() {},
      async deleteTag() {},
      async getBranches() {
        return [{ name: 'main', isCurrent: true, lastCommitDate: 'just now' }];
      },
      async getDiffFilesBetweenRefs() {
        return [];
      },
      async getRemoteBranches() {
        return [];
      },
      async getRemotes() {
        return ['origin'];
      },
      async getStashes() {
        return [];
      },
      async getTagDetails() {
        return {};
      },
      async getTags() {
        return [];
      },
      async pushAllTags() {},
      async pushTag() {},
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.createTag']({
    nodeType: 'section',
    containerPath: 'section:tags',
    repoRoot: '/repo',
  });

  assert.deepEqual(commandContext.state.refreshCalls, [
    {
      sections: ['local', 'remote', 'stash', 'tags'],
      repoRoots: ['/repo'],
      fetchRemoteState: false,
    },
  ]);
  assert.deepEqual(createTagCalls, [
    {
      repoRoot: '/repo',
      tagName: 'v2.0.0',
      refName: 'main',
      options: {
        type: 'annotated',
        message: 'Release 2.0.0',
      },
    },
  ]);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: "Created annotated tag 'v2.0.0' on 'main'.",
      options: {
        sections: ['tags'],
        repoRoots: ['/repo'],
        fetchRemoteState: false,
      },
    },
  ]);
});

test('createTag can create and immediately push a signed annotated tag when configured', async () => {
  const vscodeState = createVscodeState();
  vscodeState.configuration['tags.pushAfterCreate'] = true;
  vscodeState.quickPickResponses = [
    (items) => items.find((item) => item.source?.refName === 'main'),
    (items) => items.find((item) => item.tagType === 'signedAnnotated'),
  ];
  vscodeState.inputBoxResponses = ['v3.0.0', 'Signed release'];
  const createTagCalls = [];
  const pushTagCalls = [];

  const { commandContext } = createTagCommandsModule({
    vscodeState,
    gitMock: {
      async checkoutTag() {},
      async createTag(repoRoot, tagName, refName, options) {
        createTagCalls.push({ repoRoot, tagName, refName, options });
      },
      async deleteRemoteTag() {},
      async deleteTag() {},
      async getBranches() {
        return [{ name: 'main', isCurrent: true }];
      },
      async getDiffFilesBetweenRefs() {
        return [];
      },
      async getRemoteBranches() {
        return [];
      },
      async getRemotes() {
        return ['origin'];
      },
      async getStashes() {
        return [];
      },
      async getTagDetails() {
        return {};
      },
      async getTags() {
        return [];
      },
      async pushAllTags() {},
      async pushTag(repoRoot, remoteName, tagName) {
        pushTagCalls.push({ repoRoot, remoteName, tagName });
      },
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.createTag']({
    nodeType: 'section',
    containerPath: 'section:tags',
    repoRoot: '/repo',
  });

  assert.deepEqual(createTagCalls, [
    {
      repoRoot: '/repo',
      tagName: 'v3.0.0',
      refName: 'main',
      options: {
        type: 'signedAnnotated',
        message: 'Signed release',
      },
    },
  ]);
  assert.deepEqual(pushTagCalls, [
    {
      repoRoot: '/repo',
      remoteName: 'origin',
      tagName: 'v3.0.0',
    },
  ]);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: "Created signed annotated tag 'v3.0.0' on 'main' and pushed it to 'origin'.",
      options: {
        sections: ['tags'],
        repoRoots: ['/repo'],
        fetchRemoteState: false,
      },
    },
  ]);
});

test('pushTag uses the only configured remote automatically', async () => {
  const vscodeState = createVscodeState();
  const pushTagCalls = [];

  const { commandContext } = createTagCommandsModule({
    vscodeState,
    gitMock: {
      async checkoutTag() {},
      async createTag() {},
      async deleteRemoteTag() {},
      async deleteTag() {},
      async getBranches() {
        return [];
      },
      async getDiffFilesBetweenRefs() {
        return [];
      },
      async getRemoteBranches() {
        return [];
      },
      async getRemotes() {
        return ['origin'];
      },
      async getStashes() {
        return [];
      },
      async getTagDetails() {
        return {};
      },
      async getTags() {
        return [];
      },
      async pushAllTags() {},
      async pushTag(repoRoot, remoteName, tagName) {
        pushTagCalls.push({ repoRoot, remoteName, tagName });
      },
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.pushTag']({
    nodeType: 'tag',
    branchName: 'v2.0.0',
    repoRoot: '/repo',
  });

  assert.deepEqual(pushTagCalls, [{ repoRoot: '/repo', remoteName: 'origin', tagName: 'v2.0.0' }]);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: "Pushed tag 'v2.0.0' to 'origin'.",
      options: {
        sections: ['tags'],
        repoRoots: ['/repo'],
        fetchRemoteState: false,
      },
    },
  ]);
});

test('pushAllTags can target the clicked repository item directly', async () => {
  const vscodeState = createVscodeState();
  const pushAllTagsCalls = [];

  const { commandContext } = createTagCommandsModule({
    vscodeState,
    gitMock: {
      async checkoutTag() {},
      async createTag() {},
      async deleteRemoteTag() {},
      async deleteTag() {},
      async getBranches() {
        return [];
      },
      async getDiffFilesBetweenRefs() {
        return [];
      },
      async getRemoteBranches() {
        return [];
      },
      async getRemotes() {
        return ['origin'];
      },
      async getStashes() {
        return [];
      },
      async getTagDetails() {
        return {};
      },
      async getTags() {
        return [];
      },
      async pushAllTags(repoRoot, remoteName) {
        pushAllTagsCalls.push({ repoRoot, remoteName });
      },
      async pushTag() {},
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.pushAllTags']({
    nodeType: 'repository',
    repoRoot: '/repo-b',
  });

  assert.deepEqual(pushAllTagsCalls, [{ repoRoot: '/repo-b', remoteName: 'origin' }]);
  assert.deepEqual(commandContext.state.successRefreshes, [
    {
      message: "Pushed all tags to 'origin'.",
      options: { fetchRemoteState: false },
    },
  ]);
});

test('deleteRemoteTag confirms and deletes the selected tag from the chosen remote', async () => {
  const vscodeState = createVscodeState();
  vscodeState.warningResponses.push('Delete Remote Tag');
  const deleteRemoteTagCalls = [];

  createTagCommandsModule({
    vscodeState,
    gitMock: {
      async checkoutTag() {},
      async createTag() {},
      async deleteRemoteTag(repoRoot, remoteName, tagName) {
        deleteRemoteTagCalls.push({ repoRoot, remoteName, tagName });
      },
      async deleteTag() {},
      async getBranches() {
        return [];
      },
      async getDiffFilesBetweenRefs() {
        return [];
      },
      async getRemoteBranches() {
        return [];
      },
      async getRemotes() {
        return ['origin'];
      },
      async getStashes() {
        return [];
      },
      async getTagDetails() {
        return {};
      },
      async getTags() {
        return [];
      },
      async pushAllTags() {},
      async pushTag() {},
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.deleteRemoteTag']({
    nodeType: 'tag',
    branchName: 'v2.0.0',
    repoRoot: '/repo',
  });

  assert.deepEqual(deleteRemoteTagCalls, [
    { repoRoot: '/repo', remoteName: 'origin', tagName: 'v2.0.0' },
  ]);
  assert.match(vscodeState.infoMessages.at(-1), /Deleted remote tag 'v2.0.0' from 'origin'/);
});

test('compareTagWithCurrent opens a multi-diff comparison against the current branch', async () => {
  const vscodeState = createVscodeState();

  const { commandContext } = createTagCommandsModule({
    vscodeState,
    gitMock: {
      async checkoutTag() {},
      async createTag() {},
      async deleteRemoteTag() {},
      async deleteTag() {},
      async getBranches() {
        return [];
      },
      async getDiffFilesBetweenRefs() {
        return [
          {
            status: 'M',
            path: 'README.md',
          },
        ];
      },
      async getRemoteBranches() {
        return [];
      },
      async getRemotes() {
        return ['origin'];
      },
      async getStashes() {
        return [];
      },
      async getTagDetails() {
        return {};
      },
      async getTags() {
        return [];
      },
      async pushAllTags() {},
      async pushTag() {},
    },
    getGitApiImpl: async () => ({
      getRepository() {
        return {
          rootUri: {
            path: '/repo',
          },
        };
      },
      toGitUri(uri, ref) {
        return { uri, ref };
      },
    }),
  });
  commandContext.state.currentBranch = {
    name: 'main',
    isCurrent: true,
  };

  await vscodeState.registeredCommands['gitBranchesPanel.compareTagWithCurrent']({
    nodeType: 'tag',
    branchName: 'v2.0.0',
    repoRoot: '/repo',
  });

  assert.equal(vscodeState.executedCommands.length, 1);
  assert.equal(vscodeState.executedCommands[0].command, '_workbench.openMultiDiffEditor');
  assert.match(vscodeState.executedCommands[0].args[0].title, /Compare tag 'v2.0.0' with current 'main'/);
});

test('copyTagTargetSha loads tag details and writes the peeled target SHA to the clipboard', async () => {
  const vscodeState = createVscodeState();

  createTagCommandsModule({
    vscodeState,
    gitMock: {
      async checkoutTag() {},
      async createTag() {},
      async deleteRemoteTag() {},
      async deleteTag() {},
      async getBranches() {
        return [];
      },
      async getDiffFilesBetweenRefs() {
        return [];
      },
      async getRemoteBranches() {
        return [];
      },
      async getRemotes() {
        return ['origin'];
      },
      async getStashes() {
        return [];
      },
      async getTagDetails() {
        return {
          name: 'v2.0.0',
          type: 'annotated',
          tagObjectSha: '1111111',
          targetSha: '2222222',
          targetType: 'commit',
          isSigned: false,
        };
      },
      async getTags() {
        return [];
      },
      async pushAllTags() {},
      async pushTag() {},
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.copyTagTargetSha']({
    nodeType: 'tag',
    branchName: 'v2.0.0',
    repoRoot: '/repo',
  });

  assert.deepEqual(vscodeState.clipboardWrites, ['2222222']);
  assert.match(vscodeState.infoMessages.at(-1), /Copied target SHA for tag 'v2.0.0'/);
});
