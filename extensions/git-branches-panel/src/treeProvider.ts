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
  getRemoteDetails,
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
import { BranchTreeItem, type NodeType } from './treeItem';
import { buildPinnedItemKey, PinnedItemsStore } from './pinnedItems';
import {
  findContainerNode,
  findDescendantBranches,
} from './treePresentation';
import {
  buildFilterSummary,
  clearRefFilterState,
  createNeedsAttentionFilterState,
  createRefFilterState,
  filterTreeNodes,
  hasActiveFilter,
  type RefFilterState,
} from './search/refSearch';
import { getSectionVisibilityConfiguration } from './sectionVisibility';

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
  private filterState: RefFilterState = clearRefFilterState();
  private treeViews: readonly vscode.TreeView<BranchTreeItem>[] = [];

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
    this.updateFilterContexts();
    this.updateCurrentBranchContext(this.getCurrentBranch());
    this.onDidChangeTreeDataEmitter.fire();
  }

  getTreeItem(element: BranchTreeItem): vscode.TreeItem {
    return element;
  }

  getParent(element: BranchTreeItem): BranchTreeItem | undefined {
    const parentNode = findParentTreeNode(this.getVisibleTreeData(), element);
    return parentNode ? new BranchTreeItem(parentNode) : undefined;
  }

  async getChildren(element?: BranchTreeItem): Promise<BranchTreeItem[]> {
    if (!element) {
      if (this.getBaseVisibleTreeData().length === 0) {
        await this.refresh({ fetchRemoteState: false });
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

  getVisibleRepoRoots(): readonly string[] {
    const allRepoRoots = this.dataLoader.getRepoRoots();
    if (getMultiRepositoryMode() === 'singleActiveRepository') {
      const activeRepoRoot = this.getRepoRoot();
      return activeRepoRoot ? [activeRepoRoot] : allRepoRoots.slice(0, 1);
    }

    return allRepoRoots;
  }

  getActiveRepositoryLabel(): string | undefined {
    const activeRepoRoot = this.getRepoRoot();
    return this.getRepositoryDescriptors().find((repository) => repository.repoRoot === activeRepoRoot)?.label;
  }

  getCurrentBranch(repoRoot?: string): BranchInfo | undefined {
    return this.dataLoader.getCurrentBranch(repoRoot ?? this.getRepoRoot() ?? undefined);
  }

  getFilterSummary(): string {
    return buildFilterSummary(this.filterState);
  }

  getFilterQuery(): string {
    return this.filterState.rawQuery;
  }

  hasActiveFilter(): boolean {
    return hasActiveFilter(this.filterState);
  }

  hasVisibleResults(): boolean {
    return this.getVisibleTreeData().length > 0;
  }

  getSearchTreeData(): readonly BranchTreeNode[] {
    const repoRoots = this.dataLoader.getRepoRoots();
    return this.dataLoader.getTreeData({
      activeRepoRoot: this.activeRepoRoot,
      multiRepositoryMode: repoRoots.length > 1 ? 'alwaysGroupByRepository' : getMultiRepositoryMode(),
    });
  }

  async setFilterQuery(query: string): Promise<void> {
    this.filterState = createRefFilterState(query, {
      showOnlyPinned: this.filterState.showOnlyPinned,
    });
    this.updateFilterContexts();
    this.onDidChangeTreeDataEmitter.fire();
  }

  async clearFilter(): Promise<void> {
    if (!this.hasActiveFilter()) {
      return;
    }

    this.filterState = clearRefFilterState();
    this.updateFilterContexts();
    this.onDidChangeTreeDataEmitter.fire();
  }

  async toggleShowOnlyPinned(): Promise<boolean> {
    this.filterState = {
      ...this.filterState,
      showOnlyPinned: !this.filterState.showOnlyPinned,
    };
    this.updateFilterContexts();
    this.onDidChangeTreeDataEmitter.fire();
    return this.filterState.showOnlyPinned;
  }

  async showNeedsAttention(): Promise<void> {
    this.filterState = createNeedsAttentionFilterState();
    this.updateFilterContexts();
    this.onDidChangeTreeDataEmitter.fire();
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

  registerTreeViews(treeViews: readonly vscode.TreeView<BranchTreeItem>[]): void {
    this.treeViews = treeViews;
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

  async revealItem(item: BranchTreeItem, options: { clearFilter?: boolean } = {}): Promise<boolean> {
    const primaryTreeView = this.treeViews[0];
    if (!primaryTreeView) {
      return false;
    }

    if (options.clearFilter ?? false) {
      await this.clearFilter();
    }

    await this.setActiveRepositoryFromItem(item);
    const revealTarget = findMatchingTreeItem(this.getVisibleTreeData(), item) ?? item;

    await primaryTreeView.reveal(revealTarget, {
      expand: 3,
      focus: true,
      select: true,
    });
    return true;
  }

  async revealBranch(
    repoRoot: string,
    branchName: string,
    options: { clearFilter?: boolean } = {}
  ): Promise<boolean> {
    const primaryTreeView = this.treeViews[0];
    if (!primaryTreeView) {
      return false;
    }

    const activated = await this.setActiveRepository(repoRoot);
    if (!activated) {
      return false;
    }

    let revealTarget = findLocalBranchTreeItem(this.getVisibleTreeData(), repoRoot, branchName);

    if (!revealTarget && options.clearFilter === true && this.hasActiveFilter()) {
      await this.clearFilter();
      revealTarget = findLocalBranchTreeItem(this.getVisibleTreeData(), repoRoot, branchName);
    }

    if (!revealTarget) {
      return false;
    }

    await primaryTreeView.reveal(revealTarget, {
      expand: 3,
      focus: true,
      select: true,
    });
    return true;
  }

  private getBaseVisibleTreeData(): readonly BranchTreeNode[] {
    return this.dataLoader.getTreeData({
      activeRepoRoot: this.activeRepoRoot,
      multiRepositoryMode: getMultiRepositoryMode(),
    });
  }

  private getVisibleTreeData(): readonly BranchTreeNode[] {
    const baseTreeData = this.getBaseVisibleTreeData();

    return hasActiveFilter(this.filterState)
      ? filterTreeNodes(baseTreeData, this.filterState)
      : baseTreeData;
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

  private updateFilterContexts(): void {
    void vscode.commands.executeCommand(
      'setContext',
      'gitBranchesPanel.filterActive',
      this.hasActiveFilter()
    );
    void vscode.commands.executeCommand(
      'setContext',
      'gitBranchesPanel.filterShowOnlyPinned',
      this.filterState.showOnlyPinned
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

type TreeContainerNode = Extract<BranchTreeNode, { kind: 'repository' | 'section' | 'folder' }>;
type TreeBranchNode = Extract<BranchTreeNode, { kind: 'branch' }>;

function findMatchingTreeItem(
  nodes: readonly BranchTreeNode[],
  item: BranchTreeItem
): BranchTreeItem | undefined {
  const node = findMatchingTreeNode(nodes, item);
  return node ? new BranchTreeItem(node) : undefined;
}

function findLocalBranchTreeItem(
  nodes: readonly BranchTreeNode[],
  repoRoot: string,
  branchName: string
): BranchTreeItem | undefined {
  const node = findLocalBranchTreeNode(nodes, repoRoot, branchName);
  return node ? new BranchTreeItem(node) : undefined;
}

function findMatchingTreeNode(
  nodes: readonly BranchTreeNode[],
  item: BranchTreeItem
): BranchTreeNode | undefined {
  for (const node of nodes) {
    if (doesNodeMatchTreeItem(node, item)) {
      return node;
    }

    if (!isTreeContainerNode(node)) {
      continue;
    }

    const nestedMatch = findMatchingTreeNode(node.children, item);
    if (nestedMatch) {
      return nestedMatch;
    }
  }

  return undefined;
}

function findLocalBranchTreeNode(
  nodes: readonly BranchTreeNode[],
  repoRoot: string,
  branchName: string
): TreeBranchNode | undefined {
  for (const node of nodes) {
    if (node.kind === 'branch') {
      if (
        node.repoRoot === repoRoot &&
        node.fullName === branchName &&
        (node.info.scope ?? 'local') === 'local'
      ) {
        return node;
      }

      continue;
    }

    if (!isTreeContainerNode(node)) {
      continue;
    }

    const nestedMatch = findLocalBranchTreeNode(node.children, repoRoot, branchName);
    if (nestedMatch) {
      return nestedMatch;
    }
  }

  return undefined;
}

function findParentTreeNode(
  nodes: readonly BranchTreeNode[],
  item: BranchTreeItem,
  parent?: TreeContainerNode
): TreeContainerNode | undefined {
  for (const node of nodes) {
    if (doesNodeMatchTreeItem(node, item)) {
      return parent;
    }

    if (!isTreeContainerNode(node)) {
      continue;
    }

    const nestedParent = findParentTreeNode(node.children, item, node);
    if (nestedParent) {
      return nestedParent;
    }
  }

  return undefined;
}

function isTreeContainerNode(node: BranchTreeNode): node is TreeContainerNode {
  return node.kind === 'repository' || node.kind === 'section' || node.kind === 'folder';
}

function doesNodeMatchTreeItem(node: BranchTreeNode, item: BranchTreeItem): boolean {
  switch (node.kind) {
    case 'repository':
      return item.nodeType === 'repository' && item.repoRoot === node.repoRoot;
    case 'section':
      return (
        item.nodeType === 'section' &&
        item.repoRoot === node.repoRoot &&
        item.containerPath === node.path &&
        item.containerScope === node.scope
      );
    case 'folder':
      return (
        item.nodeType === 'folder' &&
        item.repoRoot === node.repoRoot &&
        item.containerPath === node.path &&
        item.containerScope === node.scope
      );
    case 'remote':
      return (
        item.nodeType === 'remoteConfig' &&
        item.repoRoot === node.repoRoot &&
        item.remoteInfo?.name === node.info.name
      );
    case 'branch':
      return (
        item.repoRoot === node.repoRoot &&
        item.branchName === node.fullName &&
        matchesBranchNodeType(item.nodeType, node.info)
      );
    default:
      return false;
  }
}

function matchesBranchNodeType(nodeType: NodeType, branch: BranchInfo): boolean {
  const scope = branch.scope ?? 'local';

  switch (scope) {
    case 'remote':
      return nodeType === (branch.remoteTrackingState === 'stale' ? 'staleRemoteBranch' : 'remoteBranch');
    case 'tag':
      return nodeType === 'tag';
    case 'stash':
      return nodeType === 'stash';
    case 'worktree':
      return nodeType === 'worktree';
    case 'hook':
      return nodeType === 'hook';
    default:
      if (branch.upstreamMissing) {
        return nodeType === 'missingUpstreamBranch';
      }

      return branch.isCurrent ? nodeType === 'currentBranch' : nodeType === 'branch';
  }
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
        sectionVisibility: getSectionVisibilityConfiguration(configuration),
      };
    },
    getBranches,
    getRemoteBranches,
    getRemoteDetails,
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
