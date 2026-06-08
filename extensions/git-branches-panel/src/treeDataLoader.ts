import {
  buildBranchTree,
  sortBranches,
  type BranchInfo,
  type BranchSortOrder,
  type TagSortOrder,
  type BranchTreeNode,
  type TreeContainerScope,
  type TreeChildNode,
  type TreeSection,
} from './branchModel';
import { formatErrorMessage } from './errorUtils';

export type BranchSectionKey = 'local' | 'remote' | 'stash' | 'worktree' | 'hooks' | 'tags';

export interface BranchLoadOptions {
  fetchRemoteState?: boolean;
  forceFetchRemoteState?: boolean;
  sections?: readonly BranchSectionKey[];
  onlyIfLoaded?: boolean;
}

export interface BranchDataLoaderDependencies {
  getWorkspaceFolderPaths(): readonly string[];
  getConfiguration(): {
    groupByFolder: boolean;
    sortOrder: BranchSortOrder;
    tagSortOrder: TagSortOrder;
  };
  getRepoRoot(workspaceFolder: string): Promise<string | null>;
  getBranches(repoRoot: string): Promise<BranchInfo[]>;
  getRemoteBranches(repoRoot: string): Promise<BranchInfo[]>;
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
  'stash',
  'worktree',
  'hooks',
  'tags',
] as const;

const BRANCH_SECTION_LABELS: Record<BranchSectionKey, string> = {
  local: 'Local',
  remote: 'Remote',
  stash: 'Stash',
  worktree: 'Worktree',
  hooks: 'Hooks',
  tags: 'Tags',
};

const BRANCH_SECTION_PATHS: Record<BranchSectionKey, string> = {
  local: 'section:local',
  remote: 'section:remote',
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
  private localBranches: BranchInfo[] = [];
  private repoRoot: string | null = null;
  private lastRemoteFetchAt = 0;
  private readonly sectionStates = createEmptySectionStates();

  constructor(
    private readonly dependencies: BranchDataLoaderDependencies,
    private readonly now: () => number = () => Date.now()
  ) {}

  getTreeData(): readonly BranchTreeNode[] {
    if (!this.repoRoot) {
      return [];
    }

    return BRANCH_SECTION_ORDER.map((section) => ({
      kind: 'section',
      label: BRANCH_SECTION_LABELS[section],
      path: BRANCH_SECTION_PATHS[section],
      scope: toTreeContainerScope(section),
      children: this.sectionStates[section].children,
    }) satisfies TreeSection).filter(
      (section) => section.scope !== 'hook' || section.children.length > 0
    );
  }

  getRepoRoot(): string | null {
    return this.repoRoot;
  }

  getCurrentBranch(): BranchInfo | undefined {
    return this.localBranches.find((branch) => branch.isCurrent);
  }

  isSectionLoaded(section: BranchSectionKey): boolean {
    return this.sectionStates[section].loaded;
  }

  async refresh(options: BranchLoadOptions = {}): Promise<void> {
    const workspaceFolderPaths = this.dependencies.getWorkspaceFolderPaths();
    if (workspaceFolderPaths.length === 0) {
      this.clearData();
      return;
    }

    const workspaceRoot = workspaceFolderPaths[0];
    const nextRepoRoot = await this.dependencies.getRepoRoot(workspaceRoot);
    if (nextRepoRoot !== this.repoRoot) {
      this.lastRemoteFetchAt = 0;
      this.clearSections();
    }

    this.repoRoot = nextRepoRoot;
    if (!this.repoRoot) {
      this.clearData();
      return;
    }

    if (options.fetchRemoteState ?? false) {
      await this.maybeRefreshRemoteState(this.repoRoot, options.forceFetchRemoteState ?? false);
    }

    const configuration = this.dependencies.getConfiguration();
    const sections = this.resolveSections(options.sections, options.onlyIfLoaded ?? false);
    if (sections.length === 0) {
      return;
    }

    await Promise.all(sections.map((section) => this.loadSection(section, configuration)));
  }

  private clearData(): void {
    this.repoRoot = null;
    this.localBranches = [];
    this.lastRemoteFetchAt = 0;
    this.clearSections();
  }

  private clearSections(): void {
    this.localBranches = [];

    for (const section of BRANCH_SECTION_ORDER) {
      this.sectionStates[section] = createEmptySectionState();
    }
  }

  private resolveSections(
    requestedSections: readonly BranchSectionKey[] | undefined,
    onlyIfLoaded: boolean
  ): BranchSectionKey[] {
    const baseSections =
      requestedSections ??
      (this.getLoadedSections().length > 0 ? this.getLoadedSections() : [...DEFAULT_SECTIONS]);
    const uniqueSections = [...new Set(baseSections)];

    return onlyIfLoaded
      ? uniqueSections.filter((section) => this.sectionStates[section].loaded)
      : uniqueSections;
  }

  private getLoadedSections(): BranchSectionKey[] {
    return BRANCH_SECTION_ORDER.filter((section) => this.sectionStates[section].loaded);
  }

  private async loadSection(
    section: BranchSectionKey,
    configuration: LoaderConfiguration
  ): Promise<void> {
    const repoRoot = this.repoRoot;
    if (!repoRoot) {
      return;
    }

    const branches = await this.loadBranches(section, repoRoot);
    if (this.repoRoot !== repoRoot) {
      return;
    }

    const decoratedBranches = this.dependencies.decorateBranchInfo
      ? branches.map((branch) => this.dependencies.decorateBranchInfo?.(repoRoot, branch) ?? branch)
      : branches;
    const sortedBranches = sortBranches(
      decoratedBranches,
      section === 'tags' ? configuration.tagSortOrder : configuration.sortOrder
    );
    const children = buildBranchTree(
      sortedBranches,
      section === 'worktree' || section === 'hooks' ? false : configuration.groupByFolder,
      toTreeContainerScope(section)
    );

    if (section === 'local') {
      this.localBranches = sortedBranches;
    }

    this.sectionStates[section] = {
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
      default:
        return Promise.resolve([]);
    }
  }

  private async maybeRefreshRemoteState(repoRoot: string, force = false): Promise<void> {
    if (!shouldRefreshRemoteState(this.lastRemoteFetchAt, this.now(), force)) {
      return;
    }

    try {
      await this.dependencies.fetchRemoteState(repoRoot);
      this.lastRemoteFetchAt = this.now();
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
    stash: createEmptySectionState(),
    worktree: createEmptySectionState(),
    hooks: createEmptySectionState(),
    tags: createEmptySectionState(),
  };
}

function toTreeContainerScope(section: BranchSectionKey): TreeContainerScope {
  if (section === 'tags') {
    return 'tag';
  }

  if (section === 'hooks') {
    return 'hook';
  }

  return section;
}
