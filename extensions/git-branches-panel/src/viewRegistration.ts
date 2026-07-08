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
  provider.registerTreeViews(treeViews.map(({ treeView }) => treeView));
  const selectionSubscriptions = treeViews.map(({ viewId, treeView }) =>
    treeView.onDidChangeSelection(({ selection }) => {
      void updateSelectedItemPinnedContext(viewId, selection[0]);
      void provider.setActiveRepositoryFromItem(selection[0]);
    })
  );

  updateTreeViewMessages(treeViews.map(({ treeView }) => treeView), provider);
  void syncSelectedItemPinnedContexts(treeViews);
  void provider.syncActiveRepositoryToEditorIfEnabled();

  context.subscriptions.push(
    ...treeViews.map(({ treeView }) => treeView),
    ...selectionSubscriptions,
    vscode.window.onDidChangeActiveTextEditor(() => {
      void provider.syncActiveRepositoryToEditorIfEnabled();
    }),
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
    showCurrentBranchInfo,
    provider.getActiveRepositoryLabel()
  );
  const filterSummary = provider.getFilterSummary();
  const treeMessage = [
    message,
    filterSummary,
    provider.hasActiveFilter() && !provider.hasVisibleResults()
      ? 'No refs match the current filter.'
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  for (const treeView of treeViews) {
    treeView.message = treeMessage;
  }
}
