const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  checkoutRemoteBranch,
  checkoutTag,
  deleteTag,
  getBranches,
  getRemoteBranches,
  getTags,
  parseRemoteBranchReference,
  syncBranch,
} = require('../out/git.js');

function runGit(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
  }).trim();
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
