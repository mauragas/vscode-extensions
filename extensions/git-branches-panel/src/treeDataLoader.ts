import {
  buildBranchSections,
  sortBranches,
  type BranchInfo,
  type BranchSortOrder,
  type BranchTreeNode,
} from './branchModel';
import { formatErrorMessage } from './errorUtils';

export interface BranchLoadOptions {
  fetchRemoteState?: boolean;
  forceFetchRemoteState?: boolean;
}

export interface BranchDataLoaderDependencies {
  getWorkspaceFolderPaths(): readonly string[];
  getConfiguration(): {
    groupByFolder: boolean;
    sortOrder: BranchSortOrder;
  };
  getRepoRoot(workspaceFolder: string): Promise<string | null>;
  getBranches(repoRoot: string): Promise<BranchInfo[]>;
  getRemoteBranches(repoRoot: string): Promise<BranchInfo[]>;
  getTags(repoRoot: string): Promise<BranchInfo[]>;
  fetchRemoteState(repoRoot: string): Promise<void>;
  warn(message: string): void;
}

export const REMOTE_FETCH_INTERVAL_MS = 30_000;

export function shouldRefreshRemoteState(
  lastRemoteFetchAt: number,
  now: number,
  force = false,
  intervalMs = REMOTE_FETCH_INTERVAL_MS
): boolean {
  return lastRemoteFetchAt === 0 || force || now - lastRemoteFetchAt >= intervalMs;
}

export class BranchDataLoader {
  private treeData: BranchTreeNode[] = [];
  private localBranches: BranchInfo[] = [];
  private repoRoot: string | null = null;
  private lastRemoteFetchAt = 0;

  constructor(
    private readonly dependencies: BranchDataLoaderDependencies,
    private readonly now: () => number = () => Date.now()
  ) {}

  getTreeData(): readonly BranchTreeNode[] {
    return this.treeData;
  }

  getRepoRoot(): string | null {
    return this.repoRoot;
  }

  getCurrentBranch(): BranchInfo | undefined {
    return this.localBranches.find((branch) => branch.isCurrent);
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
    }

    this.repoRoot = nextRepoRoot;
    if (!this.repoRoot) {
      this.clearData();
      return;
    }

    if (options.fetchRemoteState ?? true) {
      await this.maybeRefreshRemoteState(this.repoRoot, options.forceFetchRemoteState ?? false);
    }

    const configuration = this.dependencies.getConfiguration();
    const [localBranches, remoteBranches, tagBranches] = await Promise.all([
      this.dependencies.getBranches(this.repoRoot),
      this.dependencies.getRemoteBranches(this.repoRoot),
      this.dependencies.getTags(this.repoRoot),
    ]);
    const sortedLocalBranches = sortBranches(localBranches, configuration.sortOrder);
    const sortedRemoteBranches = sortBranches(remoteBranches, configuration.sortOrder);
    const sortedTagBranches = sortBranches(tagBranches, configuration.sortOrder);

    this.localBranches = sortedLocalBranches;
    this.treeData = buildBranchSections(
      sortedLocalBranches,
      sortedRemoteBranches,
      sortedTagBranches,
      configuration.groupByFolder
    );
  }

  private clearData(): void {
    this.repoRoot = null;
    this.localBranches = [];
    this.treeData = [];
    this.lastRemoteFetchAt = 0;
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
