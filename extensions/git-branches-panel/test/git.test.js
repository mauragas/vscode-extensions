const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const {
  checkoutTag,
  deleteTag,
  getTags,
  parseRemoteBranchReference,
} = require('../out/git.js');

function runGit(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
  }).trim();
}

function createTempRepository(t) {
  const repoRoot = mkdtempSync(join(tmpdir(), 'git-branches-panel-test-'));
  t.after(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  runGit(repoRoot, ['init', '-b', 'main']);
  runGit(repoRoot, ['config', 'user.name', 'Test User']);
  runGit(repoRoot, ['config', 'user.email', 'test@example.com']);

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
