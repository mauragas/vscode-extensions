import * as vscode from 'vscode';

import {
  buildBranchDescription,
  buildBranchTree,
  findFolderNode,
  formatSyncStatus,
  sortBranches,
  type BranchInfo,
  type BranchSortOrder,
  type BranchTreeNode,
  type TreeBranch,
} from './branchModel';
import { fetchRemoteState, getBranches, getRepoRoot } from './git';

export type NodeType = 'folder' | 'branch' | 'currentBranch';
const REMOTE_FETCH_INTERVAL_MS = 30_000;

export class BranchTreeItem extends vscode.TreeItem {
  public readonly nodeType: NodeType;
  public readonly branchName?: string;
  public readonly branchInfo?: BranchInfo;
  public readonly folderPath?: string;
  public readonly repoRoot?: string;

  constructor(node: BranchTreeNode, repoRoot?: string) {
    if (node.kind === 'folder') {
      super(node.label, vscode.TreeItemCollapsibleState.Expanded);
      this.nodeType = 'folder';
      this.folderPath = node.path;
      this.id = `folder:${node.path}`;
      this.iconPath = new vscode.ThemeIcon('folder');
      this.contextValue = 'folder';
      return;
    }

    const isCurrentBranch = node.info.isCurrent;
    super(isCurrentBranch ? `● ${node.label}` : node.label, vscode.TreeItemCollapsibleState.None);

    this.nodeType = isCurrentBranch ? 'currentBranch' : 'branch';
    this.branchName = node.fullName;
    this.branchInfo = node.info;
    this.repoRoot = repoRoot;
    this.id = `branch:${node.fullName}`;
    this.contextValue = this.nodeType;
    this.description = buildBranchDescription(node.info);
    this.tooltip = createBranchTooltip(node);

    if (isCurrentBranch) {
      this.iconPath = new vscode.ThemeIcon(
        'git-branch',
        new vscode.ThemeColor('gitDecoration.addedResourceForeground')
      );
    } else {
      this.iconPath = new vscode.ThemeIcon('git-branch');
      this.command = {
        command: 'gitBranchesPanel.activateBranchItem',
        title: 'Activate Branch Item',
        arguments: [this],
      };
    }
  }
}

export class BranchTreeProvider implements vscode.TreeDataProvider<BranchTreeItem> {
  private readonly onDidChangeTreeDataEmitter =
    new vscode.EventEmitter<BranchTreeItem | undefined | null | void>();

  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private treeData: BranchTreeNode[] = [];
  private branches: BranchInfo[] = [];
  private repoRoot: string | null = null;
  private lastRemoteFetchAt = 0;
  private readonly statusBarItem: vscode.StatusBarItem;

  constructor(context: vscode.ExtensionContext) {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBarItem.command = 'gitBranchesPanel.refresh';
    context.subscriptions.push(this.statusBarItem);
  }

  async refresh(options: { fetchRemoteState?: boolean } = {}): Promise<void> {
    await this.loadBranches(options);
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(element: BranchTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: BranchTreeItem): Promise<BranchTreeItem[]> {
    if (!element) {
      if (this.treeData.length === 0) {
        await this.loadBranches({ fetchRemoteState: true });
      }

      return this.nodesToItems(this.treeData);
    }

    if (element.nodeType !== 'folder' || !element.folderPath) {
      return [];
    }

    const folder = findFolderNode(this.treeData, element.folderPath);
    return folder ? this.nodesToItems(folder.children) : [];
  }

  getRepoRoot(): string | null {
    return this.repoRoot;
  }

  getCurrentBranch(): BranchInfo | undefined {
    return this.branches.find((branch) => branch.isCurrent);
  }

  private async loadBranches(options: { fetchRemoteState?: boolean } = {}): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      this.repoRoot = null;
      this.branches = [];
      this.treeData = [];
      this.statusBarItem.hide();
      return;
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    this.repoRoot = await getRepoRoot(workspaceRoot);

    if (!this.repoRoot) {
      this.branches = [];
      this.treeData = [];
      this.statusBarItem.hide();
      return;
    }

    if (options.fetchRemoteState ?? true) {
      await this.maybeRefreshRemoteState(this.repoRoot);
    }

    const configuration = vscode.workspace.getConfiguration('gitBranchesPanel');
    const groupByFolder = configuration.get<boolean>('groupByFolder', true);
    const sortOrder = configuration.get<BranchSortOrder>('sortOrder', 'alphabetical');
    const branches = sortBranches(await getBranches(this.repoRoot), sortOrder);

    this.branches = branches;
    this.treeData = buildBranchTree(branches, groupByFolder);
    this.updateStatusBar(branches.find((branch) => branch.isCurrent));
  }

  private nodesToItems(nodes: readonly BranchTreeNode[]): BranchTreeItem[] {
    return nodes.map((node) => new BranchTreeItem(node, this.repoRoot ?? undefined));
  }

  private async maybeRefreshRemoteState(repoRoot: string): Promise<void> {
    if (Date.now() - this.lastRemoteFetchAt < REMOTE_FETCH_INTERVAL_MS) {
      return;
    }

    try {
      await fetchRemoteState(repoRoot);
      this.lastRemoteFetchAt = Date.now();
    } catch (error) {
      console.warn(`Git Branches Panel: failed to refresh remote state: ${getErrorMessage(error)}`);
    }
  }

  private updateStatusBar(currentBranch: BranchInfo | undefined): void {
    if (!currentBranch) {
      this.statusBarItem.hide();
      return;
    }

    const syncStatus = formatSyncStatus(currentBranch);
    this.statusBarItem.text = syncStatus
      ? `$(git-branch) ${currentBranch.name} ${syncStatus}`
      : `$(git-branch) ${currentBranch.name}`;
    this.statusBarItem.command = 'gitBranchesPanel.syncCurrentBranch';
    this.statusBarItem.tooltip = buildStatusBarTooltip(currentBranch);
    this.statusBarItem.show();
  }
}

function createBranchTooltip(node: TreeBranch): vscode.MarkdownString {
  const tooltipLines = [`**${node.fullName}**`];

  if (node.info.isCurrent) {
    tooltipLines.push('', '_Current branch_');
  }

  if (node.info.lastCommitDate) {
    tooltipLines.push('', `Last commit: ${node.info.lastCommitDate}`);
  }

  if (node.info.upstreamName) {
    tooltipLines.push('', `Upstream: ${node.info.upstreamName}`);
  } else {
    tooltipLines.push('', '_No upstream configured yet_');
  }

  if (node.info.upstreamMissing) {
    tooltipLines.push('', '_Tracked upstream no longer exists_');
  } else {
    const syncStatus = formatSyncStatus(node.info);
    tooltipLines.push('', syncStatus ? `Sync state: ${syncStatus}` : 'Sync state: up to date');
  }

  if (node.info.lastCommit) {
    tooltipLines.push('', `> ${node.info.lastCommit}`);
  }

  return new vscode.MarkdownString(tooltipLines.join('\n'));
}

function buildStatusBarTooltip(branch: BranchInfo): vscode.MarkdownString {
  const tooltipLines = [`**Current branch:** ${branch.name}`];
  const syncStatus = formatSyncStatus(branch);

  if (branch.upstreamName) {
    tooltipLines.push('', `Upstream: ${branch.upstreamName}`);
  }

  if (branch.upstreamMissing) {
    tooltipLines.push('', '_Tracked upstream no longer exists_');
  } else if (syncStatus) {
    tooltipLines.push('', `Sync state: ${syncStatus}`);
  } else {
    tooltipLines.push('', 'Sync state: up to date');
  }

  tooltipLines.push('', 'Click to sync the current branch with its remote.');

  return new vscode.MarkdownString(tooltipLines.join('\n'));
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error';
}
