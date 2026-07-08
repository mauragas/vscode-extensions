import * as vscode from 'vscode';

import { hasSourceBranchUpdate } from './branchModel';
import type { BranchTreeItem } from './treeItem';
import type { BranchViewId } from './pinContext';

export const SELECTED_ITEM_CAN_UPDATE_FROM_SOURCE_CONTEXTS: Readonly<Record<BranchViewId, string>> = {
  gitBranchesPanel: 'gitBranchesPanel.branchesViewSelectedItemCanUpdateFromSource',
  gitBranchesSCM: 'gitBranchesPanel.scmViewSelectedItemCanUpdateFromSource',
};

export async function updateSelectedItemCanUpdateFromSourceContext(
  viewId: BranchViewId,
  item: BranchTreeItem | undefined
): Promise<void> {
  await setSelectedItemCanUpdateFromSourceContextValue(viewId, canUpdateFromSource(item));
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

async function setSelectedItemCanUpdateFromSourceContextValue(
  viewId: BranchViewId,
  canUpdate: boolean
): Promise<void> {
  await vscode.commands.executeCommand(
    'setContext',
    SELECTED_ITEM_CAN_UPDATE_FROM_SOURCE_CONTEXTS[viewId],
    canUpdate
  );
}

function canUpdateFromSource(item: BranchTreeItem | undefined): boolean {
  return Boolean(item?.branchInfo && hasSourceBranchUpdate(item.branchInfo));
}
