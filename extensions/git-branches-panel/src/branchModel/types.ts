export interface BranchInfo {
  name: string;
  isCurrent: boolean;
  scope?: 'local' | 'remote' | 'tag' | 'stash' | 'worktree';
  remoteName?: string;
  lastCommit?: string;
  lastCommitDate?: string;
  lastCommitTimestamp?: number;
  upstreamName?: string;
  aheadCount?: number;
  behindCount?: number;
  upstreamMissing?: boolean;
  worktreePath?: string;
  worktreeRef?: string;
  worktreeIsBare?: boolean;
  worktreeLockedReason?: string;
  worktreePrunableReason?: string;
}

export interface BranchSyncState {
  aheadCount: number;
  behindCount: number;
  upstreamMissing: boolean;
}

export type BranchSortOrder = 'alphabetical' | 'recent';

export interface TreeSection {
  kind: 'section';
  label: string;
  path: string;
  children: TreeChildNode[];
}

export interface TreeFolder {
  kind: 'folder';
  label: string;
  path: string;
  children: TreeChildNode[];
}

export interface TreeBranch {
  kind: 'branch';
  info: BranchInfo;
  fullName: string;
  label: string;
  path: string;
}

export type TreeChildNode = TreeFolder | TreeBranch;
export type BranchTreeNode = TreeSection | TreeFolder | TreeBranch;
