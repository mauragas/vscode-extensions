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
    configurationValues: {},
    explicitConfigurationKeys: new Set(),
    configurationListeners: [],
    setContextCalls: [],
  };
}

function createVscodeMock(state) {
  return {
    commands: {
      async executeCommand(command, ...args) {
        if (command === 'setContext') {
          state.setContextCalls.push(args);
        }

        return undefined;
      },
    },
    workspace: {
      getConfiguration(section) {
        assert.equal(section, 'gitBranchesPanel');

        return {
          get(key, defaultValue) {
            if (Object.prototype.hasOwnProperty.call(state.configurationValues, key)) {
              return state.configurationValues[key];
            }

            return defaultValue;
          },
          inspect(key) {
            return {
              key,
              defaultValue: undefined,
              globalValue: state.explicitConfigurationKeys.has(key)
                ? state.configurationValues[key]
                : undefined,
              workspaceValue: undefined,
              workspaceFolderValue: undefined,
              globalLanguageValue: undefined,
              workspaceLanguageValue: undefined,
              workspaceFolderLanguageValue: undefined,
            };
          },
        };
      },
      onDidChangeConfiguration(listener) {
        state.configurationListeners.push(listener);
        return { dispose() {} };
      },
    },
  };
}

function loadToolbarQuickActionsModule(state) {
  return loadFresh('../out/toolbarQuickActions.js', {
    vscode: createVscodeMock(state),
  });
}

test('normalizeToolbarQuickActions removes unknown values and duplicates', () => {
  const toolbarQuickActions = loadToolbarQuickActionsModule(createVscodeState());

  assert.deepEqual(
    toolbarQuickActions.normalizeToolbarQuickActions(
      ['findRef', 'bogus', 'findRef', 'settings'],
      toolbarQuickActions.DEFAULT_SINGLE_REPOSITORY_TOOLBAR_QUICK_ACTIONS
    ),
    ['findRef', 'settings']
  );
});

test('normalizeToolbarQuickActions falls back to defaults for invalid non-empty arrays and keeps explicit empty arrays', () => {
  const toolbarQuickActions = loadToolbarQuickActionsModule(createVscodeState());

  assert.deepEqual(
    toolbarQuickActions.normalizeToolbarQuickActions(
      ['bogus'],
      toolbarQuickActions.DEFAULT_MULTI_REPOSITORY_TOOLBAR_QUICK_ACTIONS
    ),
    [...toolbarQuickActions.DEFAULT_MULTI_REPOSITORY_TOOLBAR_QUICK_ACTIONS]
  );
  assert.deepEqual(
    toolbarQuickActions.normalizeToolbarQuickActions(
      [],
      toolbarQuickActions.DEFAULT_SINGLE_REPOSITORY_TOOLBAR_QUICK_ACTIONS
    ),
    []
  );
});

test('getConfiguredToolbarQuickActions keeps honoring legacy toolbar booleans until the new settings are explicitly configured', () => {
  const state = createVscodeState();
  state.configurationValues['toolbar.showNewBranch'] = false;
  state.configurationValues['toolbar.showFetchAllPrune'] = false;
  state.configurationValues['toolbar.showPullAllRepositoriesChanges'] = false;
  const toolbarQuickActions = loadToolbarQuickActionsModule(state);

  assert.deepEqual(toolbarQuickActions.getConfiguredSingleRepositoryToolbarQuickActions(), [
    'findRef',
    'currentBranchAction',
    'fetchAll',
    'refresh',
    'clearFilter',
    'advancedActions',
    'settings',
  ]);
  assert.deepEqual(toolbarQuickActions.getConfiguredMultiRepositoryToolbarQuickActions(), [
    'findRef',
    'currentBranchAction',
    'fetchAll',
    'refresh',
    'selectRepository',
    'clearFilter',
    'advancedActions',
    'settings',
  ]);
});

test('getConfiguredToolbarQuickActions prefers explicit quick-action lists over legacy booleans', () => {
  const state = createVscodeState();
  state.configurationValues['toolbar.showSettings'] = false;
  state.configurationValues['toolbar.singleRepository.quickActions'] = ['settings', 'findRef'];
  state.explicitConfigurationKeys.add('toolbar.singleRepository.quickActions');
  const toolbarQuickActions = loadToolbarQuickActionsModule(state);

  assert.deepEqual(toolbarQuickActions.getConfiguredSingleRepositoryToolbarQuickActions(), [
    'settings',
    'findRef',
  ]);
});

test('updateToolbarQuickActionContextKeys applies the configured order for both repository scopes and clears unused slots', async () => {
  const state = createVscodeState();
  state.configurationValues['toolbar.singleRepository.quickActions'] = ['settings', 'findRef'];
  state.configurationValues['toolbar.multiRepository.quickActions'] = ['selectRepository'];
  state.explicitConfigurationKeys.add('toolbar.singleRepository.quickActions');
  state.explicitConfigurationKeys.add('toolbar.multiRepository.quickActions');
  const toolbarQuickActions = loadToolbarQuickActionsModule(state);

  await toolbarQuickActions.updateToolbarQuickActionContextKeys();

  const expectedCalls = [
    ...Array.from({ length: toolbarQuickActions.TOOLBAR_QUICK_ACTION_IDS.length }, (_, index) => [
      toolbarQuickActions.buildToolbarQuickActionSlotContextKey('singleRepository', index + 1),
      ['settings', 'findRef'][index] ?? '',
    ]),
    ...Array.from({ length: toolbarQuickActions.TOOLBAR_QUICK_ACTION_IDS.length }, (_, index) => [
      toolbarQuickActions.buildToolbarQuickActionSlotContextKey('multiRepository', index + 1),
      ['selectRepository'][index] ?? '',
    ]),
  ];

  assert.deepEqual(state.setContextCalls, expectedCalls);
});

test('registerToolbarQuickActionContextKeys refreshes slot context keys when toolbar settings change', async () => {
  const state = createVscodeState();
  const toolbarQuickActions = loadToolbarQuickActionsModule(state);
  const context = { subscriptions: [] };

  toolbarQuickActions.registerToolbarQuickActionContextKeys(context);
  await Promise.resolve();

  assert.equal(state.configurationListeners.length, 1);
  state.setContextCalls.length = 0;
  state.configurationValues['toolbar.multiRepository.quickActions'] = ['advancedActions'];
  state.explicitConfigurationKeys.add('toolbar.multiRepository.quickActions');

  state.configurationListeners[0]({
    affectsConfiguration(section) {
      return section === 'gitBranchesPanel.toolbar';
    },
  });
  await Promise.resolve();

  assert.deepEqual(state.setContextCalls.at(-toolbarQuickActions.TOOLBAR_QUICK_ACTION_IDS.length), [
    toolbarQuickActions.buildToolbarQuickActionSlotContextKey('multiRepository', 1),
    'advancedActions',
  ]);
});
