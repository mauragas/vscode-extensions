import * as vscode from 'vscode';

import { hasSourceBranchUpdate } from './branchModel';
import type { BranchTreeItem, NodeType } from './treeItem';

export type BranchViewId = 'gitBranchesPanel' | 'gitBranchesSCM';

const BRANCH_VIEW_IDS = ['gitBranchesPanel', 'gitBranchesSCM'] as const;

export const SELECTED_ITEM_PINNED_CONTEXTS: Readonly<Record<BranchViewId, string>> = {
  gitBranchesPanel: 'gitBranchesPanel.branchesViewSelectedItemPinned',
  gitBranchesSCM: 'gitBranchesPanel.scmViewSelectedItemPinned',
};

export const SELECTED_ITEM_SOURCE_UPDATE_CONTEXTS: Readonly<Record<BranchViewId, string>> = {
  gitBranchesPanel: 'gitBranchesPanel.branchesViewSelectedItemCanUpdateFromSource',
  gitBranchesSCM: 'gitBranchesPanel.scmViewSelectedItemCanUpdateFromSource',
};

type PinnableBranchTreeItem = BranchTreeItem & {
  branchInfo: NonNullable<BranchTreeItem['branchInfo']>;
  repoRoot: NonNullable<BranchTreeItem['repoRoot']>;
};

type SourceUpdatableBranchTreeItem = BranchTreeItem & {
  branchInfo: NonNullable<BranchTreeItem['branchInfo']>;
  repoRoot: NonNullable<BranchTreeItem['repoRoot']>;
};

interface SelectedPinnableItemState {
  readonly repoRoot: string;
  readonly nodeType: NodeType;
  readonly branchName: string;
  readonly scope: string;
  readonly isPinned: boolean;
}

const PINNABLE_NODE_TYPES = new Set<NodeType>([
  'branch',
  'currentBranch',
  'missingUpstreamBranch',
  'remoteBranch',
  'staleRemoteBranch',
  'tag',
  'stash',
  'worktree',
]);

const SOURCE_UPDATABLE_NODE_TYPES = new Set<NodeType>([
  'branch',
  'currentBranch',
  'missingUpstreamBranch',
]);

const selectedItemStates = new Map<BranchViewId, SelectedPinnableItemState | undefined>();

export function isPinnableItem(
  item: BranchTreeItem | undefined
): item is PinnableBranchTreeItem {
  return Boolean(
    item?.repoRoot && item.branchInfo && PINNABLE_NODE_TYPES.has(item.nodeType)
  );
}

export function isSourceUpdatableItem(
  item: BranchTreeItem | undefined
): item is SourceUpdatableBranchTreeItem {
  return Boolean(
    item?.repoRoot &&
      item.branchInfo &&
      SOURCE_UPDATABLE_NODE_TYPES.has(item.nodeType) &&
      hasSourceBranchUpdate(item.branchInfo)
  );
}

export async function setSelectedItemPinnedContextValue(
  viewId: BranchViewId,
  isPinned: boolean
): Promise<void> {
  await vscode.commands.executeCommand(
    'setContext',
    SELECTED_ITEM_PINNED_CONTEXTS[viewId],
    isPinned
  );
}

export async function updateSelectedItemPinnedContext(
  viewId: BranchViewId,
  item: BranchTreeItem | undefined
): Promise<void> {
  const selectedItemState = toSelectedPinnableItemState(item);

  selectedItemStates.set(viewId, selectedItemState);
  await setSelectedItemPinnedContextValue(viewId, Boolean(selectedItemState?.isPinned));
}

export async function setSelectedItemCanUpdateFromSourceContextValue(
  viewId: BranchViewId,
  canUpdateFromSource: boolean
): Promise<void> {
  await vscode.commands.executeCommand(
    'setContext',
    SELECTED_ITEM_SOURCE_UPDATE_CONTEXTS[viewId],
    canUpdateFromSource
  );
}

export async function updateSelectedItemCanUpdateFromSourceContext(
  viewId: BranchViewId,
  item: BranchTreeItem | undefined
): Promise<void> {
  await setSelectedItemCanUpdateFromSourceContextValue(viewId, isSourceUpdatableItem(item));
}

export async function syncSelectedItemPinnedContexts(
  treeViews: ReadonlyArray<{
    readonly viewId: BranchViewId;
    readonly treeView: vscode.TreeView<BranchTreeItem>;
  }>
): Promise<void> {
  await Promise.all(
    treeViews.map(({ viewId, treeView }) =>
      updateSelectedItemPinnedContext(viewId, treeView.selection[0])
    )
  );
}

export async function syncSelectedItemCanUpdateFromSourceContexts(
  treeViews: ReadonlyArray<{
    readonly viewId: BranchViewId;
    readonly treeView: vscode.TreeView<BranchTreeItem>;
  }>
): Promise<void> {
  await Promise.all(
    treeViews.map(({ viewId, treeView }) =>
      updateSelectedItemCanUpdateFromSourceContext(viewId, treeView.selection[0])
    )
  );
}

export async function updateMatchingSelectedItemPinnedContexts(
  item: BranchTreeItem,
  isPinned: boolean
): Promise<void> {
  const toggledItemState = toSelectedPinnableItemState(item);
  if (!toggledItemState) {
    return;
  }

  const matchingViewIds = BRANCH_VIEW_IDS.filter((viewId) => {
    const selectedItemState = selectedItemStates.get(viewId);
    return Boolean(selectedItemState && isSameSelectedPinnableItem(selectedItemState, toggledItemState));
  });

  await Promise.all(
    matchingViewIds.map(async (viewId) => {
      const selectedItemState = selectedItemStates.get(viewId);
      if (selectedItemState) {
        selectedItemStates.set(viewId, {
          ...selectedItemState,
          isPinned,
        });
      }

      await setSelectedItemPinnedContextValue(viewId, isPinned);
    })
  );
}

function toSelectedPinnableItemState(
  item: BranchTreeItem | undefined
): SelectedPinnableItemState | undefined {
  if (!isPinnableItem(item)) {
    return undefined;
  }

  return {
    repoRoot: item.repoRoot,
    nodeType: item.nodeType,
    branchName: item.branchInfo.name,
    scope: item.branchInfo.scope ?? 'local',
    isPinned: Boolean(item.branchInfo.isPinned),
  };
}

function isSameSelectedPinnableItem(
  left: SelectedPinnableItemState,
  right: SelectedPinnableItemState
): boolean {
  return (
    left.repoRoot === right.repoRoot &&
    left.nodeType === right.nodeType &&
    left.branchName === right.branchName &&
    left.scope === right.scope
  );
}
