import type { BranchTreeNode } from '../branchModel/types';

export type NodeType =
  | 'section'
  | 'folder'
  | 'branch'
  | 'currentBranch'
  | 'remoteBranch'
  | 'tag'
  | 'stash'
  | 'worktree';

export type TreeItemCollapsibleKind = 'expanded' | 'none';
export type TreeContainerNode = Extract<BranchTreeNode, { kind: 'section' | 'folder' }>;

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
  containerPath?: string;
  branchName?: string;
  command?: TreeItemCommandDescriptor;
}
