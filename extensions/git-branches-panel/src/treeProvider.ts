import * as vscode from 'vscode';

import { type BranchInfo, type BranchSortOrder, type BranchTreeNode } from './branchModel';
import {
  fetchRemoteState,
  getBranches,
  getRemoteBranches,
  getRepoRoot,
  getStashes,
  getTags,
  getWorktrees,
} from './git';
import { BranchDataLoader, type BranchDataLoaderDependencies, type BranchLoadOptions } from './treeDataLoader';
import { BranchTreeItem } from './treeItem';
import { buildStatusBarText, buildStatusBarTooltipContent, findContainerNode } from './treePresentation';

export { BranchTreeItem, type NodeType } from './treeItem';
export type { BranchLoadOptions } from './treeDataLoader';

export class BranchTreeProvider implements vscode.TreeDataProvider<BranchTreeItem> {
  private readonly onDidChangeTreeDataEmitter =
    new vscode.EventEmitter<BranchTreeItem | undefined | null | void>();

  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private readonly dataLoader: BranchDataLoader;
  private readonly statusBarItem: vscode.StatusBarItem;

  constructor(
    context: vscode.ExtensionContext,
    dataLoader: BranchDataLoader = createBranchDataLoader()
  ) {
    this.dataLoader = dataLoader;
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBarItem.command = 'gitBranchesPanel.refresh';
    context.subscriptions.push(this.statusBarItem);
  }

  async refresh(options: BranchLoadOptions = {}): Promise<void> {
    await this.dataLoader.refresh(options);
    this.updateStatusBar(this.dataLoader.getCurrentBranch());
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(element: BranchTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: BranchTreeItem): Promise<BranchTreeItem[]> {
    if (!element) {
      if (this.dataLoader.getTreeData().length === 0) {
        await this.refresh({ fetchRemoteState: true });
      }

      return this.nodesToItems(this.dataLoader.getTreeData());
    }

    if ((element.nodeType !== 'folder' && element.nodeType !== 'section') || !element.containerPath) {
      return [];
    }

    const container = findContainerNode(this.dataLoader.getTreeData(), element.containerPath);
    return container ? this.nodesToItems(container.children) : [];
  }

  getRepoRoot(): string | null {
    return this.dataLoader.getRepoRoot();
  }

  getCurrentBranch(): BranchInfo | undefined {
    return this.dataLoader.getCurrentBranch();
  }

  private nodesToItems(nodes: readonly BranchTreeNode[]): BranchTreeItem[] {
    return nodes.map((node) => new BranchTreeItem(node, this.dataLoader.getRepoRoot() ?? undefined));
  }

  private updateStatusBar(currentBranch: BranchInfo | undefined): void {
    const statusBarText = buildStatusBarText(currentBranch);
    if (!currentBranch || !statusBarText) {
      this.statusBarItem.hide();
      return;
    }

    this.statusBarItem.text = statusBarText;
    this.statusBarItem.command = 'gitBranchesPanel.syncCurrentBranch';
    this.statusBarItem.tooltip = new vscode.MarkdownString(
      buildStatusBarTooltipContent(currentBranch)
    );
    this.statusBarItem.show();
  }
}

function createBranchDataLoader(): BranchDataLoader {
  return new BranchDataLoader(createBranchDataLoaderDependencies());
}

function createBranchDataLoaderDependencies(): BranchDataLoaderDependencies {
  return {
    getWorkspaceFolderPaths: () =>
      vscode.workspace.workspaceFolders?.map((workspaceFolder) => workspaceFolder.uri.fsPath) ?? [],
    getConfiguration: () => {
      const configuration = vscode.workspace.getConfiguration('gitBranchesPanel');

      return {
        groupByFolder: configuration.get<boolean>('groupByFolder', true),
        sortOrder: configuration.get<BranchSortOrder>('sortOrder', 'alphabetical'),
      };
    },
    getRepoRoot,
    getBranches,
    getRemoteBranches,
    getStashes,
    getWorktrees,
    getTags,
    fetchRemoteState,
    warn: (message) => {
      console.warn(message);
    },
  };
}
