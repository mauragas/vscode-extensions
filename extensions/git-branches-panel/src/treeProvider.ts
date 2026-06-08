import * as vscode from 'vscode';

import {
  type BranchInfo,
  type BranchSortOrder,
  type TagSortOrder,
  type BranchTreeNode,
  isPublishableBranch,
  type TreeBranch,
} from './branchModel';
import {
  DEFAULT_PROTECTED_BRANCH_NAMES,
  isBranchProtectedFromDeletion,
  normalizeConfiguredBranchNames,
} from './branchRules';
import {
  fetchRemoteState,
  getBranches,
  getHooks,
  getRemoteBranches,
  getRepoRoot,
  getStashes,
  getTags,
  getWorktrees,
} from './git';
import {
  BranchDataLoader,
  getBranchSectionKey,
  type BranchDataLoaderDependencies,
  type BranchLoadOptions,
  type BranchSectionKey,
} from './treeDataLoader';
import { BranchTreeItem } from './treeItem';
import { buildPinnedItemKey, PinnedItemsStore } from './pinnedItems';
import {
  findContainerNode,
  findDescendantBranches,
} from './treePresentation';

export { BranchTreeItem, type NodeType } from './treeItem';
export type { BranchLoadOptions } from './treeDataLoader';

export class BranchTreeProvider implements vscode.TreeDataProvider<BranchTreeItem> {
  private readonly onDidChangeTreeDataEmitter =
    new vscode.EventEmitter<BranchTreeItem | undefined | null | void>();

  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private readonly dataLoader: BranchDataLoader;
  private readonly pinnedItems: PinnedItemsStore;
  private readonly busyBranchKeys = new Set<string>();

  constructor(
    context: vscode.ExtensionContext,
    dataLoader?: BranchDataLoader
  ) {
    this.pinnedItems = new PinnedItemsStore(context.workspaceState);
    this.dataLoader =
      dataLoader ?? createBranchDataLoader((repoRoot, branch) => this.decorateBranchInfo(repoRoot, branch));
  }

  async refresh(options: BranchLoadOptions = {}): Promise<void> {
    await this.dataLoader.refresh(options);
    this.updateCurrentBranchContext(this.dataLoader.getCurrentBranch());
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(element: BranchTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: BranchTreeItem): Promise<BranchTreeItem[]> {
    if (!element) {
      if (this.dataLoader.getTreeData().length === 0 || !this.dataLoader.isSectionLoaded('local')) {
        await this.refresh({ sections: ['local', 'hooks'], fetchRemoteState: false });
      }

      return this.nodesToItems(this.dataLoader.getTreeData());
    }

    const containerKey = element.containerKey ?? element.containerPath;

    if ((element.nodeType !== 'folder' && element.nodeType !== 'section') || !containerKey) {
      return [];
    }

    if (element.nodeType === 'section') {
      const section = getBranchSectionKey(element.containerPath ?? containerKey);

      if (section && !this.dataLoader.isSectionLoaded(section)) {
        await this.refresh({ sections: [section], fetchRemoteState: false });
      }
    }

    const container = findContainerNode(this.dataLoader.getTreeData(), containerKey);
    return container ? this.nodesToItems(container.children) : [];
  }

  getRepoRoot(): string | null {
    return this.dataLoader.getRepoRoot();
  }

  getCurrentBranch(): BranchInfo | undefined {
    return this.dataLoader.getCurrentBranch();
  }

  getDescendantBranches(containerKey: string): readonly TreeBranch[] {
    return findDescendantBranches(this.dataLoader.getTreeData(), containerKey);
  }

  async withBusyBranch<T>(
    repoRoot: string,
    branchName: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const busyBranchKey = buildPinnedItemKey(repoRoot, {
      name: branchName,
      scope: 'local',
    });

    this.busyBranchKeys.add(busyBranchKey);
    await this.refresh({ sections: ['local'], fetchRemoteState: false, onlyIfLoaded: true });

    try {
      return await operation();
    } finally {
      this.busyBranchKeys.delete(busyBranchKey);
      await this.refresh({ sections: ['local'], fetchRemoteState: false, onlyIfLoaded: true });
    }
  }

  async togglePinnedItem(item: BranchTreeItem): Promise<boolean> {
    if (!item.repoRoot || !item.branchInfo) {
      return false;
    }

    const nextPinned = await this.pinnedItems.toggle(item.repoRoot, item.branchInfo);
    await this.refresh({
      sections: [resolveSectionKey(item.branchInfo)],
      fetchRemoteState: false,
      onlyIfLoaded: true,
    });
    return nextPinned;
  }

  private nodesToItems(nodes: readonly BranchTreeNode[]): BranchTreeItem[] {
    return nodes.map((node) => new BranchTreeItem(node, this.dataLoader.getRepoRoot() ?? undefined));
  }

  private updateCurrentBranchContext(currentBranch: BranchInfo | undefined): void {
    const currentBranchNeedsPublish = Boolean(currentBranch && isPublishableBranch(currentBranch));
    const currentBranchBusy = Boolean(currentBranch?.isSyncing);
    void vscode.commands.executeCommand(
      'setContext',
      'gitBranchesPanel.currentBranchNeedsPublish',
      currentBranchNeedsPublish
    );
    void vscode.commands.executeCommand(
      'setContext',
      'gitBranchesPanel.currentBranchBusy',
      currentBranchBusy
    );
  }

  private decorateBranchInfo(repoRoot: string, branch: BranchInfo): BranchInfo {
    return {
      ...branch,
      isPinned: this.pinnedItems.isPinned(repoRoot, branch),
      isSyncing: this.busyBranchKeys.has(buildPinnedItemKey(repoRoot, branch)),
      isDeletionProtected: isBranchProtectedFromDeletion(branch, getProtectedBranchNames()),
    };
  }
}

function createBranchDataLoader(
  decorateBranchInfo: NonNullable<BranchDataLoaderDependencies['decorateBranchInfo']>
): BranchDataLoader {
  return new BranchDataLoader(createBranchDataLoaderDependencies(decorateBranchInfo));
}

function createBranchDataLoaderDependencies(
  decorateBranchInfo: NonNullable<BranchDataLoaderDependencies['decorateBranchInfo']>
): BranchDataLoaderDependencies {
  return {
    getWorkspaceFolderPaths: () =>
      vscode.workspace.workspaceFolders?.map((workspaceFolder) => workspaceFolder.uri.fsPath) ?? [],
    getConfiguration: () => {
      const configuration = vscode.workspace.getConfiguration('gitBranchesPanel');

      return {
        groupByFolder: configuration.get<boolean>('groupByFolder', true),
        sortOrder: configuration.get<BranchSortOrder>('sortOrder', 'alphabetical'),
        tagSortOrder: configuration.get<TagSortOrder>('tagSortOrder', 'versionDescending'),
      };
    },
    getRepoRoot,
    getBranches,
    getRemoteBranches,
    getStashes,
    getWorktrees,
    getHooks,
    getTags,
    fetchRemoteState,
    decorateBranchInfo,
    warn: (message) => {
      console.warn(message);
    },
  };
}

function getProtectedBranchNames(): string[] {
  return normalizeConfiguredBranchNames(
    vscode.workspace
      .getConfiguration('gitBranchesPanel')
      .get<string[]>('protectedBranchNames', [...DEFAULT_PROTECTED_BRANCH_NAMES])
  );
}

function resolveSectionKey(branch: Pick<BranchInfo, 'scope'>): BranchSectionKey {
  switch (branch.scope) {
    case 'remote':
      return 'remote';
    case 'stash':
      return 'stash';
    case 'worktree':
      return 'worktree';
    case 'hook':
      return 'hooks';
    case 'tag':
      return 'tags';
    default:
      return 'local';
  }
}
