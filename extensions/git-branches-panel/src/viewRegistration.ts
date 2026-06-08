import * as vscode from 'vscode';

import { buildCurrentBranchMessage } from './extensionHelpers';
import {
  syncSelectedItemPinnedContexts,
  type BranchViewId,
  updateSelectedItemPinnedContext,
} from './pinContext';
import { BranchTreeProvider, BranchTreeItem } from './treeProvider';

interface RegisteredBranchView {
  readonly viewId: BranchViewId;
  readonly treeView: vscode.TreeView<BranchTreeItem>;
}

export function registerBranchViews(
  context: vscode.ExtensionContext,
  provider: BranchTreeProvider
): void {
  const treeViews = [
    createBranchTreeView('gitBranchesPanel', provider),
    createBranchTreeView('gitBranchesSCM', provider),
  ] as const;
  const selectionSubscriptions = treeViews.map(({ viewId, treeView }) =>
    treeView.onDidChangeSelection(({ selection }) => {
      void updateSelectedItemPinnedContext(viewId, selection[0]);
    })
  );

  updateTreeViewMessages(treeViews.map(({ treeView }) => treeView), provider);
  void syncSelectedItemPinnedContexts(treeViews);

  context.subscriptions.push(
    ...treeViews.map(({ treeView }) => treeView),
    ...selectionSubscriptions,
    provider.onDidChangeTreeData(() => {
      updateTreeViewMessages(treeViews.map(({ treeView }) => treeView), provider);
      void syncSelectedItemPinnedContexts(treeViews);
    })
  );
}

function createBranchTreeView(
  viewId: BranchViewId,
  provider: BranchTreeProvider
): RegisteredBranchView {
  return {
    viewId,
    treeView: vscode.window.createTreeView(viewId, {
      treeDataProvider: provider,
      showCollapseAll: true,
    }),
  };
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
