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
      'remoteHosting.customProviders': [],
    },
    registeredCommands: {},
    inputBoxRequests: [],
    inputBoxResponses: [],
    warningMessages: [],
    warningResponses: [],
    informationMessages: [],
    errorMessages: [],
    openedUrls: [],
    clipboardWrites: [],
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
    },
    window: {
      async showInputBox(options) {
        state.inputBoxRequests.push(options);
        return state.inputBoxResponses.shift();
      },
      async showWarningMessage(message, options, ...items) {
        state.warningMessages.push({ message, options, items });
        if (options?.modal) {
          return state.warningResponses.shift();
        }

        return undefined;
      },
      showInformationMessage(message) {
        state.informationMessages.push(message);
      },
      showErrorMessage(message) {
        state.errorMessages.push(message);
      },
    },
    env: {
      clipboard: {
        async writeText(value) {
          state.clipboardWrites.push(value);
        },
      },
      async openExternal(uri) {
        state.openedUrls.push(uri.value ?? String(uri));
        return true;
      },
    },
    Uri: {
      parse(value) {
        return { value };
      },
    },
  };
}

function createCommandContext() {
  const state = {
    refreshes: [],
    errors: [],
  };

  return {
    state,
    context: {
      provider: {},
      async requireRepoRoot() {
        return '/repo';
      },
      async showSuccessAndRefresh(message, options = {}) {
        state.refreshes.push({ message, options });
      },
      showCommandError(prefix, error) {
        state.errors.push({
          prefix,
          message: error instanceof Error ? error.message : String(error),
        });
      },
    },
  };
}

function createRemoteCommandsModule(vscodeState, gitOverrides = {}) {
  const commandContext = createCommandContext();
  const remoteCommands = loadFresh('../out/commands/remoteCommands.js', {
    vscode: createVscodeMock(vscodeState),
    '../git': {
      addRemote: async () => {},
      buildRepositoryHomeUrl: (repository) => `${repository.hostRoot}/${repository.namespace}/${repository.repository}`,
      fetchRemote: async () => {},
      getRemoteDetails: async () => [
        {
          name: 'origin',
          fetchUrl: 'https://github.com/octo/repo.git',
          pushUrl: 'https://github.com/octo/repo.git',
          isDefault: true,
          hostProvider: 'GitHub',
        },
      ],
      getRemotes: async () => ['origin'],
      parseCustomRemoteHostingProviders: () => [],
      removeRemote: async () => {},
      renameRemote: async () => {},
      resolveHostedRepository: (remoteInfo) => ({
        provider: 'github',
        providerLabel: 'GitHub',
        remoteName: remoteInfo.name,
        remoteUrl: remoteInfo.fetchUrl,
        hostRoot: 'https://github.com',
        namespace: 'octo',
        repository: 'repo',
      }),
      setRemoteFetchUrl: async () => {},
      setRemotePushUrl: async () => {},
      ...gitOverrides,
    },
    '../treeProvider': {
      BranchTreeItem: class BranchTreeItem {},
    },
  });

  remoteCommands.registerRemoteCommands({ subscriptions: [] }, commandContext.context);
  return { commandContext };
}

test('addRemote prompts for name and URLs, then refreshes remote sections', async () => {
  const vscodeState = createVscodeState();
  vscodeState.inputBoxResponses.push('upstream', 'https://example.com/upstream.git', 'ssh://push.example.com/upstream.git');
  const addCalls = [];
  const setPushCalls = [];

  const { commandContext } = createRemoteCommandsModule(vscodeState, {
    getRemotes: async () => ['origin'],
    addRemote: async (repoRoot, remoteName, remoteUrl) => {
      addCalls.push({ repoRoot, remoteName, remoteUrl });
    },
    setRemotePushUrl: async (repoRoot, remoteName, remoteUrl) => {
      setPushCalls.push({ repoRoot, remoteName, remoteUrl });
    },
  });

  await vscodeState.registeredCommands['gitBranchesPanel.addRemote']({
    nodeType: 'section',
    containerScope: 'remoteConfig',
    repoRoot: '/repo',
  });

  assert.deepEqual(addCalls, [
    { repoRoot: '/repo', remoteName: 'upstream', remoteUrl: 'https://example.com/upstream.git' },
  ]);
  assert.deepEqual(setPushCalls, [
    { repoRoot: '/repo', remoteName: 'upstream', remoteUrl: 'ssh://push.example.com/upstream.git' },
  ]);
  assert.deepEqual(commandContext.state.refreshes, [
    {
      message: "Added remote 'upstream' with separate fetch and push URLs.",
      options: { sections: ['local', 'remote', 'remotes'], repoRoots: ['/repo'], fetchRemoteState: false },
    },
  ]);
});

test('fetchRemote and fetchRemotePrune target the selected remote item', async () => {
  const vscodeState = createVscodeState();
  const fetchCalls = [];

  const { commandContext } = createRemoteCommandsModule(vscodeState, {
    fetchRemote: async (repoRoot, remoteName, options) => {
      fetchCalls.push({ repoRoot, remoteName, options });
    },
  });

  const item = {
    nodeType: 'remoteConfig',
    repoRoot: '/repo',
    remoteInfo: {
      name: 'origin',
      fetchUrl: 'https://github.com/octo/repo.git',
      pushUrl: 'https://github.com/octo/repo.git',
    },
  };

  await vscodeState.registeredCommands['gitBranchesPanel.fetchRemote'](item);
  await vscodeState.registeredCommands['gitBranchesPanel.fetchRemotePrune'](item);

  assert.deepEqual(fetchCalls, [
    { repoRoot: '/repo', remoteName: 'origin', options: { prune: false } },
    { repoRoot: '/repo', remoteName: 'origin', options: { prune: true } },
  ]);
  assert.deepEqual(commandContext.state.refreshes, [
    {
      message: "Fetched remote 'origin'.",
      options: { sections: ['local', 'remote', 'remotes'], repoRoots: ['/repo'], fetchRemoteState: false },
    },
    {
      message: "Fetched remote 'origin' and pruned deleted refs.",
      options: { sections: ['local', 'remote', 'remotes'], repoRoots: ['/repo'], fetchRemoteState: false },
    },
  ]);
});

test('copy/open remote commands use the selected remote metadata', async () => {
  const vscodeState = createVscodeState();

  createRemoteCommandsModule(vscodeState, {
    buildRepositoryHomeUrl: () => 'https://github.com/octo/repo',
  });

  const item = {
    nodeType: 'remoteConfig',
    repoRoot: '/repo',
    remoteInfo: {
      name: 'origin',
      fetchUrl: 'https://github.com/octo/repo.git',
      pushUrl: 'git@github.com:octo/repo.git',
    },
  };

  await vscodeState.registeredCommands['gitBranchesPanel.copyRemoteFetchUrl'](item);
  await vscodeState.registeredCommands['gitBranchesPanel.copyRemotePushUrl'](item);
  await vscodeState.registeredCommands['gitBranchesPanel.openRemoteHomepage'](item);

  assert.deepEqual(vscodeState.clipboardWrites, [
    'https://github.com/octo/repo.git',
    'git@github.com:octo/repo.git',
  ]);
  assert.deepEqual(vscodeState.informationMessages, [
    "Copied fetch URL for remote 'origin' to the clipboard.",
    "Copied push URL for remote 'origin' to the clipboard.",
  ]);
  assert.deepEqual(vscodeState.openedUrls, ['https://github.com/octo/repo']);
});

test('renameRemote, setRemoteFetchUrl, setRemotePushUrl, and removeRemote refresh the affected sections', async () => {
  const vscodeState = createVscodeState();
  vscodeState.inputBoxResponses.push('upstream', 'https://fetch.example.com/repo.git', 'ssh://push.example.com/repo.git');
  vscodeState.warningResponses.push('Remove Remote');
  const renameCalls = [];
  const setFetchCalls = [];
  const setPushCalls = [];
  const removeCalls = [];

  const { commandContext } = createRemoteCommandsModule(vscodeState, {
    getRemotes: async () => ['origin'],
    renameRemote: async (repoRoot, remoteName, newRemoteName) => {
      renameCalls.push({ repoRoot, remoteName, newRemoteName });
    },
    setRemoteFetchUrl: async (repoRoot, remoteName, remoteUrl) => {
      setFetchCalls.push({ repoRoot, remoteName, remoteUrl });
    },
    setRemotePushUrl: async (repoRoot, remoteName, remoteUrl) => {
      setPushCalls.push({ repoRoot, remoteName, remoteUrl });
    },
    removeRemote: async (repoRoot, remoteName) => {
      removeCalls.push({ repoRoot, remoteName });
    },
  });

  const item = {
    nodeType: 'remoteConfig',
    repoRoot: '/repo',
    remoteInfo: {
      name: 'origin',
      fetchUrl: 'https://github.com/octo/repo.git',
      pushUrl: 'https://github.com/octo/repo.git',
    },
  };

  await vscodeState.registeredCommands['gitBranchesPanel.renameRemote'](item);
  await vscodeState.registeredCommands['gitBranchesPanel.setRemoteFetchUrl'](item);
  await vscodeState.registeredCommands['gitBranchesPanel.setRemotePushUrl'](item);
  await vscodeState.registeredCommands['gitBranchesPanel.removeRemote'](item);

  assert.deepEqual(renameCalls, [{ repoRoot: '/repo', remoteName: 'origin', newRemoteName: 'upstream' }]);
  assert.deepEqual(setFetchCalls, [{ repoRoot: '/repo', remoteName: 'origin', remoteUrl: 'https://fetch.example.com/repo.git' }]);
  assert.deepEqual(setPushCalls, [{ repoRoot: '/repo', remoteName: 'origin', remoteUrl: 'ssh://push.example.com/repo.git' }]);
  assert.deepEqual(removeCalls, [{ repoRoot: '/repo', remoteName: 'origin' }]);
  assert.deepEqual(commandContext.state.refreshes, [
    {
      message: "Renamed remote 'origin' to 'upstream'.",
      options: { sections: ['local', 'remote', 'remotes'], repoRoots: ['/repo'], fetchRemoteState: false },
    },
    {
      message: "Updated fetch URL for remote 'origin'.",
      options: { sections: ['local', 'remote', 'remotes'], repoRoots: ['/repo'], fetchRemoteState: false },
    },
    {
      message: "Updated push URL for remote 'origin'.",
      options: { sections: ['local', 'remote', 'remotes'], repoRoots: ['/repo'], fetchRemoteState: false },
    },
    {
      message: "Removed remote 'origin'.",
      options: { sections: ['local', 'remote', 'remotes'], repoRoots: ['/repo'], fetchRemoteState: false },
    },
  ]);
});
