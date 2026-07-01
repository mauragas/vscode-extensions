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
      newBranchPrefixes: ['feature', 'bugfix'],
      normalizeNewBranchNames: true,
    },
    quickPickRequests: [],
    quickPickSelector: undefined,
    inputBoxRequests: [],
    inputBoxResponse: undefined,
    warningMessages: [],
    warningResponses: [],
  };
}

function createVscodeMock(state) {
  return {
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
    window: {
      async showQuickPick(items, options) {
        state.quickPickRequests.push({ items, options });
        return typeof state.quickPickSelector === 'function'
          ? state.quickPickSelector(items, options)
          : undefined;
      },
      async showInputBox(options) {
        state.inputBoxRequests.push(options);
        return state.inputBoxResponse;
      },
      async showWarningMessage(message, options, ...items) {
        state.warningMessages.push({ message, options, items });
        if (state.warningResponses.length > 0) {
          return state.warningResponses.shift();
        }

        return undefined;
      },
    },
  };
}

test('promptForConflictRecoveryAction warns that discard will delete untracked files and directories', async () => {
  const vscodeState = createVscodeState();
  vscodeState.warningResponses.push('Discard all changes and retry');

  const conflictRecovery = loadFresh('../out/commands/conflictRecovery.js', {
    vscode: createVscodeMock(vscodeState),
    '../errorUtils': {
      getErrorMessage(error) {
        return error instanceof Error ? error.message : String(error);
      },
    },
    '../git/shared': {
      async runGit() {
        return { stdout: '', stderr: '' };
      },
    },
  });

  const action = await conflictRecovery.promptForConflictRecoveryAction({
    branchName: 'feature/demo',
    operationDescription: 'Pulling',
    discardActionLabel: 'Discard all changes and retry',
  });

  assert.equal(action, 'discardAndRetry');
  assert.equal(vscodeState.warningMessages.length, 1);
  assert.match(vscodeState.warningMessages[0].message, /permanently discard/i);
  assert.match(vscodeState.warningMessages[0].message, /tracked and untracked changes/i);
});

test('promptForRecoveryBranchName validates and normalizes the entered recovery branch name', async () => {
  const vscodeState = createVscodeState();
  vscodeState.quickPickSelector = (items) => items.find((item) => item.prefix === 'feature');
  vscodeState.inputBoxResponse = ' - Feature / Hello--- World - ';

  const conflictRecovery = loadFresh('../out/commands/conflictRecovery.js', {
    vscode: createVscodeMock(vscodeState),
    '../errorUtils': {
      getErrorMessage(error) {
        return error instanceof Error ? error.message : String(error);
      },
    },
    '../git/shared': {
      async runGit() {
        return { stdout: '', stderr: '' };
      },
    },
  });

  const branchName = await conflictRecovery.promptForRecoveryBranchName({
    prompt: 'Create a branch to preserve current changes',
    normalize: true,
  });

  assert.equal(branchName, 'feature/hello-world');
  assert.equal(vscodeState.quickPickRequests.length, 1);
  assert.equal(vscodeState.inputBoxRequests[0].value, 'feature/');
  assert.deepEqual(vscodeState.inputBoxRequests[0].valueSelection, [8, 8]);
  assert.equal(vscodeState.inputBoxRequests[0].validateInput('anything at all'), undefined);
});
