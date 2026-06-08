import * as vscode from 'vscode';

import type { BranchTreeItem, NodeType } from './treeItem';

export const SELECTED_ITEM_PINNED_CONTEXT = 'gitBranchesPanel.selectedItemPinned';

type PinnableBranchTreeItem = BranchTreeItem & {
  branchInfo: NonNullable<BranchTreeItem['branchInfo']>;
  repoRoot: NonNullable<BranchTreeItem['repoRoot']>;
};

const PINNABLE_NODE_TYPES = new Set<NodeType>([
  'branch',
  'currentBranch',
  'missingUpstreamBranch',
  'remoteBranch',
  'staleRemoteBranch',
  'stash',
  'worktree',
]);

export function isPinnableItem(
  item: BranchTreeItem | undefined
): item is PinnableBranchTreeItem {
  return Boolean(
    item?.repoRoot && item.branchInfo && PINNABLE_NODE_TYPES.has(item.nodeType)
  );
}

export async function setSelectedItemPinnedContextValue(isPinned: boolean): Promise<void> {
  await vscode.commands.executeCommand(
    'setContext',
    SELECTED_ITEM_PINNED_CONTEXT,
    isPinned
  );
}

export async function updateSelectedItemPinnedContext(
  item: BranchTreeItem | undefined
): Promise<void> {
  const isPinned = isPinnableItem(item) ? Boolean(item.branchInfo.isPinned) : false;
  await setSelectedItemPinnedContextValue(isPinned);
}
