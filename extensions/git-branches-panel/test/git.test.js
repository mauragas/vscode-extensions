const assert = require('node:assert/strict');
const test = require('node:test');

const { parseRemoteBranchReference } = require('../out/git.js');

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
