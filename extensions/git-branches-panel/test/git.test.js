const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  applyStash,
  checkoutRemoteBranch,
  checkoutTag,
  createTag,
  deleteTag,
  dropStash,
  fetchAllRemotes,
  fetchRemoteState,
  getDiffFilesBetweenRefs,
  getBranches,
  getRemotes,
  getRemoteBranches,
  getStashes,
  getTags,
  getWorktrees,
  parseRemoteBranchReference,
  popStash,
  pushAllTags,
  removeWorktree,
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

test('getRemotes lists configured git remotes', async (t) => {
  const { repoRoot } = createRemoteBackedRepository(t);

  const remotes = await getRemotes(repoRoot);

  assert.deepEqual(remotes, ['origin']);
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

test('removeWorktree removes a linked worktree path', async (t) => {
  const { repoRoot, worktreeRoot } = createRepositoryWithLinkedWorktree(t);

  await removeWorktree(repoRoot, worktreeRoot);

  assert.equal(existsSync(worktreeRoot), false);
  assert.equal((await getWorktrees(repoRoot)).some((worktree) => worktree.worktreePath === worktreeRoot), false);
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

test('getRemoteBranches filters origin/HEAD while keeping real remote branches', async (t) => {
  const { repoRoot } = createRemoteBackedRepository(t);

  runGit(repoRoot, ['remote', 'set-head', 'origin', '-a']);

  const remoteBranches = await getRemoteBranches(repoRoot);

  assert.ok(remoteBranches.some((branch) => branch.name === 'origin/main'));
  assert.ok(remoteBranches.every((branch) => branch.name !== 'origin/HEAD'));
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

test('syncBranch publishes a non-current branch without changing the active checkout', async (t) => {
  const { repoRoot } = createRemoteBackedRepository(t);

  runGit(repoRoot, ['checkout', '-b', 'feature/offline']);
  commitFile(repoRoot, 'offline.txt', 'offline\n', 'Add offline work');
  runGit(repoRoot, ['checkout', 'main']);

  const syncResult = await syncBranch(repoRoot, 'feature/offline');

  assert.deepEqual(syncResult, {
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

test('syncBranch publishes a non-current branch even when it is already checked out in another worktree', async (t) => {
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

  const syncResult = await syncBranch(repoRoot, 'feature/worktree-sync');

  assert.deepEqual(syncResult, {
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
