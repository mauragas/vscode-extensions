import * as vscode from 'vscode';

import { buildCurrentBranchMessage } from './extensionHelpers';
import { updateSelectedItemPinnedContext } from './pinContext';
import { BranchTreeProvider, BranchTreeItem } from './treeProvider';

export function registerBranchViews(
  context: vscode.ExtensionContext,
  provider: BranchTreeProvider
): void {
  const treeViews = [
    createBranchTreeView('gitBranchesPanel', provider),
    createBranchTreeView('gitBranchesSCM', provider),
  ] as const;
  const selectionSubscriptions = treeViews.map((treeView) =>
    treeView.onDidChangeSelection(({ selection }) => {
      void updateSelectedItemPinnedContext(selection[0]);
    })
  );

  updateTreeViewMessages(treeViews, provider);
  void updateSelectedItemPinnedContext(undefined);

  context.subscriptions.push(
    ...treeViews,
    ...selectionSubscriptions,
    provider.onDidChangeTreeData(() => {
      updateTreeViewMessages(treeViews, provider);
    })
  );
}

function createBranchTreeView(
  viewId: string,
  provider: BranchTreeProvider
): vscode.TreeView<BranchTreeItem> {
  return vscode.window.createTreeView(viewId, {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
}

function updateTreeViewMessages(
  treeViews: readonly vscode.TreeView<BranchTreeItem>[],
  provider: BranchTreeProvider
): void {
  const configuration = vscode.workspace.getConfiguration('gitBranchesPanel');
  const showCurrentBranchInfo = configuration.get<boolean>('showCurrentBranchInfo', false);
  const message = buildCurrentBranchMessage(
    provider.getCurrentBranch(),
    showCurrentBranchInfo
  );

  for (const treeView of treeViews) {
    treeView.message = message;
  }
}
