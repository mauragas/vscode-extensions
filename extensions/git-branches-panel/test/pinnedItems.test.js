const assert = require('node:assert/strict');
const test = require('node:test');

const { PinnedItemsStore, buildPinnedItemKey } = require('../out/pinnedItems.js');

const PINNED_ITEMS_STORAGE_KEY = 'gitBranchesPanel.pinnedItems';

function createMemento(initialValue = []) {
  const values = new Map([[PINNED_ITEMS_STORAGE_KEY, initialValue]]);
  const updates = [];

  return {
    updates,
    memento: {
      get(key, defaultValue) {
        return values.has(key) ? values.get(key) : defaultValue;
      },
      async update(key, value) {
        values.set(key, value);
        updates.push({ key, value });
      },
    },
  };
}

test('buildPinnedItemKey prefers stable worktree and stash identities', () => {
  assert.equal(
    buildPinnedItemKey('/repo', {
      name: '/tmp/repo-main',
      scope: 'worktree',
      worktreePath: '/tmp/repo-main',
    }),
    '/repo::worktree::/tmp/repo-main'
  );
  assert.equal(
    buildPinnedItemKey('/repo', {
      name: 'stash@{0}',
      scope: 'stash',
      stashRevision: 'abcdef1234567890',
    }),
    '/repo::stash::abcdef1234567890'
  );
  assert.equal(
    buildPinnedItemKey('/repo', {
      name: 'feature/demo',
      scope: 'local',
    }),
    '/repo::local::feature/demo'
  );
});

test('PinnedItemsStore toggles pin state and persists sorted keys', async () => {
  const { memento, updates } = createMemento(['/repo::local::main']);
  const store = new PinnedItemsStore(memento);

  assert.equal(
    store.isPinned('/repo', {
      name: 'main',
      scope: 'local',
    }),
    true
  );

  const didPinFeature = await store.toggle('/repo', {
    name: 'feature/demo',
    scope: 'local',
  });
  const didKeepPinnedFeature = store.isPinned('/repo', {
    name: 'feature/demo',
    scope: 'local',
  });
  const didUnpinMain = await store.toggle('/repo', {
    name: 'main',
    scope: 'local',
  });

  assert.equal(didPinFeature, true);
  assert.equal(didKeepPinnedFeature, true);
  assert.equal(didUnpinMain, false);
  assert.deepEqual(updates, [
    {
      key: PINNED_ITEMS_STORAGE_KEY,
      value: ['/repo::local::feature/demo', '/repo::local::main'],
    },
    {
      key: PINNED_ITEMS_STORAGE_KEY,
      value: ['/repo::local::feature/demo'],
    },
  ]);
});
