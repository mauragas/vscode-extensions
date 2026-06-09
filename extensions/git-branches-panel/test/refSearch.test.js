const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildFilterSummary,
  createNeedsAttentionFilterState,
  createRefFilterState,
  filterTreeNodes,
  findMatchingRefs,
  hasActiveFilter,
  parseRefQuery,
} = require('../out/search/refSearch.js');

function createSampleTree() {
  return [
    {
      kind: 'repository',
      label: 'repo-a',
      path: 'repo:/repo-a',
      repoRoot: '/repo-a',
      children: [
        {
          kind: 'section',
          label: 'Local',
          path: 'section:local',
          scope: 'local',
          repoRoot: '/repo-a',
          children: [
            {
              kind: 'folder',
              label: 'feature',
              path: 'feature',
              scope: 'local',
              repoRoot: '/repo-a',
              children: [
                {
                  kind: 'branch',
                  fullName: 'feature/demo',
                  label: 'demo',
                  path: 'feature/demo',
                  repoRoot: '/repo-a',
                  info: {
                    name: 'feature/demo',
                    isCurrent: false,
                    isPinned: true,
                    lastCommit: 'demo work',
                    lastCommitTimestamp: 10,
                  },
                },
              ],
            },
            {
              kind: 'branch',
              fullName: 'main',
              label: 'main',
              path: 'main',
              repoRoot: '/repo-a',
              info: {
                name: 'main',
                isCurrent: true,
                upstreamName: 'origin/main',
                lastCommitTimestamp: 20,
              },
            },
          ],
        },
        {
          kind: 'section',
          label: 'Remote',
          path: 'section:remote',
          scope: 'remote',
          repoRoot: '/repo-a',
          children: [
            {
              kind: 'branch',
              fullName: 'origin/main',
              label: 'main',
              path: 'origin/main',
              repoRoot: '/repo-a',
              info: {
                name: 'origin/main',
                isCurrent: false,
                scope: 'remote',
                remoteName: 'origin',
                remoteTrackingState: 'stale',
                lastCommitTimestamp: 15,
              },
            },
          ],
        },
      ],
    },
    {
      kind: 'repository',
      label: 'repo-b',
      path: 'repo:/repo-b',
      repoRoot: '/repo-b',
      children: [
        {
          kind: 'section',
          label: 'Stash',
          path: 'section:stash',
          scope: 'stash',
          repoRoot: '/repo-b',
          children: [
            {
              kind: 'branch',
              fullName: 'stash@{0}',
              label: 'stash@{0}',
              path: 'stash@{0}',
              repoRoot: '/repo-b',
              info: {
                name: 'stash@{0}',
                isCurrent: false,
                scope: 'stash',
                lastCommit: 'hotfix stash',
                lastCommitTimestamp: 12,
              },
            },
          ],
        },
        {
          kind: 'section',
          label: 'Worktree',
          path: 'section:worktree',
          scope: 'worktree',
          repoRoot: '/repo-b',
          children: [
            {
              kind: 'branch',
              fullName: '/tmp/demo-worktree',
              label: 'demo-worktree',
              path: '/tmp/demo-worktree',
              repoRoot: '/repo-b',
              info: {
                name: '/tmp/demo-worktree',
                isCurrent: false,
                scope: 'worktree',
                worktreePath: '/tmp/demo-worktree',
                worktreeRef: 'feature/demo',
                lastCommitTimestamp: 8,
              },
            },
          ],
        },
        {
          kind: 'section',
          label: 'Hooks',
          path: 'section:hooks',
          scope: 'hook',
          repoRoot: '/repo-b',
          children: [
            {
              kind: 'branch',
              fullName: 'pre-commit · shared',
              label: 'pre-commit · shared',
              path: 'pre-commit · shared',
              repoRoot: '/repo-b',
              info: {
                name: 'pre-commit · shared',
                isCurrent: false,
                scope: 'hook',
                hookName: 'pre-commit',
                hookSource: 'shared',
                hookEnabled: true,
              },
            },
          ],
        },
      ],
    },
  ];
}

test('parseRefQuery extracts scopes, states, and text terms', () => {
  const parsed = parseRefQuery('local:feature state:stale demo');

  assert.deepEqual(parsed.scopes, ['local']);
  assert.deepEqual(parsed.states, ['stale']);
  assert.deepEqual(parsed.textTerms, ['feature', 'demo']);
});

test('hasActiveFilter and buildFilterSummary reflect query, pinned-only, and preset filters', () => {
  const queryFilter = createRefFilterState('remote:origin state:stale', {
    showOnlyPinned: true,
  });
  const needsAttentionFilter = createNeedsAttentionFilterState();

  assert.equal(hasActiveFilter(createRefFilterState('')), false);
  assert.equal(hasActiveFilter(queryFilter), true);
  assert.equal(buildFilterSummary(queryFilter), 'Filter: query: remote:origin state:stale • pinned only');
  assert.equal(buildFilterSummary(needsAttentionFilter), 'Filter: needs attention');
});

test('filterTreeNodes keeps matching branches and expands ancestor containers', () => {
  const filteredTree = filterTreeNodes(
    createSampleTree(),
    createRefFilterState('local:feature', { showOnlyPinned: true })
  );

  assert.equal(filteredTree.length, 1);
  assert.equal(filteredTree[0].kind, 'repository');
  assert.equal(filteredTree[0].expanded, true);
  assert.equal(filteredTree[0].children.length, 1);
  assert.equal(filteredTree[0].children[0].expanded, true);
  assert.equal(filteredTree[0].children[0].children[0].expanded, true);
  assert.equal(
    filteredTree[0].children[0].children[0].children[0].fullName,
    'feature/demo'
  );
});

test('findMatchingRefs ranks exact matches first and can include hooks when enabled', () => {
  const exactResults = findMatchingRefs(createSampleTree(), 'feature/demo', {
    includeHooks: false,
    maxResults: 10,
  });
  const hookResults = findMatchingRefs(createSampleTree(), 'hook:pre-commit', {
    includeHooks: true,
    maxResults: 10,
  });

  assert.equal(exactResults[0].node.fullName, 'feature/demo');
  assert.match(exactResults[0].description, /repo-a/);
  assert.equal(hookResults.length, 1);
  assert.equal(hookResults[0].node.info.scope, 'hook');
});

test('findMatchingRefs supports the needs-attention states through query flags', () => {
  const staleResults = findMatchingRefs(createSampleTree(), 'state:stale', {
    includeHooks: false,
    maxResults: 10,
  });

  assert.deepEqual(staleResults.map((result) => result.node.fullName), ['origin/main']);
});
