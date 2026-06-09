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
import { getWorkspaceRepositories, resolveRepoRootForUri, type RepositoryDescriptor } from './gitApi';
import {
  fetchRemoteState,
  getBranches,
  getHooks,
  getRemoteBranches,
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
  type MultiRepositoryMode,
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
  private activeRepoRoot?: string;

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
    await this.ensureActiveRepoRoot();
    this.updateRepositoryContexts();
    this.updateCurrentBranchContext(this.getCurrentBranch());
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(element: BranchTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: BranchTreeItem): Promise<BranchTreeItem[]> {
    if (!element) {
      if (this.getVisibleTreeData().length === 0) {
        await this.refresh({ sections: ['local', 'hooks'], fetchRemoteState: false });
      }

      return this.nodesToItems(this.getVisibleTreeData());
    }

    const containerKey = element.containerKey ?? element.containerPath;
    if (
      (element.nodeType !== 'repository' && element.nodeType !== 'folder' && element.nodeType !== 'section') ||
      !containerKey
    ) {
      return [];
    }

    if (element.nodeType === 'section') {
      const section = getBranchSectionKey(element.containerPath ?? containerKey);

      if (section && element.repoRoot && !this.dataLoader.isSectionLoaded(section, element.repoRoot)) {
        await this.refresh({
          sections: [section],
          repoRoots: [element.repoRoot],
          fetchRemoteState: false,
        });
      }
    }

    const container = findContainerNode(this.getVisibleTreeData(), containerKey);
    return container ? this.nodesToItems(container.children) : [];
  }

  getRepoRoot(): string | null {
    return this.activeRepoRoot ?? this.dataLoader.getRepoRoot();
  }

  getRepositoryDescriptors(): readonly RepositoryDescriptor[] {
    return this.dataLoader.getRepositoryDescriptors();
  }

  getActiveRepositoryLabel(): string | undefined {
    const activeRepoRoot = this.getRepoRoot();
    return this.getRepositoryDescriptors().find((repository) => repository.repoRoot === activeRepoRoot)?.label;
  }

  getCurrentBranch(repoRoot?: string): BranchInfo | undefined {
    return this.dataLoader.getCurrentBranch(repoRoot ?? this.getRepoRoot() ?? undefined);
  }

  getDescendantBranches(containerKey: string): readonly TreeBranch[] {
    return findDescendantBranches(this.getVisibleTreeData(), containerKey);
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
    await this.refresh({
      sections: ['local'],
      repoRoots: [repoRoot],
      fetchRemoteState: false,
      onlyIfLoaded: true,
    });

    try {
      return await operation();
    } finally {
      this.busyBranchKeys.delete(busyBranchKey);
      await this.refresh({
        sections: ['local'],
        repoRoots: [repoRoot],
        fetchRemoteState: false,
        onlyIfLoaded: true,
      });
    }
  }

  async togglePinnedItem(item: BranchTreeItem): Promise<boolean> {
    if (!item.repoRoot || !item.branchInfo) {
      return false;
    }

    const nextPinned = await this.pinnedItems.toggle(item.repoRoot, item.branchInfo);
    await this.refresh({
      sections: [resolveSectionKey(item.branchInfo)],
      repoRoots: [item.repoRoot],
      fetchRemoteState: false,
      onlyIfLoaded: true,
    });
    return nextPinned;
  }

  async setActiveRepository(repoRoot: string | undefined): Promise<boolean> {
    if (!repoRoot || !this.dataLoader.hasRepository(repoRoot)) {
      return false;
    }

    if (this.activeRepoRoot === repoRoot) {
      return true;
    }

    this.activeRepoRoot = repoRoot;
    this.updateCurrentBranchContext(this.getCurrentBranch());
    this.onDidChangeTreeDataEmitter.fire();
    return true;
  }

  async setActiveRepositoryFromItem(item: BranchTreeItem | undefined): Promise<void> {
    if (!item?.repoRoot) {
      return;
    }

    await this.setActiveRepository(item.repoRoot);
  }

  async focusRepositoryForUri(uri: vscode.Uri | undefined): Promise<boolean> {
    const repoRoot = await resolveRepoRootForUri(uri);
    if (!repoRoot) {
      return false;
    }

    return this.setActiveRepository(repoRoot);
  }

  async syncActiveRepositoryToEditorIfEnabled(): Promise<void> {
    if (!shouldFollowActiveEditor()) {
      return;
    }

    const focused = await this.focusRepositoryForUri(vscode.window.activeTextEditor?.document.uri);
    if (!focused) {
      await this.ensureActiveRepoRoot();
    }
  }

  private getVisibleTreeData(): readonly BranchTreeNode[] {
    return this.dataLoader.getTreeData({
      activeRepoRoot: this.activeRepoRoot,
      multiRepositoryMode: getMultiRepositoryMode(),
    });
  }

  private nodesToItems(nodes: readonly BranchTreeNode[]): BranchTreeItem[] {
    return nodes.map((node) => new BranchTreeItem(node));
  }

  private async ensureActiveRepoRoot(): Promise<void> {
    const repoRoots = this.dataLoader.getRepoRoots();
    if (repoRoots.length === 0) {
      this.activeRepoRoot = undefined;
      return;
    }

    if (shouldFollowActiveEditor()) {
      const activeEditorRepoRoot = await resolveRepoRootForUri(vscode.window.activeTextEditor?.document.uri);
      if (activeEditorRepoRoot && this.dataLoader.hasRepository(activeEditorRepoRoot)) {
        this.activeRepoRoot = activeEditorRepoRoot;
        return;
      }
    }

    if (this.activeRepoRoot && this.dataLoader.hasRepository(this.activeRepoRoot)) {
      return;
    }

    this.activeRepoRoot = repoRoots[0];
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

  private updateRepositoryContexts(): void {
    const repoCount = this.dataLoader.getRepoRoots().length;
    const multiRepositoryMode = getMultiRepositoryMode();
    const groupedRepositories =
      multiRepositoryMode === 'alwaysGroupByRepository' ||
      (multiRepositoryMode === 'auto' && repoCount > 1);

    void vscode.commands.executeCommand(
      'setContext',
      'gitBranchesPanel.multipleRepositories',
      repoCount > 1
    );
    void vscode.commands.executeCommand(
      'setContext',
      'gitBranchesPanel.groupedRepositories',
      groupedRepositories
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
    getWorkspaceRepositories,
    getConfiguration: () => {
      const configuration = vscode.workspace.getConfiguration('gitBranchesPanel');

      return {
        groupByFolder: configuration.get<boolean>('groupByFolder', true),
        sortOrder: configuration.get<BranchSortOrder>('sortOrder', 'alphabetical'),
        tagSortOrder: configuration.get<TagSortOrder>('tagSortOrder', 'versionDescending'),
        multiRepositoryMode: configuration.get<MultiRepositoryMode>(
          'multiRepository.mode',
          'auto'
        ),
      };
    },
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

function getMultiRepositoryMode(): MultiRepositoryMode {
  return vscode.workspace
    .getConfiguration('gitBranchesPanel')
    .get<MultiRepositoryMode>('multiRepository.mode', 'auto');
}

function shouldFollowActiveEditor(): boolean {
  return vscode.workspace
    .getConfiguration('gitBranchesPanel')
    .get<boolean>('multiRepository.followActiveEditor', false);
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
