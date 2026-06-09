const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { dirname, join } = require('node:path');
const test = require('node:test');

const {
  applyStash,
  addRemote,
  cleanRepository,
  cherryPickRef,
  checkoutRemoteBranch,
  checkoutTag,
  createBranchFromRef,
  createWorktree,
  createTag,
  deleteRemoteBranch,
  deleteTag,
  dropAllStashes,
  dropStash,
  fetchAllRemotes,
  fetchRemoteState,
  getChangedFilesForCommit,
  getCommitDetails,
  getDiffFilesBetweenRefs,
  getBranches,
  getHooks,
  getRemoteDefaultBranch,
  getRemoteDetails,
  getRemoteBranchTrackingState,
  getRefHistory,
  getRemotes,
  getRemoteBranches,
  getStashes,
  getTags,
  getWorktrees,
  lockWorktree,
  parseRemoteBranchReference,
  popStash,
  pruneWorktrees,
  pushBranch,
  pushAllTags,
  fetchRemote,
  removeRemote,
  renameRemote,
  renameStash,
  setHookEnabled,
  setRemoteFetchUrl,
  setRemotePushUrl,
  unlockWorktree,
  removeWorktree,
  renameWorktree,
  stashAllChanges,
  stashStagedChanges,
  stashSilently,
  syncBranch,
} = require('../out/git.js');

function runGit(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
  }).trim();
}

function hasRef(cwd, refName) {
  try {
    runGit(cwd, ['show-ref', '--verify', '--quiet', refName]);
    return true;
  } catch {
    return false;
  }
}

function configureRepository(repoRoot) {
  runGit(repoRoot, ['config', 'user.name', 'Test User']);
  runGit(repoRoot, ['config', 'user.email', 'test@example.com']);
}

function commitFile(repoRoot, fileName, contents, message) {
  writeFileSync(join(repoRoot, fileName), contents);
  runGit(repoRoot, ['add', fileName]);
  runGit(repoRoot, ['commit', '-m', message]);
}

function createRemoteBackedRepository(t) {
  const remoteRoot = mkdtempSync(join(tmpdir(), 'git-branches-panel-remote-'));
  const repoRoot = mkdtempSync(join(tmpdir(), 'git-branches-panel-local-'));

  t.after(() => {
    rmSync(remoteRoot, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
  });

  runGit(remoteRoot, ['init', '--bare']);
  runGit(remoteRoot, ['symbolic-ref', 'HEAD', 'refs/heads/main']);

  runGit(repoRoot, ['init', '-b', 'main']);
  configureRepository(repoRoot);
  commitFile(repoRoot, 'README.md', '# Test repo\n', 'Initial commit');
  runGit(repoRoot, ['remote', 'add', 'origin', remoteRoot]);
  runGit(repoRoot, ['push', '-u', 'origin', 'main']);

  return { repoRoot, remoteRoot };
}

function cloneRepository(t, remoteRoot) {
  const cloneParent = mkdtempSync(join(tmpdir(), 'git-branches-panel-clone-'));
  const cloneRoot = join(cloneParent, 'repo');

  t.after(() => {
    rmSync(cloneParent, { recursive: true, force: true });
  });

  runGit(cloneParent, ['clone', remoteRoot, 'repo']);
  configureRepository(cloneRoot);

  return cloneRoot;
}

function createTempRepository(t) {
  const repoRoot = mkdtempSync(join(tmpdir(), 'git-branches-panel-test-'));
  t.after(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  runGit(repoRoot, ['init', '-b', 'main']);
  configureRepository(repoRoot);

  writeFileSync(join(repoRoot, 'README.md'), '# Test repo\n');
  runGit(repoRoot, ['add', 'README.md']);
  runGit(repoRoot, ['commit', '-m', 'Initial commit']);
  runGit(repoRoot, ['tag', 'v1.0.0']);

  writeFileSync(join(repoRoot, 'README.md'), '# Test repo\nsecond\n');
  runGit(repoRoot, ['commit', '-am', 'Second commit']);
  runGit(repoRoot, ['tag', 'release/v1.1.0']);

  return repoRoot;
}

function createRepositoryWithLinkedWorktree(t) {
  const repoRoot = createTempRepository(t);
  const worktreeParent = mkdtempSync(join(tmpdir(), 'git-branches-panel-worktree-'));
  const worktreeRoot = join(worktreeParent, 'feature-worktree');

  t.after(() => {
    rmSync(worktreeParent, { recursive: true, force: true });
  });

  runGit(repoRoot, ['branch', 'feature/worktree']);
  runGit(repoRoot, ['worktree', 'add', worktreeRoot, 'feature/worktree']);

  return { repoRoot, worktreeRoot };
}

test('parseRemoteBranchReference parses nested remote branches', () => {
  assert.deepEqual(parseRemoteBranchReference('origin/feature/payments/stripe'), {
    remoteName: 'origin',
    branchName: 'feature/payments/stripe',
    fullName: 'origin/feature/payments/stripe',
  });
});

test('parseRemoteBranchReference rejects invalid remote refs', () => {
  assert.equal(parseRemoteBranchReference('origin'), null);
  assert.equal(parseRemoteBranchReference('/feature/payments'), null);
  assert.equal(parseRemoteBranchReference(''), null);
});

test('getTags lists local git tags with tag scope', async (t) => {
  const repoRoot = createTempRepository(t);

  const tags = await getTags(repoRoot);

  assert.deepEqual(
    tags.map((tag) => tag.name),
    ['release/v1.1.0', 'v1.0.0']
  );
  assert.ok(tags.every((tag) => tag.scope === 'tag'));
});

test('checkoutTag switches to a detached HEAD at the selected tag', async (t) => {
  const repoRoot = createTempRepository(t);

  await checkoutTag(repoRoot, 'v1.0.0');

  assert.equal(runGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']), 'HEAD');
  assert.equal(runGit(repoRoot, ['describe', '--tags', '--exact-match']), 'v1.0.0');
});

test('deleteTag removes the selected local tag', async (t) => {
  const repoRoot = createTempRepository(t);

  await deleteTag(repoRoot, 'v1.0.0');

  const tags = await getTags(repoRoot);
  assert.deepEqual(tags.map((tag) => tag.name), ['release/v1.1.0']);
});

test('createTag creates a tag for the selected branch ref without changing checkout', async (t) => {
  const repoRoot = createTempRepository(t);

  runGit(repoRoot, ['branch', 'feature/release-candidate', 'v1.0.0']);

  await createTag(repoRoot, 'release-candidate', 'feature/release-candidate');

  const tags = await getTags(repoRoot);
  assert.ok(tags.some((tag) => tag.name === 'release-candidate'));
  assert.equal(runGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']), 'main');
  assert.equal(
    runGit(repoRoot, ['rev-parse', 'release-candidate']),
    runGit(repoRoot, ['rev-parse', 'feature/release-candidate'])
  );
});

test('createBranchFromRef creates a branch from a local ref without changing checkout', async (t) => {
  const repoRoot = createTempRepository(t);

  runGit(repoRoot, ['checkout', '-b', 'feature/source']);
  commitFile(repoRoot, 'source.txt', 'source\n', 'Add source branch');
  runGit(repoRoot, ['checkout', 'main']);

  await createBranchFromRef(repoRoot, 'feature/child', 'feature/source');

  assert.equal(runGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']), 'main');
  assert.equal(
    runGit(repoRoot, ['rev-parse', 'feature/child']),
    runGit(repoRoot, ['rev-parse', 'feature/source'])
  );
});

test('createBranchFromRef can create and checkout a local branch from a remote ref with tracking', async (t) => {
  const { repoRoot } = createRemoteBackedRepository(t);

  runGit(repoRoot, ['checkout', '-b', 'feature/source']);
  commitFile(repoRoot, 'source.txt', 'source\n', 'Add remote source branch');
  runGit(repoRoot, ['push', '-u', 'origin', 'feature/source']);
  runGit(repoRoot, ['checkout', 'main']);
  runGit(repoRoot, ['branch', '-D', 'feature/source']);
  runGit(repoRoot, ['fetch', 'origin']);

  await createBranchFromRef(repoRoot, 'feature/from-remote', 'origin/feature/source', {
    checkout: true,
  });

  assert.equal(runGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']), 'feature/from-remote');
  assert.equal(
    runGit(repoRoot, ['config', '--get', 'branch.feature/from-remote.remote']),
    'origin'
  );
  assert.equal(
    runGit(repoRoot, ['config', '--get', 'branch.feature/from-remote.merge']),
    'refs/heads/feature/source'
  );
});

test('createWorktree creates a linked worktree from a local branch without changing the current checkout', async (t) => {
  const repoRoot = createTempRepository(t);
  const worktreeParent = mkdtempSync(join(tmpdir(), 'git-branches-panel-create-worktree-'));
  const worktreeRoot = join(worktreeParent, 'feature-demo');

  t.after(() => {
    rmSync(worktreeParent, { recursive: true, force: true });
  });

  runGit(repoRoot, ['branch', 'feature/demo']);

  await createWorktree(repoRoot, worktreeRoot, 'feature/demo');

  assert.equal(runGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']), 'main');
  assert.equal(runGit(worktreeRoot, ['rev-parse', '--abbrev-ref', 'HEAD']), 'feature/demo');
});

test('createWorktree creates a detached worktree from a tag', async (t) => {
  const repoRoot = createTempRepository(t);
  const worktreeParent = mkdtempSync(join(tmpdir(), 'git-branches-panel-tag-worktree-'));
  const worktreeRoot = join(worktreeParent, 'release-tag');

  t.after(() => {
    rmSync(worktreeParent, { recursive: true, force: true });
  });

  await createWorktree(repoRoot, worktreeRoot, 'refs/tags/v1.0.0', { detach: true });

  assert.equal(runGit(worktreeRoot, ['rev-parse', '--abbrev-ref', 'HEAD']), 'HEAD');
  assert.equal(runGit(worktreeRoot, ['describe', '--tags', '--exact-match']), 'v1.0.0');
});

test('getRemotes lists configured git remotes', async (t) => {
  const { repoRoot } = createRemoteBackedRepository(t);

  const remotes = await getRemotes(repoRoot);

  assert.deepEqual(remotes, ['origin']);
});

test('getRemoteDetails returns fetch and push URLs per remote', async (t) => {
  const { repoRoot, remoteRoot } = createRemoteBackedRepository(t);

  const remoteDetails = await getRemoteDetails(repoRoot);

  assert.deepEqual(remoteDetails, [
    {
      name: 'origin',
      fetchUrl: remoteRoot,
      pushUrl: remoteRoot,
      isDefault: true,
      hostProvider: undefined,
    },
  ]);
});

test('getRemoteDefaultBranch resolves the remote HEAD symbolic ref', async (t) => {
  const { repoRoot } = createRemoteBackedRepository(t);

  runGit(repoRoot, ['remote', 'set-head', 'origin', '-a']);

  assert.equal(await getRemoteDefaultBranch(repoRoot, 'origin'), 'main');
});

test('addRemote, renameRemote, setRemoteFetchUrl, setRemotePushUrl, and removeRemote update git remotes', async (t) => {
  const repoRoot = createTempRepository(t);
  const remoteA = mkdtempSync(join(tmpdir(), 'git-branches-panel-extra-remote-a-'));
  const remoteB = mkdtempSync(join(tmpdir(), 'git-branches-panel-extra-remote-b-'));

  t.after(() => {
    rmSync(remoteA, { recursive: true, force: true });
    rmSync(remoteB, { recursive: true, force: true });
  });

  runGit(remoteA, ['init', '--bare']);
  runGit(remoteB, ['init', '--bare']);

  await addRemote(repoRoot, 'origin', remoteA);
  assert.deepEqual(await getRemotes(repoRoot), ['origin']);

  await renameRemote(repoRoot, 'origin', 'upstream');
  assert.deepEqual(await getRemotes(repoRoot), ['upstream']);

  await setRemoteFetchUrl(repoRoot, 'upstream', remoteB);
  await setRemotePushUrl(repoRoot, 'upstream', remoteA);

  const remoteDetails = await getRemoteDetails(repoRoot);
  assert.deepEqual(remoteDetails, [
    {
      name: 'upstream',
      fetchUrl: remoteB,
      pushUrl: remoteA,
      isDefault: false,
      hostProvider: undefined,
    },
  ]);

  await removeRemote(repoRoot, 'upstream');
  assert.deepEqual(await getRemotes(repoRoot), []);
});

test('fetchRemote fetches a specific remote and can prune deleted refs', async (t) => {
  const { repoRoot, remoteRoot } = createRemoteBackedRepository(t);
  const collaboratorRoot = cloneRepository(t, remoteRoot);

  runGit(repoRoot, ['checkout', '-b', 'feature/stale']);
  commitFile(repoRoot, 'stale.txt', 'stale\n', 'Add stale branch');
  runGit(repoRoot, ['push', '-u', 'origin', 'feature/stale']);
  runGit(repoRoot, ['checkout', 'main']);

  runGit(collaboratorRoot, ['fetch', 'origin']);
  runGit(collaboratorRoot, ['push', 'origin', '--delete', 'feature/stale']);

  await fetchRemote(repoRoot, 'origin');
  assert.equal(hasRef(repoRoot, 'refs/remotes/origin/feature/stale'), true);

  await fetchRemote(repoRoot, 'origin', { prune: true });
  assert.equal(hasRef(repoRoot, 'refs/remotes/origin/feature/stale'), false);
});

test('pushAllTags pushes local tags to the selected remote', async (t) => {
  const { repoRoot, remoteRoot } = createRemoteBackedRepository(t);

  runGit(repoRoot, ['tag', 'v2.0.0']);
  runGit(repoRoot, ['tag', 'release/2026-06-05']);

  await pushAllTags(repoRoot, 'origin');

  assert.match(runGit(remoteRoot, ['show-ref', '--tags', 'v2.0.0']), /refs\/tags\/v2\.0\.0$/m);
  assert.match(
    runGit(remoteRoot, ['show-ref', '--tags', 'release/2026-06-05']),
    /refs\/tags\/release\/2026-06-05$/m
  );
});

test('stashSilently saves tracked and untracked changes and getStashes lists them', async (t) => {
  const repoRoot = createTempRepository(t);

  writeFileSync(join(repoRoot, 'README.md'), '# Test repo\nthird\n');
  writeFileSync(join(repoRoot, 'scratch.txt'), 'untracked\n');

  const didStash = await stashSilently(repoRoot);
  const stashes = await getStashes(repoRoot);

  assert.equal(didStash, true);
  assert.equal(stashes.length, 1);
  assert.equal(stashes[0].scope, 'stash');
  assert.equal(stashes[0].name, 'stash@{0}');
  assert.match(stashes[0].lastCommit, /(WIP on|On) main/);
  assert.equal(readFileSync(join(repoRoot, 'README.md'), 'utf8'), '# Test repo\nsecond\n');
  assert.equal(hasRef(repoRoot, 'refs/stash'), true);
});

test('stashAllChanges stores an optional stash message with tracked and untracked changes', async (t) => {
  const repoRoot = createTempRepository(t);

  writeFileSync(join(repoRoot, 'README.md'), '# Test repo\nthird\n');
  writeFileSync(join(repoRoot, 'scratch.txt'), 'untracked\n');

  const didStash = await stashAllChanges(repoRoot, 'Release prep');
  const stashes = await getStashes(repoRoot);

  assert.equal(didStash, true);
  assert.equal(stashes.length, 1);
  assert.match(stashes[0].lastCommit, /Release prep/);
  assert.equal(readFileSync(join(repoRoot, 'README.md'), 'utf8'), '# Test repo\nsecond\n');
  assert.equal(hasRef(repoRoot, 'refs/stash'), true);
});

test('stashStagedChanges stashes only staged changes and preserves unstaged and untracked work', async (t) => {
  const repoRoot = createTempRepository(t);

  commitFile(repoRoot, 'notes.txt', 'base\n', 'Add notes file');
  writeFileSync(join(repoRoot, 'README.md'), '# Test repo\nstaged change\n');
  runGit(repoRoot, ['add', 'README.md']);
  writeFileSync(join(repoRoot, 'notes.txt'), 'unstaged change\n');
  writeFileSync(join(repoRoot, 'scratch.txt'), 'untracked\n');

  const didStash = await stashStagedChanges(repoRoot, 'Staged only');
  const stashes = await getStashes(repoRoot);

  assert.equal(didStash, true);
  assert.equal(stashes.length, 1);
  assert.match(stashes[0].lastCommit, /Staged only/);
  assert.equal(readFileSync(join(repoRoot, 'README.md'), 'utf8'), '# Test repo\nsecond\n');
  assert.equal(readFileSync(join(repoRoot, 'notes.txt'), 'utf8'), 'unstaged change\n');
  assert.equal(readFileSync(join(repoRoot, 'scratch.txt'), 'utf8'), 'untracked\n');
  assert.equal(hasRef(repoRoot, 'refs/stash'), true);
});

test('stashStagedChanges returns false when only unstaged changes remain', async (t) => {
  const repoRoot = createTempRepository(t);

  writeFileSync(join(repoRoot, 'README.md'), '# Test repo\nthird\n');

  const didStash = await stashStagedChanges(repoRoot);

  assert.equal(didStash, false);
  assert.equal(readFileSync(join(repoRoot, 'README.md'), 'utf8'), '# Test repo\nthird\n');
  assert.equal(hasRef(repoRoot, 'refs/stash'), false);
});

test('stashSilently returns false when there is nothing to stash', async (t) => {
  const repoRoot = createTempRepository(t);

  const didStash = await stashSilently(repoRoot);

  assert.equal(didStash, false);
  assert.equal(hasRef(repoRoot, 'refs/stash'), false);
});

test('applyStash restores changes without removing the stash entry', async (t) => {
  const repoRoot = createTempRepository(t);

  writeFileSync(join(repoRoot, 'README.md'), '# Test repo\nthird\n');
  await stashSilently(repoRoot);

  await applyStash(repoRoot, 'stash@{0}');

  assert.equal(readFileSync(join(repoRoot, 'README.md'), 'utf8'), '# Test repo\nthird\n');
  assert.equal(hasRef(repoRoot, 'refs/stash'), true);
  assert.equal((await getStashes(repoRoot)).length, 1);
});

test('popStash restores changes and removes the stash entry', async (t) => {
  const repoRoot = createTempRepository(t);

  writeFileSync(join(repoRoot, 'README.md'), '# Test repo\nthird\n');
  await stashSilently(repoRoot);

  await popStash(repoRoot, 'stash@{0}');

  assert.equal(readFileSync(join(repoRoot, 'README.md'), 'utf8'), '# Test repo\nthird\n');
  assert.equal(hasRef(repoRoot, 'refs/stash'), false);
  assert.equal((await getStashes(repoRoot)).length, 0);
});

test('dropStash removes the selected stash entry', async (t) => {
  const repoRoot = createTempRepository(t);

  writeFileSync(join(repoRoot, 'README.md'), '# Test repo\nthird\n');
  await stashSilently(repoRoot);

  await dropStash(repoRoot, 'stash@{0}');

  assert.equal(hasRef(repoRoot, 'refs/stash'), false);
  assert.equal((await getStashes(repoRoot)).length, 0);
});

test('dropAllStashes clears every stash entry', async (t) => {
  const repoRoot = createTempRepository(t);

  writeFileSync(join(repoRoot, 'README.md'), '# Test repo\nthird\n');
  await stashSilently(repoRoot);
  writeFileSync(join(repoRoot, 'README.md'), '# Test repo\nfourth\n');
  await stashSilently(repoRoot);

  await dropAllStashes(repoRoot);

  assert.equal(hasRef(repoRoot, 'refs/stash'), false);
  assert.equal((await getStashes(repoRoot)).length, 0);
});

test('renameStash updates the selected stash message while preserving stack order', async (t) => {
  const repoRoot = createTempRepository(t);

  writeFileSync(join(repoRoot, 'README.md'), '# Test repo\nthird\n');
  await stashAllChanges(repoRoot, 'First stash');
  writeFileSync(join(repoRoot, 'README.md'), '# Test repo\nfourth\n');
  await stashAllChanges(repoRoot, 'Second stash');

  const stashesBeforeRename = await getStashes(repoRoot);
  assert.equal(stashesBeforeRename.length, 2);
  assert.ok(stashesBeforeRename[1].stashRevision);

  await renameStash(repoRoot, stashesBeforeRename[1].stashRevision, 'Renamed first stash');

  const stashesAfterRename = await getStashes(repoRoot);

  assert.equal(stashesAfterRename.length, 2);
  assert.equal(stashesAfterRename[0].stashRevision, stashesBeforeRename[0].stashRevision);
  assert.equal(stashesAfterRename[1].stashRevision, stashesBeforeRename[1].stashRevision);
  assert.match(stashesAfterRename[0].lastCommit, /Second stash/);
  assert.match(stashesAfterRename[1].lastCommit, /Renamed first stash/);
});

test('getHooks lists local and shared hooks while distinguishing active state', async (t) => {
  const repoRoot = createTempRepository(t);
  const localHookPath = join(repoRoot, '.git', 'hooks', 'post-commit');
  const sharedHooksRoot = join(repoRoot, '.githooks');
  const sharedHookPath = join(sharedHooksRoot, 'pre-commit');
  const disabledSharedHookPath = join(sharedHooksRoot, 'commit-msg.disabled');

  mkdirSync(sharedHooksRoot, { recursive: true });
  writeFileSync(localHookPath, '#!/bin/sh\nexit 0\n');
  chmodSync(localHookPath, 0o755);
  writeFileSync(sharedHookPath, '#!/bin/sh\necho shared\n');
  chmodSync(sharedHookPath, 0o755);
  writeFileSync(disabledSharedHookPath, '#!/bin/sh\nexit 0\n');
  runGit(repoRoot, ['config', 'core.hooksPath', '.githooks']);

  const hooks = await getHooks(repoRoot);
  const localHook = hooks.find(
    (hook) => hook.hookName === 'post-commit' && hook.hookSource === 'local'
  );
  const sharedHook = hooks.find(
    (hook) => hook.hookName === 'pre-commit' && hook.hookSource === 'shared'
  );
  const disabledSharedHook = hooks.find(
    (hook) => hook.hookName === 'commit-msg' && hook.hookSource === 'shared'
  );

  assert.ok(localHook);
  assert.equal(localHook.hookEnabled, true);
  assert.equal(localHook.hookActive, false);
  assert.equal(localHook.hookOverridden, true);
  assert.equal(localHook.hookRelativePath, '.git/hooks/post-commit');

  assert.ok(sharedHook);
  assert.equal(sharedHook.hookEnabled, true);
  assert.equal(sharedHook.hookActive, true);
  assert.equal(sharedHook.hookRelativePath, '.githooks/pre-commit');

  assert.ok(disabledSharedHook);
  assert.equal(disabledSharedHook.hookEnabled, false);
  assert.equal(disabledSharedHook.hookActive, false);
  assert.equal(disabledSharedHook.hookPath, disabledSharedHookPath);
});

test('getHooks finds local hooks from a linked worktree workspace', async (t) => {
  const { repoRoot, worktreeRoot } = createRepositoryWithLinkedWorktree(t);
  const localHookPath = join(repoRoot, '.git', 'hooks', 'post-checkout');

  writeFileSync(localHookPath, '#!/bin/sh\nexit 0\n');
  chmodSync(localHookPath, 0o755);

  const hooks = await getHooks(worktreeRoot);
  const localHook = hooks.find(
    (hook) => hook.hookName === 'post-checkout' && hook.hookSource === 'local'
  );

  assert.ok(localHook);
  assert.equal(localHook.hookEnabled, true);
  assert.equal(localHook.hookActive, true);
  assert.equal(localHook.hookPath, localHookPath);
});

test('setHookEnabled toggles executable bits for standard git hooks', async (t) => {
  const repoRoot = createTempRepository(t);
  const hookPath = join(repoRoot, '.git', 'hooks', 'pre-commit');

  writeFileSync(hookPath, '#!/bin/sh\nexit 0\n');
  chmodSync(hookPath, 0o755);

  await setHookEnabled(
    {
      hookEnabled: true,
      hookPath,
    },
    false
  );

  assert.equal(statSync(hookPath).mode & 0o111, 0);

  await setHookEnabled(
    {
      hookEnabled: false,
      hookPath,
    },
    true
  );

  assert.notEqual(statSync(hookPath).mode & 0o111, 0);
});

test('setHookEnabled restores .disabled hook files back into place', async (t) => {
  const repoRoot = createTempRepository(t);
  const sharedHooksRoot = join(repoRoot, '.githooks');
  const hookPath = join(sharedHooksRoot, 'pre-push');
  const disabledHookPath = `${hookPath}.disabled`;

  mkdirSync(sharedHooksRoot, { recursive: true });
  writeFileSync(disabledHookPath, '#!/bin/sh\nexit 0\n');

  await setHookEnabled(
    {
      hookEnabled: false,
      hookPath: disabledHookPath,
    },
    true
  );

  assert.equal(existsSync(hookPath), true);
  assert.equal(existsSync(disabledHookPath), false);

  if (process.platform !== 'win32') {
    assert.notEqual(statSync(hookPath).mode & 0o111, 0);
  }
});

test('getWorktrees lists the current and linked worktrees', async (t) => {
  const { repoRoot, worktreeRoot } = createRepositoryWithLinkedWorktree(t);

  const worktrees = await getWorktrees(repoRoot);

  assert.equal(worktrees.length, 2);
  assert.equal(worktrees[0].scope, 'worktree');
  assert.equal(worktrees[0].isCurrent, true);
  assert.equal(worktrees[0].worktreePath, repoRoot);
  assert.equal(worktrees[0].worktreeRef, 'main');

  const linkedWorktree = worktrees.find((worktree) => worktree.worktreePath === worktreeRoot);
  assert.ok(linkedWorktree);
  assert.equal(linkedWorktree.scope, 'worktree');
  assert.equal(linkedWorktree.isCurrent, false);
  assert.equal(linkedWorktree.worktreeRef, 'feature/worktree');
});

test('getWorktrees marks missing linked worktrees as prunable', async (t) => {
  const { repoRoot, worktreeRoot } = createRepositoryWithLinkedWorktree(t);

  rmSync(worktreeRoot, { recursive: true, force: true });

  const worktrees = await getWorktrees(repoRoot);
  const prunableWorktree = worktrees.find((worktree) => worktree.worktreePath === worktreeRoot);

  assert.ok(prunableWorktree);
  assert.match(prunableWorktree.worktreePrunableReason, /prunable|non-existent|missing/i);
});

test('lockWorktree and unlockWorktree toggle the worktree lock state', async (t) => {
  const { repoRoot, worktreeRoot } = createRepositoryWithLinkedWorktree(t);

  await lockWorktree(repoRoot, worktreeRoot, 'In use elsewhere');
  const lockedWorktree = (await getWorktrees(repoRoot)).find(
    (worktree) => worktree.worktreePath === worktreeRoot
  );

  assert.ok(lockedWorktree);
  assert.equal(lockedWorktree.worktreeLockedReason, 'In use elsewhere');

  await unlockWorktree(repoRoot, worktreeRoot);
  const unlockedWorktree = (await getWorktrees(repoRoot)).find(
    (worktree) => worktree.worktreePath === worktreeRoot
  );

  assert.ok(unlockedWorktree);
  assert.equal(unlockedWorktree.worktreeLockedReason, undefined);
});

test('pruneWorktrees removes stale worktree admin entries for prunable worktrees', async (t) => {
  const { repoRoot, worktreeRoot } = createRepositoryWithLinkedWorktree(t);

  rmSync(worktreeRoot, { recursive: true, force: true });

  await pruneWorktrees(repoRoot);

  assert.equal(
    (await getWorktrees(repoRoot)).some((worktree) => worktree.worktreePath === worktreeRoot),
    false
  );
});

test('cherryPickRef applies the selected branch commit onto the current branch', async (t) => {
  const repoRoot = createTempRepository(t);

  runGit(repoRoot, ['checkout', '-b', 'feature/cherry-pick']);
  commitFile(repoRoot, 'feature.txt', 'feature branch commit\n', 'Add cherry-pickable change');
  runGit(repoRoot, ['checkout', 'main']);

  await cherryPickRef(repoRoot, 'feature/cherry-pick');

  assert.equal(readFileSync(join(repoRoot, 'feature.txt'), 'utf8'), 'feature branch commit\n');
  assert.equal(runGit(repoRoot, ['log', '-1', '--pretty=%s']), 'Add cherry-pickable change');
});

test('removeWorktree removes a linked worktree path', async (t) => {
  const { repoRoot, worktreeRoot } = createRepositoryWithLinkedWorktree(t);

  await removeWorktree(repoRoot, worktreeRoot);

  assert.equal(existsSync(worktreeRoot), false);
  assert.equal((await getWorktrees(repoRoot)).some((worktree) => worktree.worktreePath === worktreeRoot), false);
});

test('renameWorktree moves a linked worktree to its new path', async (t) => {
  const { repoRoot, worktreeRoot } = createRepositoryWithLinkedWorktree(t);
  const renamedWorktreeRoot = join(dirname(worktreeRoot), 'feature-worktree-renamed');

  await renameWorktree(repoRoot, worktreeRoot, renamedWorktreeRoot);

  assert.equal(existsSync(worktreeRoot), false);
  assert.equal(existsSync(renamedWorktreeRoot), true);
  const worktrees = await getWorktrees(repoRoot);
  assert.equal(worktrees.some((worktree) => worktree.worktreePath === worktreeRoot), false);
  assert.equal(worktrees.some((worktree) => worktree.worktreePath === renamedWorktreeRoot), true);
  assert.equal(runGit(renamedWorktreeRoot, ['rev-parse', '--abbrev-ref', 'HEAD']), 'feature/worktree');
});

test('fetchAllRemotes keeps stale remote refs while fetchRemoteState prunes them', async (t) => {
  const { repoRoot, remoteRoot } = createRemoteBackedRepository(t);
  const collaboratorRoot = cloneRepository(t, remoteRoot);

  runGit(repoRoot, ['checkout', '-b', 'feature/stale']);
  commitFile(repoRoot, 'stale.txt', 'stale\n', 'Add stale branch');
  runGit(repoRoot, ['push', '-u', 'origin', 'feature/stale']);
  runGit(repoRoot, ['checkout', 'main']);

  runGit(collaboratorRoot, ['fetch', 'origin']);
  runGit(collaboratorRoot, ['push', 'origin', '--delete', 'feature/stale']);

  await fetchAllRemotes(repoRoot);
  assert.equal(hasRef(repoRoot, 'refs/remotes/origin/feature/stale'), true);

  await fetchRemoteState(repoRoot);
  assert.equal(hasRef(repoRoot, 'refs/remotes/origin/feature/stale'), false);
});

test('cleanRepository removes untracked and ignored files and directories', async (t) => {
  const repoRoot = createTempRepository(t);

  writeFileSync(join(repoRoot, '.gitignore'), 'cache.txt\nbuild/\n');
  runGit(repoRoot, ['add', '.gitignore']);
  runGit(repoRoot, ['commit', '-m', 'Add ignore rules']);

  writeFileSync(join(repoRoot, 'scratch.txt'), 'scratch\n');
  writeFileSync(join(repoRoot, 'cache.txt'), 'cache\n');
  mkdirSync(join(repoRoot, 'build'), { recursive: true });
  writeFileSync(join(repoRoot, 'build', 'artifact.txt'), 'artifact\n');

  await cleanRepository(repoRoot);

  assert.equal(existsSync(join(repoRoot, 'scratch.txt')), false);
  assert.equal(existsSync(join(repoRoot, 'cache.txt')), false);
  assert.equal(existsSync(join(repoRoot, 'build')), false);
});

test('getDiffFilesBetweenRefs reports added, modified, and deleted files between refs', async (t) => {
  const repoRoot = createTempRepository(t);

  runGit(repoRoot, ['checkout', '-b', 'feature/compare']);
  writeFileSync(join(repoRoot, 'README.md'), '# Test repo\nupdated\n');
  writeFileSync(join(repoRoot, 'feature.txt'), 'feature\n');
  runGit(repoRoot, ['add', 'README.md', 'feature.txt']);
  runGit(repoRoot, ['commit', '-m', 'Update readme and add feature file']);
  runGit(repoRoot, ['checkout', 'main']);

  writeFileSync(join(repoRoot, 'legacy.txt'), 'legacy\n');
  runGit(repoRoot, ['add', 'legacy.txt']);
  runGit(repoRoot, ['commit', '-m', 'Add legacy file on main']);

  const changes = await getDiffFilesBetweenRefs(repoRoot, 'main', 'feature/compare');

  assert.deepEqual(
    changes.sort((left, right) => left.path.localeCompare(right.path)),
    [
      { status: 'A', path: 'feature.txt' },
      { status: 'D', path: 'legacy.txt' },
      { status: 'M', path: 'README.md' },
    ].sort((left, right) => left.path.localeCompare(right.path))
  );
});

test('getRefHistory lists recent commits for a branch with metadata', async (t) => {
  const repoRoot = createTempRepository(t);

  runGit(repoRoot, ['checkout', '-b', 'feature/history']);
  commitFile(repoRoot, 'history.txt', 'one\n', 'Add history file');
  writeFileSync(join(repoRoot, 'history.txt'), 'one\ntwo\n');
  runGit(repoRoot, ['commit', '-am', 'Update history file']);

  const history = await getRefHistory(repoRoot, 'feature/history', {
    limit: 2,
    includeMerges: true,
  });

  assert.equal(history.length, 2);
  assert.equal(history[0].subject, 'Update history file');
  assert.equal(history[0].authorName, 'Test User');
  assert.ok(history[0].sha.length >= 7);
  assert.ok(Array.isArray(history[0].parentShas));
  assert.match(history[0].body, /Update history file/);
});

test('getCommitDetails returns the selected commit metadata', async (t) => {
  const repoRoot = createTempRepository(t);

  runGit(repoRoot, ['checkout', '-b', 'feature/details']);
  commitFile(repoRoot, 'details.txt', 'details\n', 'Add details file');
  const commitSha = runGit(repoRoot, ['rev-parse', 'HEAD']);

  const commitDetails = await getCommitDetails(repoRoot, commitSha);

  assert.ok(commitDetails);
  assert.equal(commitDetails.sha, commitSha);
  assert.equal(commitDetails.subject, 'Add details file');
  assert.equal(commitDetails.shortSha, commitSha.slice(0, 7));
});

test('getChangedFilesForCommit reports modified files for a specific commit', async (t) => {
  const repoRoot = createTempRepository(t);

  runGit(repoRoot, ['checkout', '-b', 'feature/commit-files']);
  writeFileSync(join(repoRoot, 'README.md'), '# Test repo\nupdated\n');
  writeFileSync(join(repoRoot, 'commit-file.txt'), 'new\n');
  runGit(repoRoot, ['add', 'README.md', 'commit-file.txt']);
  runGit(repoRoot, ['commit', '-m', 'Update readme and add commit file']);
  const commitSha = runGit(repoRoot, ['rev-parse', 'HEAD']);

  const changes = await getChangedFilesForCommit(repoRoot, commitSha);

  assert.deepEqual(
    changes.sort((left, right) => left.path.localeCompare(right.path)),
    [
      { status: 'A', path: 'commit-file.txt' },
      { status: 'M', path: 'README.md' },
    ]
  );
});

test('getBranches includes upstream tracking details for local branches', async (t) => {
  const { repoRoot } = createRemoteBackedRepository(t);

  runGit(repoRoot, ['checkout', '-b', 'feature/ahead']);
  commitFile(repoRoot, 'feature.txt', 'first\n', 'Add feature branch');
  runGit(repoRoot, ['push', '-u', 'origin', 'feature/ahead']);
  commitFile(repoRoot, 'feature.txt', 'first\nsecond\n', 'Add more feature work');

  const branches = await getBranches(repoRoot);
  const featureBranch = branches.find((branch) => branch.name === 'feature/ahead');

  assert.ok(featureBranch);
  assert.equal(featureBranch.scope, 'local');
  assert.equal(featureBranch.upstreamName, 'origin/feature/ahead');
  assert.equal(featureBranch.aheadCount, 1);
  assert.equal(featureBranch.behindCount, 0);
});

test('getBranches marks local branches whose tracked upstream was deleted', async (t) => {
  const { repoRoot, remoteRoot } = createRemoteBackedRepository(t);
  const collaboratorRoot = cloneRepository(t, remoteRoot);

  runGit(repoRoot, ['checkout', '-b', 'feature/stale']);
  commitFile(repoRoot, 'stale.txt', 'stale\n', 'Add stale branch');
  runGit(repoRoot, ['push', '-u', 'origin', 'feature/stale']);
  runGit(repoRoot, ['checkout', 'main']);

  runGit(collaboratorRoot, ['fetch', 'origin']);
  runGit(collaboratorRoot, ['push', 'origin', '--delete', 'feature/stale']);

  await fetchRemoteState(repoRoot);

  const branches = await getBranches(repoRoot);
  const staleBranch = branches.find((branch) => branch.name === 'feature/stale');

  assert.ok(staleBranch);
  assert.equal(staleBranch.scope, 'local');
  assert.equal(staleBranch.upstreamName, 'origin/feature/stale');
  assert.equal(staleBranch.upstreamMissing, true);
  assert.equal(staleBranch.aheadCount, 0);
  assert.equal(staleBranch.behindCount, 0);
});

test('getRemoteBranches filters origin/HEAD while keeping real remote branches', async (t) => {
  const { repoRoot } = createRemoteBackedRepository(t);

  runGit(repoRoot, ['remote', 'set-head', 'origin', '-a']);

  const remoteBranches = await getRemoteBranches(repoRoot);

  assert.ok(remoteBranches.some((branch) => branch.name === 'origin/main'));
  assert.ok(remoteBranches.every((branch) => branch.name !== 'origin/HEAD'));
});

test('getRemoteBranches marks refs from removed remotes as stale', async (t) => {
  const { repoRoot } = createRemoteBackedRepository(t);

  runGit(repoRoot, [
    'update-ref',
    'refs/remotes/ghost/feature/stale-ghost',
    runGit(repoRoot, ['rev-parse', 'HEAD']),
  ]);

  const remoteBranches = await getRemoteBranches(repoRoot);
  const staleBranch = remoteBranches.find((branch) => branch.name === 'ghost/feature/stale-ghost');
  const liveBranch = remoteBranches.find((branch) => branch.name === 'origin/main');

  assert.ok(staleBranch);
  assert.equal(staleBranch.remoteTrackingState, 'stale');
  assert.ok(liveBranch);
  assert.equal(liveBranch.remoteTrackingState, 'live');
});

test('getRemoteBranchTrackingState detects stale remote-tracking refs after remote removal', async (t) => {
  const { repoRoot, remoteRoot } = createRemoteBackedRepository(t);

  runGit(repoRoot, ['remote', 'add', 'ghost', remoteRoot]);
  runGit(repoRoot, ['fetch', 'ghost']);
  runGit(repoRoot, ['remote', 'remove', 'ghost']);

  assert.equal(await getRemoteBranchTrackingState(repoRoot, 'origin/main'), 'live');
  assert.equal(await getRemoteBranchTrackingState(repoRoot, 'ghost/main'), 'stale');
});

test('deleteRemoteBranch rejects symbolic remote HEAD refs as invalid', async (t) => {
  const { repoRoot } = createRemoteBackedRepository(t);

  await assert.rejects(deleteRemoteBranch(repoRoot, 'origin/HEAD'), /is invalid/i);
});

test('checkoutRemoteBranch creates and reuses a tracking local branch', async (t) => {
  const { repoRoot } = createRemoteBackedRepository(t);

  runGit(repoRoot, ['checkout', '-b', 'feature/demo']);
  commitFile(repoRoot, 'demo.txt', 'demo\n', 'Add demo branch');
  runGit(repoRoot, ['push', '-u', 'origin', 'feature/demo']);
  runGit(repoRoot, ['checkout', 'main']);
  runGit(repoRoot, ['branch', '-D', 'feature/demo']);
  runGit(repoRoot, ['fetch', 'origin']);

  const createdBranch = await checkoutRemoteBranch(repoRoot, 'origin/feature/demo');

  assert.deepEqual(createdBranch, {
    localBranchName: 'feature/demo',
    remoteBranchName: 'origin/feature/demo',
    createdLocalBranch: true,
  });
  assert.equal(runGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']), 'feature/demo');
  assert.equal(
    runGit(repoRoot, ['config', '--get', 'branch.feature/demo.merge']),
    'refs/heads/feature/demo'
  );

  runGit(repoRoot, ['checkout', 'main']);

  const reusedBranch = await checkoutRemoteBranch(repoRoot, 'origin/feature/demo');

  assert.equal(reusedBranch.createdLocalBranch, false);
  assert.equal(runGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']), 'feature/demo');
});

test('pushBranch publishes a non-current branch without changing the active checkout', async (t) => {
  const { repoRoot } = createRemoteBackedRepository(t);

  runGit(repoRoot, ['checkout', '-b', 'feature/offline']);
  commitFile(repoRoot, 'offline.txt', 'offline\n', 'Add offline work');
  runGit(repoRoot, ['checkout', 'main']);

  const pushResult = await pushBranch(repoRoot, 'feature/offline');

  assert.deepEqual(pushResult, {
    branchName: 'feature/offline',
    upstreamName: 'origin/feature/offline',
    didPull: false,
    didPush: true,
    publishedUpstream: true,
  });
  assert.equal(runGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']), 'main');
  assert.match(runGit(repoRoot, ['ls-remote', '--heads', 'origin', 'feature/offline']), /refs\/heads\/feature\/offline/);
  assert.equal(
    runGit(repoRoot, ['config', '--get', 'branch.feature/offline.remote']),
    'origin'
  );
});

test('pushBranch publishes a non-current branch even when it is already checked out in another worktree', async (t) => {
  const { repoRoot } = createRemoteBackedRepository(t);
  const worktreeParent = mkdtempSync(join(tmpdir(), 'git-branches-panel-sync-worktree-'));
  const worktreeRoot = join(worktreeParent, 'feature-worktree');

  t.after(() => {
    rmSync(worktreeParent, { recursive: true, force: true });
  });

  runGit(repoRoot, ['checkout', '-b', 'feature/worktree-sync']);
  commitFile(repoRoot, 'worktree.txt', 'sync me\n', 'Add worktree sync branch');
  runGit(repoRoot, ['checkout', 'main']);
  runGit(repoRoot, ['worktree', 'add', worktreeRoot, 'feature/worktree-sync']);

  const pushResult = await pushBranch(repoRoot, 'feature/worktree-sync');

  assert.deepEqual(pushResult, {
    branchName: 'feature/worktree-sync',
    upstreamName: 'origin/feature/worktree-sync',
    didPull: false,
    didPush: true,
    publishedUpstream: true,
  });
  assert.equal(runGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']), 'main');
  assert.equal(runGit(worktreeRoot, ['rev-parse', '--abbrev-ref', 'HEAD']), 'feature/worktree-sync');
  assert.match(
    runGit(repoRoot, ['ls-remote', '--heads', 'origin', 'feature/worktree-sync']),
    /refs\/heads\/feature\/worktree-sync/
  );
});

test('pushBranch pushes a tracked non-current branch without pulling', async (t) => {
  const { repoRoot } = createRemoteBackedRepository(t);

  runGit(repoRoot, ['checkout', '-b', 'feature/ahead']);
  commitFile(repoRoot, 'ahead.txt', 'first\n', 'Add tracked branch');
  runGit(repoRoot, ['push', '-u', 'origin', 'feature/ahead']);
  commitFile(repoRoot, 'ahead.txt', 'first\nsecond\n', 'Add outgoing commit');
  runGit(repoRoot, ['checkout', 'main']);

  const pushResult = await pushBranch(repoRoot, 'feature/ahead');
  const remoteSha = runGit(repoRoot, ['ls-remote', '--heads', 'origin', 'feature/ahead']).split(/\s+/u)[0];

  assert.deepEqual(pushResult, {
    branchName: 'feature/ahead',
    upstreamName: 'origin/feature/ahead',
    didPull: false,
    didPush: true,
    publishedUpstream: false,
  });
  assert.equal(runGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']), 'main');
  assert.equal(remoteSha, runGit(repoRoot, ['rev-parse', 'feature/ahead']));
});

test('syncBranch rejects branches that are not tracking a remote branch yet', async (t) => {
  const { repoRoot } = createRemoteBackedRepository(t);

  runGit(repoRoot, ['checkout', '-b', 'feature/offline']);
  commitFile(repoRoot, 'offline.txt', 'offline\n', 'Add offline work');
  runGit(repoRoot, ['checkout', 'main']);

  await assert.rejects(
    syncBranch(repoRoot, 'feature/offline'),
    /not tracking a remote branch yet\. Publish it first\./i
  );
});

test('syncBranch updates the current branch from remote changes', async (t) => {
  const { repoRoot, remoteRoot } = createRemoteBackedRepository(t);
  const collaboratorRoot = cloneRepository(t, remoteRoot);

  writeFileSync(join(collaboratorRoot, 'README.md'), '# Test repo\nremote change\n');
  runGit(collaboratorRoot, ['commit', '-am', 'Remote change']);
  runGit(collaboratorRoot, ['push', 'origin', 'main']);

  const syncResult = await syncBranch(repoRoot, 'main');

  assert.deepEqual(syncResult, {
    branchName: 'main',
    upstreamName: 'origin/main',
    didPull: true,
    didPush: false,
    publishedUpstream: false,
  });
  assert.equal(runGit(repoRoot, ['log', '-1', '--pretty=%s']), 'Remote change');
  assert.match(readFileSync(join(repoRoot, 'README.md'), 'utf8'), /remote change/);
});
