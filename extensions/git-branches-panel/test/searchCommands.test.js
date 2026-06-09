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

function createVscodeMock(state) {
  return {
    window: {
      async showInputBox() {
        return state.inputBoxResponses.shift();
      },
      async showQuickPick(items, options) {
        state.quickPickCalls.push({ items, options });
        const response = state.quickPickResponses.shift();
        if (typeof response === 'function') {
          return response(items, options);
        }

        return response;
      },
      showInformationMessage(message) {
        state.informationMessages.push(message);
      },
    },
    commands: {
      registerCommand(command, callback) {
        state.registeredCommands.set(command, callback);
        return { dispose() {} };
      },
      async executeCommand(command, ...args) {
        state.executedCommands.push({ command, args });
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
        };
      },
    },
    env: {
      clipboard: {
        async writeText(value) {
          state.clipboardWrites.push(value);
        },
      },
    },
  };
}

function createBranchTreeItemMock() {
  return {
    BranchTreeItem: class BranchTreeItem {
      constructor(node) {
        this.branchName = node.kind === 'branch' ? node.fullName : undefined;
        this.repoRoot = node.repoRoot;
        this.branchInfo = node.kind === 'branch' ? node.info : undefined;
        this.nodeType = resolveNodeType(node);
      }
    },
  };
}

function resolveNodeType(node) {
  if (node.kind !== 'branch') {
    return node.kind;
  }

  if (node.info.scope === 'remote') {
    return node.info.remoteTrackingState === 'stale' ? 'staleRemoteBranch' : 'remoteBranch';
  }

  if (node.info.scope === 'tag') {
    return 'tag';
  }

  if (node.info.scope === 'stash') {
    return 'stash';
  }

  if (node.info.scope === 'worktree') {
    return 'worktree';
  }

  if (node.info.scope === 'hook') {
    return 'hook';
  }

  if (node.info.upstreamMissing) {
    return 'missingUpstreamBranch';
  }

  return node.info.isCurrent ? 'currentBranch' : 'branch';
}

function createCommandContext() {
  const state = {
    refreshCalls: [],
    setFilterQueries: [],
    revealCalls: [],
    activeRepositoryItems: [],
    clearFilterCalls: 0,
    needsAttentionCalls: 0,
    toggledPinnedOnly: false,
  };

  const commandContext = {
    provider: {
      getRepositoryDescriptors: () => [
        { repoRoot: '/repo-a', label: 'repo-a' },
        { repoRoot: '/repo-b', label: 'repo-b' },
      ],
      getVisibleRepoRoots: () => ['/repo-a'],
      getSearchTreeData: () => [
        {
          kind: 'repository',
          label: 'repo-a',
          path: 'repo:/repo-a',
          repoRoot: '/repo-a',
          children: [
            {
              kind: 'section',
              label: 'Local',
              path: 'section:local',
              scope: 'local',
              repoRoot: '/repo-a',
              children: [
                {
                  kind: 'branch',
                  fullName: 'feature/demo',
                  label: 'demo',
                  path: 'feature/demo',
                  repoRoot: '/repo-a',
                  info: {
                    name: 'feature/demo',
                    isCurrent: false,
                    isPinned: true,
                    lastCommitTimestamp: 10,
                  },
                },
              ],
            },
          ],
        },
      ],
      async setActiveRepositoryFromItem(item) {
        state.activeRepositoryItems.push(item.branchName);
      },
      async revealItem(item, options) {
        state.revealCalls.push({ item, options });
      },
      getFilterQuery: () => 'remote:origin',
      async setFilterQuery(query) {
        state.setFilterQueries.push(query);
      },
      async clearFilter() {
        state.clearFilterCalls += 1;
      },
      async toggleShowOnlyPinned() {
        state.toggledPinnedOnly = !state.toggledPinnedOnly;
        return state.toggledPinnedOnly;
      },
      async showNeedsAttention() {
        state.needsAttentionCalls += 1;
      },
    },
    async refresh(options) {
      state.refreshCalls.push(options);
    },
  };

  return { commandContext, state };
}

test('setFilter auto-loads visible sections and forwards the query to the provider', async () => {
  const { commandContext, state: commandState } = createCommandContext();
  const vscodeState = {
    configuration: {
      'search.autoLoadAllSections': true,
    },
    inputBoxResponses: ['local:feature'],
    quickPickResponses: [],
    quickPickCalls: [],
    informationMessages: [],
    executedCommands: [],
    registeredCommands: new Map(),
    clipboardWrites: [],
  };
  const { registerSearchCommands } = loadFresh('../out/commands/searchCommands.js', {
    vscode: createVscodeMock(vscodeState),
    '../treeProvider': createBranchTreeItemMock(),
  });

  registerSearchCommands({ subscriptions: [] }, commandContext);
  await vscodeState.registeredCommands.get('gitBranchesPanel.setFilter')();

  assert.deepEqual(commandState.refreshCalls, [
    {
      sections: ['local', 'remote', 'stash', 'worktree', 'hooks', 'tags'],
      repoRoots: ['/repo-a'],
      fetchRemoteState: false,
    },
  ]);
  assert.deepEqual(commandState.setFilterQueries, ['local:feature']);
});

test('showNeedsAttention auto-loads visible sections and applies the preset filter', async () => {
  const { commandContext, state: commandState } = createCommandContext();
  const vscodeState = {
    configuration: {
      'search.autoLoadAllSections': true,
    },
    inputBoxResponses: [],
    quickPickResponses: [],
    quickPickCalls: [],
    informationMessages: [],
    executedCommands: [],
    registeredCommands: new Map(),
    clipboardWrites: [],
  };
  const { registerSearchCommands } = loadFresh('../out/commands/searchCommands.js', {
    vscode: createVscodeMock(vscodeState),
    '../treeProvider': createBranchTreeItemMock(),
  });

  registerSearchCommands({ subscriptions: [] }, commandContext);
  await vscodeState.registeredCommands.get('gitBranchesPanel.showNeedsAttention')();

  assert.equal(commandState.needsAttentionCalls, 1);
  assert.deepEqual(commandState.refreshCalls, [
    {
      sections: ['local', 'remote', 'stash', 'worktree', 'hooks', 'tags'],
      repoRoots: ['/repo-a'],
      fetchRemoteState: false,
    },
  ]);
});

test('toggleShowOnlyPinned toggles the provider state and reports the new mode', async () => {
  const { commandContext } = createCommandContext();
  const vscodeState = {
    configuration: {},
    inputBoxResponses: [],
    quickPickResponses: [],
    quickPickCalls: [],
    informationMessages: [],
    executedCommands: [],
    registeredCommands: new Map(),
    clipboardWrites: [],
  };
  const { registerSearchCommands } = loadFresh('../out/commands/searchCommands.js', {
    vscode: createVscodeMock(vscodeState),
    '../treeProvider': createBranchTreeItemMock(),
  });

  registerSearchCommands({ subscriptions: [] }, commandContext);
  await vscodeState.registeredCommands.get('gitBranchesPanel.toggleShowOnlyPinned')();
  await vscodeState.registeredCommands.get('gitBranchesPanel.toggleShowOnlyPinned')();

  assert.deepEqual(vscodeState.informationMessages, [
    'Showing only pinned refs.',
    'Showing pinned and unpinned refs.',
  ]);
});

test('findRef loads searchable sections, lets the user choose a result, and routes the selected action', async () => {
  const { commandContext, state: commandState } = createCommandContext();
  const vscodeState = {
    configuration: {
      'search.autoLoadAllSections': true,
      'search.maxResults': 50,
    },
    inputBoxResponses: ['feature'],
    quickPickResponses: [
      (items, options) => {
        assert.match(options.placeHolder, /Choose a ref/);
        return items[0];
      },
      (items, options) => {
        assert.match(options.placeHolder, /Choose an action/);
        return items.find((item) => item.label.includes('Checkout Branch'));
      },
    ],
    quickPickCalls: [],
    informationMessages: [],
    executedCommands: [],
    registeredCommands: new Map(),
    clipboardWrites: [],
  };
  const { registerSearchCommands } = loadFresh('../out/commands/searchCommands.js', {
    vscode: createVscodeMock(vscodeState),
    '../treeProvider': createBranchTreeItemMock(),
  });

  registerSearchCommands({ subscriptions: [] }, commandContext);
  await vscodeState.registeredCommands.get('gitBranchesPanel.findRef')();

  assert.deepEqual(commandState.refreshCalls, [
    {
      sections: ['local', 'remote', 'stash', 'worktree', 'hooks', 'tags'],
      repoRoots: ['/repo-a', '/repo-b'],
      fetchRemoteState: false,
    },
  ]);
  assert.deepEqual(commandState.activeRepositoryItems, ['feature/demo']);
  assert.equal(vscodeState.executedCommands.length, 1);
  assert.equal(vscodeState.executedCommands[0].command, 'gitBranchesPanel.checkout');
  assert.equal(vscodeState.executedCommands[0].args[0].branchName, 'feature/demo');
  assert.equal(vscodeState.executedCommands[0].args[0].repoRoot, '/repo-a');
  assert.equal(vscodeState.executedCommands[0].args[0].nodeType, 'branch');
  assert.deepEqual(vscodeState.executedCommands[0].args[0].branchInfo, {
    name: 'feature/demo',
    isCurrent: false,
    isPinned: true,
    lastCommitTimestamp: 10,
  });
});
