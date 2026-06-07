import type * as vscode from 'vscode';

import type { BranchInfo } from './branchModel';

const PINNED_ITEMS_STORAGE_KEY = 'gitBranchesPanel.pinnedItems';

type PinnableBranchIdentity = Pick<
  BranchInfo,
  'name' | 'scope' | 'worktreePath' | 'stashRevision'
>;

export class PinnedItemsStore {
  private readonly pinnedKeys: Set<string>;

  constructor(
    private readonly workspaceState: Pick<vscode.Memento, 'get' | 'update'> =
      createInMemoryMemento()
  ) {
    this.pinnedKeys = new Set(
      this.workspaceState.get<string[]>(PINNED_ITEMS_STORAGE_KEY, [])
    );
  }

  isPinned(repoRoot: string, branch: PinnableBranchIdentity): boolean {
    return this.pinnedKeys.has(buildPinnedItemKey(repoRoot, branch));
  }

  async toggle(repoRoot: string, branch: PinnableBranchIdentity): Promise<boolean> {
    const key = buildPinnedItemKey(repoRoot, branch);
    const nextPinned = !this.pinnedKeys.has(key);

    if (nextPinned) {
      this.pinnedKeys.add(key);
    } else {
      this.pinnedKeys.delete(key);
    }

    await this.workspaceState.update(PINNED_ITEMS_STORAGE_KEY, [...this.pinnedKeys].sort());
    return nextPinned;
  }
}

export function buildPinnedItemKey(
  repoRoot: string,
  branch: PinnableBranchIdentity
): string {
  const scope = branch.scope ?? 'local';

  let identity = branch.name;
  if (scope === 'worktree') {
    identity = branch.worktreePath ?? branch.name;
  } else if (scope === 'stash') {
    identity = branch.stashRevision ?? branch.name;
  }

  return `${repoRoot}::${scope}::${identity}`;
}

function createInMemoryMemento(): Pick<vscode.Memento, 'get' | 'update'> {
  const values = new Map<string, unknown>();

  return {
    get<T>(key: string, defaultValue?: T): T | undefined {
      return values.has(key) ? (values.get(key) as T) : defaultValue;
    },
    async update(key: string, value: unknown): Promise<void> {
      values.set(key, value);
    },
  };
}
