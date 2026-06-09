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
      'history.maxCommits': 50,
      'history.includeMerges': true,
    },
    registeredCommands: {},
    executedCommands: [],
    quickPickRequests: [],
    quickPickSelector: undefined,
    infoMessages: [],
    errorMessages: [],
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
            return Object.prototype.hasOwnProperty.call(state.configurationValues, key)
              ? state.configurationValues[key]
              : defaultValue;
          },
        };
      },
      async openTextDocument(options) {
        state.openedDocuments.push(options);
        return options;
      },
    },
    window: {
      async showQuickPick(items, options) {
        state.quickPickRequests.push({ items, options });
        return typeof state.quickPickSelector === 'function'
          ? state.quickPickSelector(items, options)
          : undefined;
      },
      showInformationMessage(message) {
        state.infoMessages.push(message);
      },
      showErrorMessage(message) {
        state.errorMessages.push(message);
      },
      async showTextDocument(document, options) {
        state.shownDocuments.push({ document, options });
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
    refreshCalls: [],
    commandErrors: [],
    repoRoot: '/repo',
    currentBranch: {
      name: 'main',
      isCurrent: true,
      upstreamName: 'origin/main',
    },
  };

  const searchTreeData = [
    {
      kind: 'section',
      label: 'Local',
      path: 'section:local',
      scope: 'local',
      repoRoot: '/repo',
      children: [
        {
          kind: 'branch',
          fullName: 'feature/demo',
          label: 'demo',
          path: 'feature/demo',
          repoRoot: '/repo',
          info: {
            name: 'feature/demo',
            isCurrent: false,
            upstreamName: 'origin/feature/demo',
            lastCommitTimestamp: 10,
          },
        },
        {
          kind: 'branch',
          fullName: 'main',
          label: 'main',
          path: 'main',
          repoRoot: '/repo',
          info: {
            name: 'main',
            isCurrent: true,
            upstreamName: 'origin/main',
            lastCommitTimestamp: 20,
          },
        },
      ],
    },
    {
      kind: 'section',
      label: 'Remote',
      path: 'section:remote',
      scope: 'remote',
      repoRoot: '/repo',
      children: [
        {
          kind: 'branch',
          fullName: 'origin/release/2026.06',
          label: '2026.06',
          path: 'origin/release/2026.06',
          repoRoot: '/repo',
          info: {
            name: 'origin/release/2026.06',
            isCurrent: false,
            scope: 'remote',
            remoteName: 'origin',
            lastCommitTimestamp: 12,
          },
        },
      ],
    },
    {
      kind: 'section',
      label: 'Tags',
      path: 'section:tags',
      scope: 'tag',
      repoRoot: '/repo',
      children: [
        {
          kind: 'branch',
          fullName: 'v1.0.0',
          label: 'v1.0.0',
          path: 'v1.0.0',
          repoRoot: '/repo',
          info: {
            name: 'v1.0.0',
            isCurrent: false,
            scope: 'tag',
            lastCommitTimestamp: 8,
          },
        },
      ],
    },
    {
      kind: 'section',
      label: 'Stash',
      path: 'section:stash',
      scope: 'stash',
      repoRoot: '/repo',
      children: [
        {
          kind: 'branch',
          fullName: 'stash@{0}',
          label: 'stash@{0}',
          path: 'stash@{0}',
          repoRoot: '/repo',
          info: {
            name: 'stash@{0}',
            isCurrent: false,
            scope: 'stash',
            stashRevision: 'stash-sha',
            lastCommitTimestamp: 5,
          },
        },
      ],
    },
  ];

  return {
    state,
    context: {
      provider: {
        getCurrentBranch(repoRoot) {
          return repoRoot === '/repo' ? state.currentBranch : undefined;
        },
        getSearchTreeData() {
          return searchTreeData;
        },
      },
      async requireRepoRoot() {
        return state.repoRoot;
      },
      async requireCurrentBranch() {
        return state.currentBranch;
      },
      async refresh(options = {}) {
        state.refreshCalls.push(options);
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

function createHistoryCommandsModule(vscodeState, gitOverrides = {}) {
  const commandContext = createCommandContext();
  const historyCommands = loadFresh('../out/commands/historyCommands.js', {
    vscode: createVscodeMock(vscodeState),
    '../git': {
      async getChangedFilesForCommit() {
        return [];
      },
      async getDiffFilesBetweenRefs() {
        return [];
      },
      async getRefHistory() {
        return [];
      },
      ...gitOverrides,
    },
    '../errorUtils': {
      getErrorMessage(error) {
        return error instanceof Error ? error.message : String(error);
      },
    },
    '../treeProvider': {
      BranchTreeItem: class BranchTreeItem {},
    },
    './shared': {
      NO_CURRENT_BRANCH_MESSAGE: 'No current branch',
      async getGitApi() {
        return {
          getRepository() {
            return {
              rootUri: {
                fsPath: '/repo',
                path: '/repo',
              },
            };
          },
          toGitUri(uri, ref) {
            return {
              fsPath: uri.fsPath,
              path: `${uri.path}@${ref}`,
              ref,
            };
          },
        };
      },
    },
  });

  historyCommands.registerHistoryCommands({ subscriptions: [] }, commandContext.context);
  return { commandContext };
}

test('compareWithUpstream opens a multi diff between the selected branch and its upstream', async () => {
  const vscodeState = createVscodeState();
  const diffCalls = [];

  createHistoryCommandsModule(vscodeState, {
    async getDiffFilesBetweenRefs(repoRoot, leftRef, rightRef) {
      diffCalls.push({ repoRoot, leftRef, rightRef });
      return [{ status: 'M', path: 'README.md' }];
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.compareWithUpstream']({
    nodeType: 'branch',
    branchName: 'feature/demo',
    repoRoot: '/repo',
    branchInfo: {
      name: 'feature/demo',
      isCurrent: false,
      upstreamName: 'origin/feature/demo',
    },
  });

  assert.deepEqual(diffCalls, [
    { repoRoot: '/repo', leftRef: 'origin/feature/demo', rightRef: 'feature/demo' },
  ]);
  assert.equal(vscodeState.executedCommands[0].command, '_workbench.openMultiDiffEditor');
  assert.equal(
    vscodeState.executedCommands[0].args[0].title,
    "Compare 'feature/demo' with upstream 'origin/feature/demo'"
  );
});

test('compareTwoRefs prompts for two refs and opens a multi diff comparison', async () => {
  const vscodeState = createVscodeState();
  let quickPickCall = 0;
  vscodeState.quickPickSelector = (items, options) => {
    quickPickCall += 1;
    if (quickPickCall === 1) {
      assert.match(options.placeHolder, /first ref/i);
      return items.find((item) => item.label === 'feature/demo');
    }

    assert.match(options.placeHolder, /compare against 'feature\/demo'/i);
    return items.find((item) => item.label === 'v1.0.0');
  };
  const diffCalls = [];
  const { commandContext } = createHistoryCommandsModule(vscodeState, {
    async getDiffFilesBetweenRefs(repoRoot, leftRef, rightRef) {
      diffCalls.push({ repoRoot, leftRef, rightRef });
      return [{ status: 'A', path: 'release.txt' }];
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.compareTwoRefs']();

  assert.deepEqual(commandContext.state.refreshCalls, [
    {
      sections: ['local', 'remote', 'stash', 'tags'],
      repoRoots: ['/repo'],
      fetchRemoteState: false,
    },
  ]);
  assert.deepEqual(diffCalls, [
    { repoRoot: '/repo', leftRef: 'feature/demo', rightRef: 'v1.0.0' },
  ]);
  assert.equal(vscodeState.executedCommands[0].command, '_workbench.openMultiDiffEditor');
});

test('showRefHistory lets the user pick a commit and then open changed files for it', async () => {
  const vscodeState = createVscodeState();
  let quickPickCall = 0;
  vscodeState.quickPickSelector = (items, options) => {
    quickPickCall += 1;
    if (quickPickCall === 1) {
      assert.match(options.placeHolder, /feature\/demo/i);
      return items[0];
    }

    assert.match(options.placeHolder, /Choose an action for commit/u);
    return items.find((item) => item.label.includes('Open Changed Files'));
  };

  createHistoryCommandsModule(vscodeState, {
    async getRefHistory() {
      return [
        {
          sha: 'abcdef1234567890',
          shortSha: 'abcdef1',
          authorName: 'Test User',
          authorEmail: 'test@example.com',
          authorTimestamp: 123,
          authorRelativeDate: '2 hours ago',
          subject: 'Add feature',
          body: 'Add feature\n\nDetails.',
          parentShas: ['1234567890abcdef'],
        },
      ];
    },
    async getChangedFilesForCommit() {
      return [
        { status: 'M', path: 'README.md' },
        { status: 'A', path: 'feature.txt' },
      ];
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.showBranchCommits']({
    nodeType: 'branch',
    branchName: 'feature/demo',
    repoRoot: '/repo',
    branchInfo: {
      name: 'feature/demo',
      isCurrent: false,
      upstreamName: 'origin/feature/demo',
    },
  });

  assert.equal(vscodeState.executedCommands[0].command, '_workbench.openMultiDiffEditor');
  assert.equal(
    vscodeState.executedCommands[0].args[0].title,
    "Changed files for commit 'abcdef1' on 'feature/demo'"
  );
});

test('openChangedFilesForRef loads the latest commit for a tag and opens its changed files', async () => {
  const vscodeState = createVscodeState();
  const historyCalls = [];

  createHistoryCommandsModule(vscodeState, {
    async getRefHistory(repoRoot, refName, options) {
      historyCalls.push({ repoRoot, refName, options });
      return [
        {
          sha: 'fedcba0987654321',
          shortSha: 'fedcba0',
          authorName: 'Release Bot',
          authorEmail: 'bot@example.com',
          authorTimestamp: 456,
          authorRelativeDate: '1 day ago',
          subject: 'Release v1.0.0',
          body: 'Release v1.0.0',
          parentShas: ['aaaaaaaaaaaaaaaa'],
        },
      ];
    },
    async getChangedFilesForCommit() {
      return [{ status: 'A', path: 'release-notes.md' }];
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.openChangedFilesForRef']({
    nodeType: 'tag',
    branchName: 'v1.0.0',
    repoRoot: '/repo',
    branchInfo: {
      name: 'v1.0.0',
      isCurrent: false,
      scope: 'tag',
    },
  });

  assert.deepEqual(historyCalls, [
    {
      repoRoot: '/repo',
      refName: 'v1.0.0',
      options: { limit: 1, includeMerges: true },
    },
  ]);
  assert.equal(vscodeState.executedCommands[0].command, '_workbench.openMultiDiffEditor');
});

test('showRefHistory can open commit details in a temporary markdown document', async () => {
  const vscodeState = createVscodeState();
  let quickPickCall = 0;
  vscodeState.quickPickSelector = (items) => {
    quickPickCall += 1;
    return quickPickCall === 1
      ? items[0]
      : items.find((item) => item.label.includes('Open Commit Details'));
  };

  createHistoryCommandsModule(vscodeState, {
    async getRefHistory() {
      return [
        {
          sha: '0123456789abcdef',
          shortSha: '0123456',
          authorName: 'Test User',
          authorEmail: 'test@example.com',
          authorTimestamp: 789,
          authorRelativeDate: '3 hours ago',
          subject: 'Document feature',
          body: 'Document feature\n\nMore details.',
          parentShas: ['1111111111111111'],
        },
      ];
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.showRefHistory']({
    nodeType: 'tag',
    branchName: 'v1.0.0',
    repoRoot: '/repo',
    branchInfo: {
      name: 'v1.0.0',
      isCurrent: false,
      scope: 'tag',
    },
  });

  assert.equal(vscodeState.openedDocuments.length, 1);
  assert.match(vscodeState.openedDocuments[0].content, /Commit 0123456/);
  assert.equal(vscodeState.shownDocuments.length, 1);
});
