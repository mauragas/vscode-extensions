const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createGitCommandError,
  fetchWithBuiltInGit,
  listRemoteRefsWithBuiltInGit,
  pushTagsWithBuiltInGit,
  pushWithBuiltInGit,
  runGitWithBuiltInAuth,
} = require('../out/git/authAwareGit.js');

test('fetchWithBuiltInGit prefers the built-in repository fetch API when available', async () => {
  const fallbackCalls = [];
  const fetchCalls = [];

  await fetchWithBuiltInGit(
    '/repo',
    { all: true, prune: true },
    async () => {
      fallbackCalls.push('fallback');
    },
    {
      loadBuiltInRepository: async () => ({
        async fetch(options) {
          fetchCalls.push(options);
        },
      }),
      loadBuiltInExecutor: async () => undefined,
    }
  );

  assert.deepEqual(fetchCalls, [{ all: true, prune: true }]);
  assert.deepEqual(fallbackCalls, []);
});

test('pushWithBuiltInGit prefers the built-in repository push API when available', async () => {
  const fallbackCalls = [];
  const pushCalls = [];

  await pushWithBuiltInGit(
    '/repo',
    {
      remoteName: 'origin',
      refspec: 'feature/demo:refs/heads/feature/demo',
      setUpstream: true,
      forcePushMode: 1,
    },
    async () => {
      fallbackCalls.push('fallback');
    },
    {
      loadBuiltInRepository: async () => ({
        async push(remoteName, refspec, setUpstream, forcePushMode) {
          pushCalls.push({ remoteName, refspec, setUpstream, forcePushMode });
        },
      }),
      loadBuiltInExecutor: async () => undefined,
    }
  );

  assert.deepEqual(pushCalls, [
    {
      remoteName: 'origin',
      refspec: 'feature/demo:refs/heads/feature/demo',
      setUpstream: true,
      forcePushMode: 1,
    },
  ]);
  assert.deepEqual(fallbackCalls, []);
});

test('pushTagsWithBuiltInGit prefers the built-in repository pushTags API when available', async () => {
  const fallbackCalls = [];
  const pushTagCalls = [];

  await pushTagsWithBuiltInGit(
    '/repo',
    'origin',
    async () => {
      fallbackCalls.push('fallback');
    },
    {
      loadBuiltInRepository: async () => ({
        repository: {
          async pushTags(remoteName) {
            pushTagCalls.push(remoteName);
          },
        },
      }),
      loadBuiltInExecutor: async () => undefined,
    }
  );

  assert.deepEqual(pushTagCalls, ['origin']);
  assert.deepEqual(fallbackCalls, []);
});

test('listRemoteRefsWithBuiltInGit prefers the built-in repository remote-ref API when available', async () => {
  const fallbackCalls = [];

  const refNames = await listRemoteRefsWithBuiltInGit(
    '/repo',
    'origin',
    { tags: true },
    async () => {
      fallbackCalls.push('fallback');
      return [];
    },
    {
      loadBuiltInRepository: async () => ({
        repository: {
          async getRemoteRefs() {
            return [
              { name: 'v1.0.0' },
              { name: ' release/v1.1.0 ' },
              { name: undefined },
            ];
          },
        },
      }),
      loadBuiltInExecutor: async () => undefined,
    }
  );

  assert.deepEqual(refNames, ['v1.0.0', 'release/v1.1.0']);
  assert.deepEqual(fallbackCalls, []);
});

test('runGitWithBuiltInAuth prefers the built-in Git executor when available', async () => {
  const rawRunnerCalls = [];
  const builtInCalls = [];

  const result = await runGitWithBuiltInAuth(
    '/repo',
    '/repo',
    ['fetch', '--all', '--prune'],
    async (workingDirectory, args) => {
      rawRunnerCalls.push({ workingDirectory, args });
      return { stdout: 'raw', stderr: '' };
    },
    {
      loadBuiltInExecutor: async (repoRoot) => ({
        async exec(workingDirectory, args) {
          builtInCalls.push({ repoRoot, workingDirectory, args });
          return { stdout: 'built-in', stderr: '' };
        },
      }),
    }
  );

  assert.deepEqual(rawRunnerCalls, []);
  assert.deepEqual(builtInCalls, [
    {
      repoRoot: '/repo',
      workingDirectory: '/repo',
      args: ['fetch', '--all', '--prune'],
    },
  ]);
  assert.deepEqual(result, { stdout: 'built-in', stderr: '' });
});

test('runGitWithBuiltInAuth falls back to the raw runner when the built-in Git executor is unavailable', async () => {
  const rawRunnerCalls = [];

  const result = await runGitWithBuiltInAuth(
    '/repo',
    '/tmp/git-branches-panel-worktree-123',
    ['push', 'origin', 'feature/demo:refs/heads/feature/demo'],
    async (workingDirectory, args) => {
      rawRunnerCalls.push({ workingDirectory, args });
      return { stdout: 'raw', stderr: '' };
    },
    {
      loadBuiltInExecutor: async () => undefined,
    }
  );

  assert.deepEqual(rawRunnerCalls, [
    {
      workingDirectory: '/tmp/git-branches-panel-worktree-123',
      args: ['push', 'origin', 'feature/demo:refs/heads/feature/demo'],
    },
  ]);
  assert.deepEqual(result, { stdout: 'raw', stderr: '' });
});

test('createGitCommandError classifies credential-prompt fetch failures with an actionable summary', () => {
  const error = createGitCommandError(
    {
      stderr: "fatal: could not read Username for 'https://github.com': No such device or address",
      gitCommand: 'fetch',
      gitArgs: ['fetch', '--all'],
    },
    ['fetch', '--all'],
    { classifyNetworkFailures: true }
  );

  assert.match(
    error.message,
    /Git could not prompt for credentials while fetching from the remote\./i
  );
  assert.match(error.message, /could not read Username/i);
  assert.equal(
    error.stderr,
    "fatal: could not read Username for 'https://github.com': No such device or address"
  );
  assert.deepEqual(error.gitArgs, ['fetch', '--all']);
});

test('createGitCommandError classifies pull connectivity failures with an actionable summary', () => {
  const error = createGitCommandError(
    {
      stderr: 'fatal: Could not resolve host: github.com',
      gitErrorCode: 'RemoteConnectionError',
      gitCommand: 'pull',
      gitArgs: ['pull', 'origin', 'main'],
    },
    ['pull', 'origin', 'main'],
    { classifyNetworkFailures: true }
  );

  assert.match(error.message, /Network error while pulling from the remote\./i);
  assert.match(error.message, /Could not resolve host/i);
  assert.equal(error.gitErrorCode, 'RemoteConnectionError');
});
