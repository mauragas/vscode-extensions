import {
  buildBranchTree,
  buildRemoteTree,
  buildRepositoryNode,
  sortBranches,
  type BranchInfo,
  type BranchSortOrder,
  type TagSortOrder,
  type BranchTreeNode,
  type TreeChildNode,
  type TreeSection,
} from './branchModel';
import { formatErrorMessage } from './errorUtils';

export type BranchSectionKey = 'local' | 'remote' | 'remotes' | 'stash' | 'worktree' | 'hooks' | 'tags';
export type MultiRepositoryMode = 'auto' | 'alwaysGroupByRepository' | 'singleActiveRepository';

export interface RepositoryDescriptor {
  readonly repoRoot: string;
  readonly label: string;
  readonly description?: string;
}

export interface BranchLoadOptions {
  fetchRemoteState?: boolean;
  forceFetchRemoteState?: boolean;
  sections?: readonly BranchSectionKey[];
  repoRoots?: readonly string[];
  onlyIfLoaded?: boolean;
}

export interface BranchTreeDataOptions {
  activeRepoRoot?: string;
  multiRepositoryMode?: MultiRepositoryMode;
}

export interface BranchDataLoaderDependencies {
  getWorkspaceRepositories(): Promise<readonly RepositoryDescriptor[]>;
  getConfiguration(): {
    groupByFolder: boolean;
    sortOrder: BranchSortOrder;
    tagSortOrder: TagSortOrder;
    multiRepositoryMode: MultiRepositoryMode;
    showRemotesSection: boolean;
  };
  getBranches(repoRoot: string): Promise<BranchInfo[]>;
  getRemoteBranches(repoRoot: string): Promise<BranchInfo[]>;
  getRemoteDetails(repoRoot: string): Promise<readonly import('./branchModel').RemoteConfigInfo[]>;
  getStashes(repoRoot: string): Promise<BranchInfo[]>;
  getWorktrees(repoRoot: string): Promise<BranchInfo[]>;
  getHooks(repoRoot: string): Promise<BranchInfo[]>;
  getTags(repoRoot: string): Promise<BranchInfo[]>;
  fetchRemoteState(repoRoot: string): Promise<void>;
  decorateBranchInfo?(repoRoot: string, branch: BranchInfo): BranchInfo;
  warn(message: string): void;
}

export const REMOTE_FETCH_INTERVAL_MS = 30_000;

const DEFAULT_SECTIONS: readonly BranchSectionKey[] = ['local', 'hooks'];
const BRANCH_SECTION_ORDER: readonly BranchSectionKey[] = [
  'local',
  'remote',
  'remotes',
  'stash',
  'worktree',
  'hooks',
  'tags',
] as const;

const BRANCH_SECTION_LABELS: Record<BranchSectionKey, string> = {
  local: 'Local',
  remote: 'Remote',
  remotes: 'Remotes',
  stash: 'Stash',
  worktree: 'Worktree',
  hooks: 'Hooks',
  tags: 'Tags',
};

const BRANCH_SECTION_PATHS: Record<BranchSectionKey, string> = {
  local: 'section:local',
  remote: 'section:remote',
  remotes: 'section:remotes',
  stash: 'section:stash',
  worktree: 'section:worktree',
  hooks: 'section:hooks',
  tags: 'section:tags',
};

interface SectionState {
  loaded: boolean;
  children: TreeChildNode[];
}

interface LoaderConfiguration {
  groupByFolder: boolean;
  sortOrder: BranchSortOrder;
  tagSortOrder: TagSortOrder;
  multiRepositoryMode: MultiRepositoryMode;
  showRemotesSection: boolean;
}

interface RepositoryState {
  descriptor: RepositoryDescriptor;
  localBranches: BranchInfo[];
  lastRemoteFetchAt: number;
  sectionStates: Record<BranchSectionKey, SectionState>;
}

export function shouldRefreshRemoteState(
  lastRemoteFetchAt: number,
  now: number,
  force = false,
  intervalMs = REMOTE_FETCH_INTERVAL_MS
): boolean {
  return lastRemoteFetchAt === 0 || force || now - lastRemoteFetchAt >= intervalMs;
}

export function getBranchSectionKey(sectionPath: string): BranchSectionKey | undefined {
  return BRANCH_SECTION_ORDER.find((section) => BRANCH_SECTION_PATHS[section] === sectionPath);
}

export class BranchDataLoader {
  private repositoryOrder: string[] = [];
  private readonly repositoryStates = new Map<string, RepositoryState>();

  constructor(
    private readonly dependencies: BranchDataLoaderDependencies,
    private readonly now: () => number = () => Date.now()
  ) {}

  getTreeData(options: BranchTreeDataOptions = {}): readonly BranchTreeNode[] {
    const configuration = this.dependencies.getConfiguration();
    const repoRoots = this.getRepoRoots();
    if (repoRoots.length === 0) {
      return [];
    }

    const resolvedMode = options.multiRepositoryMode ?? configuration.multiRepositoryMode;
    const shouldGroupByRepository =
      resolvedMode === 'alwaysGroupByRepository' ||
      (resolvedMode === 'auto' && repoRoots.length > 1);

    if (resolvedMode === 'singleActiveRepository' || !shouldGroupByRepository) {
      const repoRoot = this.resolveSingleVisibleRepoRoot(options.activeRepoRoot);
      return repoRoot ? this.buildSectionNodes(repoRoot) : [];
    }

    return repoRoots
      .map((repoRoot) => this.buildRepositoryNode(repoRoot, options.activeRepoRoot))
      .filter((repository): repository is NonNullable<typeof repository> => Boolean(repository));
  }

  getRepoRoot(): string | null {
    const repoRoots = this.getRepoRoots();
    return repoRoots.length === 1 ? repoRoots[0] : null;
  }

  getRepoRoots(): readonly string[] {
    return [...this.repositoryOrder];
  }

  getRepositoryDescriptors(): readonly RepositoryDescriptor[] {
    return this.repositoryOrder
      .map((repoRoot) => this.repositoryStates.get(repoRoot)?.descriptor)
      .filter((descriptor): descriptor is RepositoryDescriptor => Boolean(descriptor));
  }

  hasRepository(repoRoot: string): boolean {
    return this.repositoryStates.has(repoRoot);
  }

  getCurrentBranch(repoRoot?: string): BranchInfo | undefined {
    const resolvedRepoRoot = repoRoot ?? this.getRepoRoot();
    if (!resolvedRepoRoot) {
      return undefined;
    }

    return this.repositoryStates.get(resolvedRepoRoot)?.localBranches.find((branch) => branch.isCurrent);
  }

  isSectionLoaded(section: BranchSectionKey, repoRoot?: string): boolean {
    if (repoRoot) {
      return this.repositoryStates.get(repoRoot)?.sectionStates[section].loaded ?? false;
    }

    const repoRoots = this.getRepoRoots();
    if (repoRoots.length === 0) {
      return false;
    }

    if (repoRoots.length === 1) {
      return this.repositoryStates.get(repoRoots[0])?.sectionStates[section].loaded ?? false;
    }

    return repoRoots.every(
      (currentRepoRoot) => this.repositoryStates.get(currentRepoRoot)?.sectionStates[section].loaded
    );
  }

  async refresh(options: BranchLoadOptions = {}): Promise<void> {
    const repositories = await this.dependencies.getWorkspaceRepositories();
    this.reconcileRepositories(repositories);

    if (this.repositoryOrder.length === 0) {
      this.clearData();
      return;
    }

    const configuration = this.dependencies.getConfiguration();
    const repoRoots = this.resolveRepoRoots(options.repoRoots);
    if (repoRoots.length === 0) {
      return;
    }

    if (options.fetchRemoteState ?? false) {
      await Promise.all(
        repoRoots.map(async (repoRoot) => {
          const repositoryState = this.repositoryStates.get(repoRoot);
          if (!repositoryState) {
            return;
          }

          await this.maybeRefreshRemoteState(
            repositoryState,
            options.forceFetchRemoteState ?? false
          );
        })
      );
    }

    await Promise.all(
      repoRoots.flatMap((repoRoot) => {
        const repositoryState = this.repositoryStates.get(repoRoot);
        if (!repositoryState) {
          return [];
        }

        const sections = this.resolveSections(
          repositoryState,
          options.sections,
          options.onlyIfLoaded ?? false
        );

        return sections.map((section) => this.loadSection(repositoryState, section, configuration));
      })
    );
  }

  private clearData(): void {
    this.repositoryOrder = [];
    this.repositoryStates.clear();
  }

  private reconcileRepositories(repositories: readonly RepositoryDescriptor[]): void {
    const nextRepositoryOrder: string[] = [];
    const nextRepositoryRoots = new Set(repositories.map((repository) => repository.repoRoot));

    for (const repository of repositories) {
      nextRepositoryOrder.push(repository.repoRoot);
      const existingState = this.repositoryStates.get(repository.repoRoot);

      if (existingState) {
        existingState.descriptor = repository;
        continue;
      }

      this.repositoryStates.set(repository.repoRoot, {
        descriptor: repository,
        localBranches: [],
        lastRemoteFetchAt: 0,
        sectionStates: createEmptySectionStates(),
      });
    }

    for (const repoRoot of this.repositoryStates.keys()) {
      if (!nextRepositoryRoots.has(repoRoot)) {
        this.repositoryStates.delete(repoRoot);
      }
    }

    this.repositoryOrder = nextRepositoryOrder;
  }

  private resolveRepoRoots(requestedRepoRoots: readonly string[] | undefined): string[] {
    if (!requestedRepoRoots || requestedRepoRoots.length === 0) {
      return [...this.repositoryOrder];
    }

    const requestedRepoRootSet = new Set(requestedRepoRoots);
    return this.repositoryOrder.filter((repoRoot) => requestedRepoRootSet.has(repoRoot));
  }

  private resolveSingleVisibleRepoRoot(activeRepoRoot: string | undefined): string | undefined {
    if (activeRepoRoot && this.repositoryStates.has(activeRepoRoot)) {
      return activeRepoRoot;
    }

    return this.repositoryOrder[0];
  }

  private resolveSections(
    repositoryState: RepositoryState,
    requestedSections: readonly BranchSectionKey[] | undefined,
    onlyIfLoaded: boolean
  ): BranchSectionKey[] {
    const loadedSections = this.getLoadedSections(repositoryState);
    const baseSections =
      requestedSections ??
      (loadedSections.length > 0 ? loadedSections : [...DEFAULT_SECTIONS]);
    const uniqueSections = [...new Set(baseSections)];

    return onlyIfLoaded
      ? uniqueSections.filter((section) => repositoryState.sectionStates[section].loaded)
      : uniqueSections;
  }

  private getLoadedSections(repositoryState: RepositoryState): BranchSectionKey[] {
    return BRANCH_SECTION_ORDER.filter((section) => repositoryState.sectionStates[section].loaded);
  }

  private buildRepositoryNode(
    repoRoot: string,
    activeRepoRoot: string | undefined
  ): BranchTreeNode | undefined {
    const repositoryState = this.repositoryStates.get(repoRoot);
    if (!repositoryState) {
      return undefined;
    }

    return buildRepositoryNode({
      repoRoot,
      label: repositoryState.descriptor.label,
      description: repositoryState.descriptor.description,
      isActive: repoRoot === activeRepoRoot,
      children: this.buildSectionNodes(repoRoot),
    });
  }

  private buildSectionNodes(repoRoot: string): TreeSection[] {
    const repositoryState = this.repositoryStates.get(repoRoot);
    if (!repositoryState) {
      return [];
    }

    const configuration = this.dependencies.getConfiguration();

    return BRANCH_SECTION_ORDER.map((section) => ({
      kind: 'section',
      label: BRANCH_SECTION_LABELS[section],
      path: BRANCH_SECTION_PATHS[section],
      scope: toTreeContainerScope(section),
      repoRoot,
      children: repositoryState.sectionStates[section].children,
    }) satisfies TreeSection).filter(
      (section) => {
        if (section.scope === 'hook') {
          return section.children.length > 0;
        }

        if (section.scope === 'remoteConfig') {
          return configuration.showRemotesSection ?? true;
        }

        return true;
      }
    );
  }

  private async loadSection(
    repositoryState: RepositoryState,
    section: BranchSectionKey,
    configuration: LoaderConfiguration
  ): Promise<void> {
    const repoRoot = repositoryState.descriptor.repoRoot;
    const currentState = repositoryState;
    const branches = await this.loadBranches(section, repoRoot);
    const latestRepositoryState = this.repositoryStates.get(repoRoot);
    if (!latestRepositoryState || latestRepositoryState !== currentState) {
      return;
    }

    const decoratedBranches = this.dependencies.decorateBranchInfo
      ? branches.map((branch) => this.dependencies.decorateBranchInfo?.(repoRoot, branch) ?? branch)
      : branches;

    if (section === 'remotes') {
      latestRepositoryState.sectionStates[section] = {
        loaded: true,
        children: buildRemoteTree(
          await this.dependencies.getRemoteDetails(repoRoot),
          repoRoot
        ),
      };
      return;
    }

    const sortedBranches = sortBranches(
      decoratedBranches,
      section === 'tags' ? configuration.tagSortOrder : configuration.sortOrder
    );
    const children = buildBranchTree(
      sortedBranches,
      section === 'worktree' || section === 'hooks' ? false : configuration.groupByFolder,
      toTreeContainerScope(section),
      repoRoot
    );

    if (section === 'local') {
      latestRepositoryState.localBranches = sortedBranches;
    }

    latestRepositoryState.sectionStates[section] = {
      loaded: true,
      children,
    };
  }

  private loadBranches(section: BranchSectionKey, repoRoot: string): Promise<BranchInfo[]> {
    switch (section) {
      case 'local':
        return this.dependencies.getBranches(repoRoot);
      case 'remote':
        return this.dependencies.getRemoteBranches(repoRoot);
      case 'stash':
        return this.dependencies.getStashes(repoRoot);
      case 'worktree':
        return this.dependencies.getWorktrees(repoRoot);
      case 'hooks':
        return this.dependencies.getHooks(repoRoot);
      case 'tags':
        return this.dependencies.getTags(repoRoot);
      case 'remotes':
        return Promise.resolve([]);
      default:
        return Promise.resolve([]);
    }
  }

  private async maybeRefreshRemoteState(
    repositoryState: RepositoryState,
    force = false
  ): Promise<void> {
    if (!shouldRefreshRemoteState(repositoryState.lastRemoteFetchAt, this.now(), force)) {
      return;
    }

    try {
      await this.dependencies.fetchRemoteState(repositoryState.descriptor.repoRoot);
      repositoryState.lastRemoteFetchAt = this.now();
    } catch (error) {
      this.dependencies.warn(
        formatErrorMessage('Git Branches Panel: failed to refresh remote state', error)
      );
    }
  }
}

function createEmptySectionState(): SectionState {
  return {
    loaded: false,
    children: [],
  };
}

function createEmptySectionStates(): Record<BranchSectionKey, SectionState> {
  return {
    local: createEmptySectionState(),
    remote: createEmptySectionState(),
    remotes: createEmptySectionState(),
    stash: createEmptySectionState(),
    worktree: createEmptySectionState(),
    hooks: createEmptySectionState(),
    tags: createEmptySectionState(),
  };
}

function toTreeContainerScope(section: BranchSectionKey) {
  if (section === 'tags') {
    return 'tag';
  }

  if (section === 'hooks') {
    return 'hook';
  }

  if (section === 'remotes') {
    return 'remoteConfig';
  }

  return section;
}
