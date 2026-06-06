const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BranchItemActivationTracker,
  DOUBLE_CLICK_WINDOW_MS,
  buildCurrentBranchMessage,
  buildSyncResultMessage,
  looksLikeMergeSafetyError,
  normalizeBranchName,
  validateBranchName,
  validateTagName,
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

test('normalizeBranchName converts mixed case names to lowercase kebab-case and preserves folders', () => {
  assert.equal(normalizeBranchName('Feature/make Fix'), 'feature/make-fix');
  assert.equal(normalizeBranchName('Feature/make-Fix'), 'feature/make-fix');
  assert.equal(normalizeBranchName('  Release/Hot Fix  '), 'release/hot-fix');
  assert.equal(normalizeBranchName('Feature/Sub Feature/Next Step'), 'feature/sub-feature/next-step');
  assert.equal(normalizeBranchName('Feature/make--Fix'), 'feature/make-fix');
});

test('validateBranchName respects normalization when enabled', () => {
  assert.equal(validateBranchName('Feature/make Fix', undefined, { normalize: true }), undefined);
  assert.equal(
    validateBranchName(' feature/demo ', 'Feature/Demo', { normalize: true }),
    'Please enter a different branch name.'
  );
});

test('validateTagName rejects invalid names and allows trimmed valid names', () => {
  assert.equal(validateTagName('   '), 'Tag name cannot be empty.');
  assert.equal(validateTagName('release candidate'), 'Tag name cannot contain spaces.');
  assert.equal(validateTagName('-release/v1.0.0'), 'Tag name cannot start with a dash.');
  assert.equal(
    validateTagName('release/'),
    'Tag name cannot start or end with a slash or contain empty path segments.'
  );
  assert.equal(
    validateTagName('release//candidate'),
    'Tag name cannot start or end with a slash or contain empty path segments.'
  );
  assert.equal(
    validateTagName('release..candidate'),
    'Tag name cannot end with a dot or contain consecutive dots.'
  );
  assert.equal(validateTagName('release[candidate'), 'Tag name contains invalid Git characters.');
  assert.equal(validateTagName('release\\candidate'), 'Tag name contains invalid Git characters.');
  assert.equal(validateTagName('release^candidate'), 'Tag name contains invalid Git characters.');
  assert.equal(validateTagName('release@{candidate'), 'Tag name contains invalid Git characters.');
  assert.equal(validateTagName('release.lock'), "Tag name cannot end with '.lock'.");
  assert.equal(validateTagName(' release/v1.0.0 '), undefined);
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
  assert.equal(
    buildCurrentBranchMessage(
      {
        name: 'main',
        isCurrent: true,
      },
      false
    ),
    ''
  );
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
