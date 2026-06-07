const assert = require('node:assert/strict');
const test = require('node:test');

const {
  isBranchProtectedFromDeletion,
  normalizeConfiguredBranchNames,
  normalizeConfiguredBranchPrefixes,
} = require('../out/branchRules.js');

test('normalizeConfiguredBranchNames trims, filters, and deduplicates values', () => {
  assert.deepEqual(normalizeConfiguredBranchNames([' main ', '', 'develop', 'main']), [
    'main',
    'develop',
  ]);
  assert.deepEqual(normalizeConfiguredBranchNames(undefined), []);
});

test('normalizeConfiguredBranchPrefixes sanitizes and deduplicates configured prefixes', () => {
  assert.deepEqual(
    normalizeConfiguredBranchPrefixes([' feature/ ', 'bug fix', 'feature', '??', 'team/backend ']),
    ['feature', 'bug-fix', 'team/backend']
  );
});

test('isBranchProtectedFromDeletion matches local and remote branch names', () => {
  const protectedBranchNames = ['main', 'develop', 'release/2026.06'];

  assert.equal(
    isBranchProtectedFromDeletion({ name: 'main', scope: 'local' }, protectedBranchNames),
    true
  );
  assert.equal(
    isBranchProtectedFromDeletion({ name: 'origin/main', scope: 'remote' }, protectedBranchNames),
    true
  );
  assert.equal(
    isBranchProtectedFromDeletion(
      { name: 'origin/release/2026.06', scope: 'remote' },
      protectedBranchNames
    ),
    true
  );
  assert.equal(
    isBranchProtectedFromDeletion(
      { name: 'feature/main-improvement', scope: 'local' },
      protectedBranchNames
    ),
    false
  );
});
