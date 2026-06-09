import type { BranchTreeNode, TreeContainerScope } from '../branchModel/types';

export type NodeType =
  | 'repository'
  | 'section'
  | 'folder'
  | 'branch'
  | 'currentBranch'
  | 'missingUpstreamBranch'
  | 'remoteBranch'
  | 'staleRemoteBranch'
  | 'tag'
  | 'stash'
  | 'hook'
  | 'worktree';

export type TreeItemCollapsibleKind = 'expanded' | 'collapsed' | 'none';
export type TreeContainerNode = Extract<BranchTreeNode, { kind: 'repository' | 'section' | 'folder' }>;

export interface TreeItemIconDescriptor {
  id: string;
  colorId?: string;
}

export interface TreeItemCommandDescriptor {
  command: string;
  title: string;
}

export interface TreeItemPresentation {
  nodeType: NodeType;
  label: string;
  id: string;
  contextValue: string;
  collapsibleState: TreeItemCollapsibleKind;
  icon: TreeItemIconDescriptor;
  description?: string;
  tooltip?: string;
  containerKey?: string;
  containerPath?: string;
  containerScope?: TreeContainerScope;
  branchName?: string;
  command?: TreeItemCommandDescriptor;
}
