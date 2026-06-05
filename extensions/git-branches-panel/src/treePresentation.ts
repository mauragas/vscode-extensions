import {
  buildBranchDescription,
  formatSyncStatus,
  type BranchInfo,
  type BranchTreeNode,
  type TreeBranch,
} from './branchModel';

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

export function buildTreeItemPresentation(node: BranchTreeNode): TreeItemPresentation {
  if (node.kind === 'section') {
    return {
      nodeType: 'section',
      label: node.label,
      id: node.path,
      contextValue: getSectionContextValue(node.path),
      collapsibleState: 'expanded',
      icon: { id: getSectionIconId(node.path) },
      containerPath: node.path,
    };
  }

  if (node.kind === 'folder') {
    return {
      nodeType: 'folder',
      label: node.label,
      id: `folder:${node.path}`,
      contextValue: 'folder',
      collapsibleState: 'expanded',
      icon: { id: 'folder' },
      containerPath: node.path,
    };
  }

  const nodeType = resolveNodeType(node.info);
  const syncStatus = shouldShowSyncStatus(nodeType) ? formatSyncStatus(node.info) : '';
  const description = buildTreeItemDescription(node.info, syncStatus);
  const prioritizedLabel = buildTreeItemLabel(node.label, nodeType, syncStatus, node.info.isCurrent);

  return {
    nodeType,
    label: prioritizedLabel,
    id: `${node.info.scope ?? 'local'}:branch:${node.fullName}`,
    contextValue: getItemContextValue(nodeType, node.info.isCurrent),
    collapsibleState: 'none',
    icon: getItemIcon(nodeType),
    description,
    tooltip: buildBranchTooltipContent(node),
    branchName: node.fullName,
    command: shouldActivateOnClick(nodeType)
      ? {
        command: 'gitBranchesPanel.activateBranchItem',
        title: 'Activate Branch Item',
      }
      : undefined,
  };
}

export function buildBranchTooltipContent(node: TreeBranch): string {
  const isRemoteBranch = node.info.scope === 'remote';
  const isTag = node.info.scope === 'tag';
  const isStash = node.info.scope === 'stash';
  const isWorktree = node.info.scope === 'worktree';
  const tooltipLines = [`**${node.info.worktreePath ?? node.fullName}**`];

  if (isWorktree) {
    tooltipLines.push('', '_Worktree_');

    if (node.info.isCurrent) {
      tooltipLines.push('', '_Current worktree_');
    }

    if (node.info.worktreeRef) {
      tooltipLines.push('', `Reference: ${node.info.worktreeRef}`);
    }

    if (node.info.worktreeIsBare) {
      tooltipLines.push('', '_Bare worktree_');
    }

    if (node.info.worktreeLockedReason) {
      tooltipLines.push('', `Locked: ${node.info.worktreeLockedReason}`);
    }

    if (node.info.worktreePrunableReason) {
      tooltipLines.push('', `Prunable: ${node.info.worktreePrunableReason}`);
    }

    return tooltipLines.join('\n');
  }

  if (isStash) {
    tooltipLines.push('', '_Stash_');
  } else if (isTag) {
    tooltipLines.push('', '_Tag_');
  } else if (isRemoteBranch) {
    tooltipLines.push('', '_Remote branch_');

    if (node.info.remoteName) {
      tooltipLines.push('', `Remote: ${node.info.remoteName}`);
    }
  } else if (node.info.isCurrent) {
    tooltipLines.push('', '_Current branch_');
  }

  if (node.info.lastCommitDate) {
    if (isStash) {
      tooltipLines.push('', `Saved: ${node.info.lastCommitDate}`);
    } else {
      tooltipLines.push('', `Last commit: ${node.info.lastCommitDate}`);
    }
  }

  if (isStash) {
    if (node.info.lastCommit) {
      tooltipLines.push('', `Message: ${node.info.lastCommit}`);
    }

    return tooltipLines.join('\n');
  }

  if (!isRemoteBranch && !isTag) {
    if (node.info.upstreamName) {
      tooltipLines.push('', `Upstream: ${node.info.upstreamName}`);
    } else {
      tooltipLines.push('', '_No upstream configured yet_');
    }

    if (node.info.upstreamMissing) {
      tooltipLines.push('', '_Tracked upstream no longer exists_');
    } else {
      const syncStatus = formatSyncStatus(node.info);
      tooltipLines.push('', syncStatus ? `Sync state: ${syncStatus}` : 'Sync state: up to date');
    }
  }

  if (node.info.lastCommit) {
    tooltipLines.push('', `> ${node.info.lastCommit}`);
  }

  return tooltipLines.join('\n');
}

function buildTreeItemDescription(branch: BranchInfo, syncStatus: string): string | undefined {
  if (branch.scope === 'stash' || branch.scope === 'worktree' || !syncStatus) {
    return buildBranchDescription(branch) || undefined;
  }

  return branch.lastCommitDate || undefined;
}

function getSectionContextValue(sectionPath: string): string {
  return sectionPath === 'section:tags' ? 'tagsSection' : 'section';
}

function getSectionIconId(sectionPath: string): string {
  switch (sectionPath) {
    case 'section:remote':
      return 'cloud';
    case 'section:stash':
      return 'archive';
    case 'section:worktree':
      return 'folder';
    default:
      return 'source-control';
  }
}

function resolveNodeType(info: BranchInfo): NodeType {
  switch (info.scope) {
    case 'stash':
      return 'stash';
    case 'worktree':
      return 'worktree';
    case 'tag':
      return 'tag';
    case 'remote':
      return 'remoteBranch';
    default:
      return info.isCurrent ? 'currentBranch' : 'branch';
  }
}

function shouldShowSyncStatus(nodeType: NodeType): boolean {
  return nodeType === 'branch' || nodeType === 'currentBranch';
}

function buildTreeItemLabel(
  label: string,
  nodeType: NodeType,
  syncStatus: string,
  isCurrent: boolean
): string {
  const prefix = nodeType === 'currentBranch' || (nodeType === 'worktree' && isCurrent) ? '● ' : '';

  return syncStatus ? `${prefix}${syncStatus} ${label}` : `${prefix}${label}`;
}

function getItemContextValue(nodeType: NodeType, isCurrent: boolean): string {
  if (nodeType === 'worktree') {
    return isCurrent ? 'currentWorktree' : 'worktree';
  }

  return nodeType;
}

function getItemIcon(nodeType: NodeType): TreeItemIconDescriptor {
  switch (nodeType) {
    case 'currentBranch':
      return {
        id: 'git-branch',
        colorId: 'gitDecoration.addedResourceForeground',
      };
    case 'remoteBranch':
      return { id: 'cloud' };
    case 'tag':
      return { id: 'tag' };
    case 'stash':
      return { id: 'archive' };
    case 'worktree':
      return { id: 'folder' };
    default:
      return { id: 'git-branch' };
  }
}

function shouldActivateOnClick(nodeType: NodeType): boolean {
  return nodeType === 'branch';
}

export function buildStatusBarText(branch: BranchInfo | undefined): string {
  if (!branch) {
    return '';
  }

  const syncStatus = formatSyncStatus(branch);

  return syncStatus ? `$(git-branch) ${branch.name} ${syncStatus}` : `$(git-branch) ${branch.name}`;
}

export function buildStatusBarTooltipContent(branch: BranchInfo): string {
  const tooltipLines = [`**Current branch:** ${branch.name}`];
  const syncStatus = formatSyncStatus(branch);

  if (branch.upstreamName) {
    tooltipLines.push('', `Upstream: ${branch.upstreamName}`);
  }

  if (branch.upstreamMissing) {
    tooltipLines.push('', '_Tracked upstream no longer exists_');
  } else if (syncStatus) {
    tooltipLines.push('', `Sync state: ${syncStatus}`);
  } else {
    tooltipLines.push('', 'Sync state: up to date');
  }

  tooltipLines.push('', 'Click to sync the current branch with its remote.');

  return tooltipLines.join('\n');
}

export function findContainerNode(
  nodes: readonly BranchTreeNode[],
  containerPath: string
): TreeContainerNode | undefined {
  for (const node of nodes) {
    if (node.kind === 'branch') {
      continue;
    }

    if (node.path === containerPath) {
      return node;
    }

    const nestedMatch = findContainerNode(node.children, containerPath);
    if (nestedMatch) {
      return nestedMatch;
    }
  }

  return undefined;
}
