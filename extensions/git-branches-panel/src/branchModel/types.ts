export type RemoteTrackingState = 'live' | 'stale';

export interface BranchInfo {
  name: string;
  isCurrent: boolean;
  scope?: 'local' | 'remote' | 'tag' | 'stash' | 'worktree';
  remoteName?: string;
  remoteTrackingState?: RemoteTrackingState;
  lastCommit?: string;
  lastCommitDate?: string;
  lastCommitTimestamp?: number;
  stashRevision?: string;
  upstreamName?: string;
  aheadCount?: number;
  behindCount?: number;
  upstreamMissing?: boolean;
  isPinned?: boolean;
  isSyncing?: boolean;
  isDeletionProtected?: boolean;
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
export type TagSortOrder = BranchSortOrder | 'versionAscending' | 'versionDescending';
export type TreeContainerScope = 'local' | 'remote' | 'tag' | 'stash' | 'worktree';

export interface TreeSection {
  kind: 'section';
  label: string;
  path: string;
  scope: TreeContainerScope;
  children: TreeChildNode[];
}

export interface TreeFolder {
  kind: 'folder';
  label: string;
  path: string;
  scope: TreeContainerScope;
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
