const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BranchItemActivationTracker,
  DOUBLE_CLICK_WINDOW_MS,
  buildCurrentBranchMessage,
  buildSyncResultMessage,
  looksLikeMergeSafetyError,
  validateBranchName,
} = require('../out/extensionHelpers.js');

test('buildSyncResultMessage covers sync outcomes', () => {
  assert.equal(
    buildSyncResultMessage({
      branchName: 'main',
      upstreamName: 'origin/main',
      didPull: false,
      didPush: false,
      publishedUpstream: false,
    }),
    "'main' is already up to date with 'origin/main'."
  );

  assert.equal(
    buildSyncResultMessage({
      branchName: 'main',
      upstreamName: 'origin/main',
      didPull: true,
      didPush: true,
      publishedUpstream: false,
    }),
    "Synced 'main' with 'origin/main' (pulled and pushed)."
  );

  assert.equal(
    buildSyncResultMessage({
      branchName: 'main',
      upstreamName: 'origin/main',
      didPull: true,
      didPush: false,
      publishedUpstream: false,
    }),
    "Updated 'main' from 'origin/main'."
  );

  assert.equal(
    buildSyncResultMessage({
      branchName: 'feature/demo',
      upstreamName: 'origin/feature/demo',
      didPull: false,
      didPush: true,
      publishedUpstream: true,
    }),
    "Published 'feature/demo' to 'origin/feature/demo'."
  );

  assert.equal(
    buildSyncResultMessage({
      branchName: 'feature/demo',
      upstreamName: 'origin/feature/demo',
      didPull: false,
      didPush: true,
      publishedUpstream: false,
    }),
    "Pushed 'feature/demo' to 'origin/feature/demo'."
  );
});

test('validateBranchName rejects invalid names and allows trimmed valid names', () => {
  assert.equal(validateBranchName('   '), 'Branch name cannot be empty.');
  assert.equal(validateBranchName('feature has spaces'), 'Branch name cannot contain spaces.');
  assert.equal(validateBranchName('-feature/demo'), 'Branch name cannot start with a dash.');
  assert.equal(
    validateBranchName('feature/demo/'),
    'Branch name cannot end with a slash or contain empty path segments.'
  );
  assert.equal(
    validateBranchName('feature//demo'),
    'Branch name cannot end with a slash or contain empty path segments.'
  );
  assert.equal(
    validateBranchName(' main ', 'main'),
    'Please enter a different branch name.'
  );
  assert.equal(validateBranchName(' feature/demo '), undefined);
});

test('looksLikeMergeSafetyError only flags merge-safety failures', () => {
  assert.equal(looksLikeMergeSafetyError('branch is not fully merged'), true);
  assert.equal(looksLikeMergeSafetyError('fatal: refusing to delete branch'), false);
});

test('buildCurrentBranchMessage includes sync and timing details when available', () => {
  assert.equal(
    buildCurrentBranchMessage({
      name: 'main',
      isCurrent: true,
      lastCommitDate: '2 minutes ago',
      aheadCount: 1,
      behindCount: 2,
    }),
    'Current branch: main • 2↓ 1↑ • 2 minutes ago'
  );

  assert.equal(
    buildCurrentBranchMessage({
      name: 'main',
      isCurrent: true,
      lastCommitDate: '',
      aheadCount: 0,
      behindCount: 0,
    }),
    'Current branch: main'
  );

  assert.equal(buildCurrentBranchMessage(undefined), '');
});

test('BranchItemActivationTracker requires a double activation inside the time window', () => {
  let now = 1_000;
  const tracker = new BranchItemActivationTracker(() => now);
  const branchItem = {
    branchName: 'feature/demo',
    repoRoot: '/repo',
  };

  assert.equal(tracker.shouldCheckout({ branchName: undefined, repoRoot: '/repo' }), false);
  assert.equal(tracker.shouldCheckout(branchItem), false);

  now += DOUBLE_CLICK_WINDOW_MS - 1;
  assert.equal(tracker.shouldCheckout(branchItem), true);

  tracker.reset();
  now += 1;
  assert.equal(tracker.shouldCheckout(branchItem), false);

  now += DOUBLE_CLICK_WINDOW_MS + 1;
  assert.equal(tracker.shouldCheckout(branchItem), false);
});

test('BranchItemActivationTracker isolates activation history by branch and repository', () => {
  let now = 5_000;
  const tracker = new BranchItemActivationTracker(() => now);

  assert.equal(tracker.shouldCheckout({ branchName: 'feature/demo', repoRoot: '/repo-a' }), false);

  now += 10;
  assert.equal(tracker.shouldCheckout({ branchName: 'feature/demo', repoRoot: '/repo-b' }), false);

  now += 10;
  assert.equal(tracker.shouldCheckout({ branchName: 'feature/other', repoRoot: '/repo-b' }), false);

  now += 10;
  assert.equal(tracker.shouldCheckout({ branchName: 'feature/other', repoRoot: '/repo-b' }), true);
});
