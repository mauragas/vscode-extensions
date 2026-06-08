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
        };
      },
      onDidChangeConfiguration(listener) {
        state.configurationListeners.push(listener);
        return { dispose() {} };
      },
    },
  };
}

function loadBranchContextMenuModule(state) {
  return loadFresh('../out/branchContextMenu.js', {
    vscode: createVscodeMock(state),
  });
}

test('normalizeBranchContextMenuPrimaryActions removes unknown values and duplicates', () => {
  const branchContextMenu = loadBranchContextMenuModule(createVscodeState());

  assert.deepEqual(
    branchContextMenu.normalizeBranchContextMenuPrimaryActions([
      'copyBranchName',
      'bogus',
      'copyBranchName',
      'mergeIntoCurrent',
    ]),
    ['copyBranchName', 'mergeIntoCurrent']
  );
});

test('normalizeBranchContextMenuPrimaryActions falls back to defaults for invalid non-empty arrays and keeps explicit empty arrays', () => {
  const branchContextMenu = loadBranchContextMenuModule(createVscodeState());

  assert.deepEqual(
    branchContextMenu.normalizeBranchContextMenuPrimaryActions(['bogus']),
    [...branchContextMenu.DEFAULT_BRANCH_CONTEXT_MENU_PRIMARY_ACTIONS]
  );
  assert.deepEqual(branchContextMenu.normalizeBranchContextMenuPrimaryActions([]), []);
});

test('updateBranchContextMenuContextKeys applies the configured order and clears unused slots', async () => {
  const state = createVscodeState();
  state.configurationValues['branchContextMenu.primaryActions'] = ['copyBranchName', 'checkout'];
  const branchContextMenu = loadBranchContextMenuModule(state);

  await branchContextMenu.updateBranchContextMenuContextKeys();

  assert.deepEqual(
    state.setContextCalls,
    branchContextMenu.DEFAULT_BRANCH_CONTEXT_MENU_PRIMARY_ACTIONS.map((_, index) => [
      branchContextMenu.buildBranchContextMenuSlotContextKey(index + 1),
      ['copyBranchName', 'checkout'][index] ?? '',
    ])
  );
});

test('registerBranchContextMenuContextKeys refreshes slot context keys when the setting changes', async () => {
  const state = createVscodeState();
  const branchContextMenu = loadBranchContextMenuModule(state);
  const context = { subscriptions: [] };

  branchContextMenu.registerBranchContextMenuContextKeys(context);
  await Promise.resolve();

  assert.equal(state.configurationListeners.length, 1);
  state.setContextCalls.length = 0;
  state.configurationValues['branchContextMenu.primaryActions'] = ['mergeIntoCurrent'];

  state.configurationListeners[0]({
    affectsConfiguration(section) {
      return section === 'gitBranchesPanel.branchContextMenu.primaryActions';
    },
  });
  await Promise.resolve();

  assert.deepEqual(state.setContextCalls[0], [
    branchContextMenu.buildBranchContextMenuSlotContextKey(1),
    'mergeIntoCurrent',
  ]);
});
