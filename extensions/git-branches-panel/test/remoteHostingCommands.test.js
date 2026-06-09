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
      'remoteHosting.compareBase': 'defaultBranch',
      'remoteHosting.preferredRemote': '',
      'remoteHosting.customProviders': [],
    },
    registeredCommands: {},
    executedCommands: [],
    quickPickRequests: [],
    quickPickSelector: undefined,
    infoMessages: [],
    warningMessages: [],
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
      async executeCommand(command, ...args) {
        state.executedCommands.push({ command, args });
      },
    },
    env: {
      clipboard: {
        async writeText(value) {
          state.clipboardWrites.push(value);
        },
      },
      async openExternal(uri) {
        state.openedUrls.push(uri.value ?? uri.toString?.() ?? String(uri));
        return true;
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
        return { fsPath: value, path: value, value };
      },
      from(value) {
        return value;
      },
      parse(value) {
        return { value };
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
      showWarningMessage(message) {
        state.warningMessages.push(message);
        return undefined;
      },
      showErrorMessage(message) {
        state.errorMessages.push(message);
        return undefined;
      },
      async showInputBox() {
        return undefined;
      },
    },
  };
}

function createCommandContext(currentBranchName = 'main') {
  const state = {
    currentBranchName,
  };

  return {
    state,
    context: {
      provider: {
        getCurrentBranch() {
          return currentBranchName
            ? {
                name: currentBranchName,
                isCurrent: true,
              }
            : undefined;
        },
        async withBusyBranch(_repoRoot, _branchName, operation) {
          return operation();
        },
      },
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
        return currentBranchName
          ? {
              name: currentBranchName,
              isCurrent: true,
            }
          : undefined;
      },
      async showSuccessAndRefresh() {},
      showCommandError() {},
    },
  };
}

function createBranchCommandsModule(vscodeState, gitOverrides = {}, currentBranchName = 'main') {
  const commandContext = createCommandContext(currentBranchName);
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
        return value;
      },
      sanitizeNewBranchName(value) {
        return value;
      },
      validateBranchName() {
        return undefined;
      },
      validateNewBranchNameInput() {
        return undefined;
      },
    },
    '../git': {
      buildBranchWebUrl: (repository, branchName) => `${repository.hostRoot}/branch/${branchName}`,
      buildCompareWebUrl: (repository, baseBranchName, branchName) => `${repository.hostRoot}/compare/${baseBranchName}...${branchName}`,
      buildPullRequestWebUrl: (repository, baseBranchName, branchName) => `${repository.hostRoot}/pull/new?base=${baseBranchName}&head=${branchName}`,
      cherryPickRef() {},
      checkoutBranch() {},
      checkoutRemoteBranch() {},
      createBranch() {},
      createBranchFromRef() {},
      deleteBranch() {},
      deleteRemoteBranch() {},
      getDiffFilesBetweenRefs() {
        return [];
      },
      getRemoteBranchTrackingState() {
        return 'live';
      },
      getRemoteDefaultBranch: async () => 'main',
      getRemoteDetails: async () => [
        {
          name: 'origin',
          fetchUrl: 'https://github.com/octo/repo.git',
          pushUrl: 'https://github.com/octo/repo.git',
        },
        {
          name: 'fork',
          fetchUrl: 'https://github.com/fork/repo.git',
          pushUrl: 'https://github.com/fork/repo.git',
        },
      ],
      mergeBranchIntoCurrent() {},
      parseCustomRemoteHostingProviders: (value) => value,
      pushBranch() {
        return {
          branchName: 'main',
          upstreamName: 'origin/main',
          didPull: false,
          didPush: false,
          publishedUpstream: false,
        };
      },
      removeRemoteTrackingRef() {},
      resolveCompareBaseBranch: ({ defaultBranchName, currentBranchName, upstreamBranchName, headBranchName, compareBaseStrategy }) => {
        if (compareBaseStrategy === 'currentBranch') {
          return currentBranchName && currentBranchName !== headBranchName ? currentBranchName : defaultBranchName;
        }

        if (compareBaseStrategy === 'upstream') {
          return upstreamBranchName && upstreamBranchName !== headBranchName ? upstreamBranchName : defaultBranchName;
        }

        return defaultBranchName && defaultBranchName !== headBranchName ? defaultBranchName : currentBranchName;
      },
      resolveHostedRepository: (remoteInfo) => ({
        provider: 'github',
        providerLabel: 'GitHub',
        remoteName: remoteInfo.name,
        remoteUrl: remoteInfo.fetchUrl,
        hostRoot: remoteInfo.fetchUrl.replace(/\.git$/u, ''),
        namespace: remoteInfo.name === 'fork' ? 'fork' : 'octo',
        repository: 'repo',
      }),
      resolveRemoteBranchName: (branchName, branchInfo) =>
        branchInfo?.scope === 'remote' ? branchName.split('/').slice(1).join('/') : branchName,
      resolveRemoteNameForBranch: (branchInfo, remoteNames, preferredRemote) => {
        if (branchInfo.scope === 'remote' && branchInfo.remoteName) {
          return branchInfo.remoteName;
        }

        if (branchInfo.upstreamName) {
          return branchInfo.upstreamName.split('/')[0];
        }

        if (preferredRemote && remoteNames.includes(preferredRemote)) {
          return preferredRemote;
        }

        return remoteNames.includes('origin') ? 'origin' : remoteNames[0];
      },
      getUpstreamBranchName: (upstreamName) => upstreamName?.split('/').slice(1).join('/'),
      renameBranch() {},
      syncBranch() {
        return {
          branchName: 'main',
          upstreamName: 'origin/main',
          didPull: false,
          didPush: false,
          publishedUpstream: false,
        };
      },
      ...gitOverrides,
    },
    '../treeProvider': {
      BranchTreeItem: class BranchTreeItem {},
    },
    './shared': {
      NO_CURRENT_BRANCH_MESSAGE: 'No current branch',
      async getGitApi() {
        return undefined;
      },
    },
  });

  branchCommands.registerBranchDomainCommands({ subscriptions: [] }, commandContext.context);
  return { commandContext };
}

test('openBranchOnRemote opens the selected branch page using the tracked remote', async () => {
  const vscodeState = createVscodeState();

  createBranchCommandsModule(vscodeState);

  await vscodeState.registeredCommands['gitBranchesPanel.openBranchOnRemote']({
    nodeType: 'branch',
    branchName: 'feature/demo',
    repoRoot: '/repo',
    branchInfo: {
      name: 'feature/demo',
      isCurrent: false,
      scope: 'local',
      upstreamName: 'origin/feature/demo',
    },
  });

  assert.deepEqual(vscodeState.openedUrls, ['https://github.com/octo/repo/branch/feature/demo']);
  assert.equal(vscodeState.quickPickRequests.length, 0);
});

test('openComparePage resolves the default remote branch base and opens the compare URL', async () => {
  const vscodeState = createVscodeState();

  createBranchCommandsModule(vscodeState, {
    buildCompareWebUrl: (_repository, baseBranchName, branchName) =>
      `https://github.com/octo/repo/compare/${baseBranchName}...${branchName}`,
  });

  await vscodeState.registeredCommands['gitBranchesPanel.openComparePage']({
    nodeType: 'branch',
    branchName: 'feature/demo',
    repoRoot: '/repo',
    branchInfo: {
      name: 'feature/demo',
      isCurrent: false,
      scope: 'local',
      upstreamName: 'origin/feature/demo',
    },
  });

  assert.deepEqual(vscodeState.openedUrls, ['https://github.com/octo/repo/compare/main...feature/demo']);
});

test('createPullRequest can prompt for a preferred remote when the branch has no upstream', async () => {
  const vscodeState = createVscodeState();
  vscodeState.configurationValues['remoteHosting.preferredRemote'] = 'fork';

  createBranchCommandsModule(vscodeState, {
    buildPullRequestWebUrl: (_repository, baseBranchName, branchName) =>
      `https://github.com/fork/repo/pull/new?base=${baseBranchName}&head=${branchName}`,
  });

  await vscodeState.registeredCommands['gitBranchesPanel.createPullRequest']({
    nodeType: 'branch',
    branchName: 'feature/demo',
    repoRoot: '/repo',
    branchInfo: {
      name: 'feature/demo',
      isCurrent: false,
      scope: 'local',
    },
  });

  assert.deepEqual(vscodeState.openedUrls, ['https://github.com/fork/repo/pull/new?base=main&head=feature/demo']);
});

test('copyBranchUrl copies the hosted branch URL to the clipboard and reports success', async () => {
  const vscodeState = createVscodeState();

  createBranchCommandsModule(vscodeState);

  await vscodeState.registeredCommands['gitBranchesPanel.copyBranchUrl']({
    nodeType: 'remoteBranch',
    branchName: 'origin/feature/demo',
    repoRoot: '/repo',
    branchInfo: {
      name: 'origin/feature/demo',
      isCurrent: false,
      scope: 'remote',
      remoteName: 'origin',
    },
  });

  assert.deepEqual(vscodeState.clipboardWrites, ['https://github.com/octo/repo/branch/feature/demo']);
  assert.deepEqual(vscodeState.infoMessages, ["Copied branch URL for 'origin/feature/demo' to the clipboard."]);
});

test('showBranchActions includes remote-host actions and routes the selected command', async () => {
  const vscodeState = createVscodeState();
  vscodeState.quickPickSelector = (items, options) => {
    if (/Choose an action for/u.test(options.placeHolder)) {
      return items.find((item) => item.actionId === 'openComparePage');
    }

    return undefined;
  };

  createBranchCommandsModule(vscodeState);

  const item = {
    nodeType: 'branch',
    branchName: 'feature/demo',
    repoRoot: '/repo',
    branchInfo: {
      name: 'feature/demo',
      isCurrent: false,
      scope: 'local',
      upstreamName: 'origin/feature/demo',
    },
  };

  await vscodeState.registeredCommands['gitBranchesPanel.showBranchActions'](item);

  assert.ok(
    vscodeState.quickPickRequests[0].items.some(
      (quickPickItem) => quickPickItem.label === '$(globe) Open Branch on Remote'
    )
  );
  assert.ok(
    vscodeState.quickPickRequests[0].items.some(
      (quickPickItem) => quickPickItem.label === '$(link-external) Open Compare Page'
    )
  );
  assert.ok(
    vscodeState.quickPickRequests[0].items.some(
      (quickPickItem) => quickPickItem.label === '$(git-pull-request) Create Pull Request'
    )
  );
  assert.ok(
    vscodeState.quickPickRequests[0].items.some(
      (quickPickItem) => quickPickItem.label === '$(copy) Copy Branch URL'
    )
  );
  assert.ok(
    vscodeState.quickPickRequests[0].items.some(
      (quickPickItem) => quickPickItem.label === '$(copy) Copy Compare URL'
    )
  );
  assert.deepEqual(vscodeState.executedCommands, [
    {
      command: 'gitBranchesPanel.openComparePage',
      args: [item],
    },
  ]);
});
