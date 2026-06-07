import {
  buildBranchDescription,
  formatSyncStatus,
  getPublishTargetName,
  isPublishableBranch,
} from '../branchModel/descriptions';
import type {
  BranchInfo,
  BranchTreeNode,
  TreeBranch,
  TreeContainerScope,
} from '../branchModel/types';
import type {
  NodeType,
  TreeItemIconDescriptor,
  TreeItemPresentation,
} from './types';
import { getContainerNodeKey } from './containerLookup';

export function buildTreeItemPresentation(node: BranchTreeNode): TreeItemPresentation {
  if (node.kind === 'section') {
    const containerKey = getContainerNodeKey(node);

    return {
      nodeType: 'section',
      label: node.label,
      id: containerKey,
      contextValue: getSectionContextValue(node.scope),
      collapsibleState: getSectionCollapsibleState(node.scope),
      icon: { id: getSectionIconId(node.scope) },
      containerKey,
      containerPath: node.path,
      containerScope: node.scope,
    };
  }

  if (node.kind === 'folder') {
    const containerKey = getContainerNodeKey(node);

    return {
      nodeType: 'folder',
      label: node.label,
      id: containerKey,
      contextValue: getFolderContextValue(node.scope),
      collapsibleState: 'collapsed',
      icon: { id: 'folder' },
      containerKey,
      containerPath: node.path,
      containerScope: node.scope,
    };
  }

  const nodeType = resolveNodeType(node.info);
  const syncStatus = shouldShowSyncStatus(nodeType) ? formatSyncStatus(node.info) : '';
  const description = buildTreeItemDescription(node.info, syncStatus);
  const prioritizedLabel = buildTreeItemLabel(
    node.label,
    nodeType,
    syncStatus,
    node.info.isCurrent,
    node.info.isPinned
  );

  return {
    nodeType,
    label: prioritizedLabel,
    id: `${node.info.scope ?? 'local'}:branch:${node.fullName}`,
    contextValue: getItemContextValue(nodeType, node.info),
    collapsibleState: 'none',
    icon: getItemIcon(nodeType),
    description,
    tooltip: buildBranchTooltipContent(node),
    branchName: node.fullName,
    command: shouldActivateOnClick(nodeType, node.info.isCurrent)
      ? {
          command: 'gitBranchesPanel.activateBranchItem',
          title: 'Activate Branch Item',
        }
      : undefined,
  };
}

export function buildBranchTooltipContent(node: TreeBranch): string {
  const isRemoteBranch = node.info.scope === 'remote';
  const isStaleRemoteBranch = isRemoteBranch && node.info.remoteTrackingState === 'stale';
  const isTag = node.info.scope === 'tag';
  const isStash = node.info.scope === 'stash';
  const isWorktree = node.info.scope === 'worktree';
  const tooltipLines = [`**${node.info.worktreePath ?? node.fullName}**`];

  if (node.info.isPinned) {
    tooltipLines.push('', '_Pinned item_');
  }

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
    tooltipLines.push('', isStaleRemoteBranch ? '_Stale remote-tracking ref_' : '_Remote branch_');

    if (node.info.remoteName) {
      tooltipLines.push('', `Remote: ${node.info.remoteName}`);
    }

    if (isStaleRemoteBranch) {
      tooltipLines.push('', '_Remote is no longer configured locally_');
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

      if (node.info.upstreamMissing) {
        tooltipLines.push('', '_Tracked upstream no longer exists_');
      }
    } else if (isPublishableBranch(node.info)) {
      tooltipLines.push('', `Publish target: ${getPublishTargetName(node.info)}`);
      tooltipLines.push('', '_Not published yet_');
    } else {
      tooltipLines.push('', '_No upstream configured yet_');
    }

    if (!node.info.upstreamMissing) {
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
  if (branch.scope === 'remote' && branch.remoteTrackingState === 'stale') {
    return ['stale remote', branch.lastCommitDate ?? ''].filter(Boolean).join(' • ');
  }

  if (branch.scope === 'stash' || branch.scope === 'worktree' || !syncStatus) {
    return buildBranchDescription(branch) || undefined;
  }

  return branch.lastCommitDate || undefined;
}

function getSectionContextValue(scope: TreeContainerScope): string {
  switch (scope) {
    case 'local':
      return 'localSection';
    case 'remote':
      return 'remoteSection';
    case 'stash':
      return 'stashSection';
    case 'worktree':
      return 'worktreeSection';
    case 'tag':
      return 'tagsSection';
    default:
      return 'section';
  }
}

function getSectionCollapsibleState(scope: TreeContainerScope): 'expanded' | 'collapsed' {
  return scope === 'local' ? 'expanded' : 'collapsed';
}

function getSectionIconId(scope: TreeContainerScope): string {
  switch (scope) {
    case 'remote':
      return 'cloud';
    case 'stash':
      return 'archive';
    case 'worktree':
      return 'folder';
    default:
      return 'source-control';
  }
}

function getFolderContextValue(scope: TreeContainerScope): string {
  return `${scope}-folder`;
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
      return info.remoteTrackingState === 'stale' ? 'staleRemoteBranch' : 'remoteBranch';
    default:
      if (info.upstreamMissing) {
        return 'missingUpstreamBranch';
      }
      return info.isCurrent ? 'currentBranch' : 'branch';
  }
}

function shouldShowSyncStatus(nodeType: NodeType): boolean {
  return nodeType === 'branch' || nodeType === 'currentBranch' || nodeType === 'missingUpstreamBranch';
}

function buildTreeItemLabel(
  label: string,
  nodeType: NodeType,
  syncStatus: string,
  isCurrent: boolean,
  isPinned: boolean | undefined
): string {
  const prefixParts: string[] = [];
  if (isPinned) {
    prefixParts.push('★');
  }
  if (nodeType === 'currentBranch' || (nodeType === 'worktree' && isCurrent)) {
    prefixParts.push('●');
  }

  const prefix = prefixParts.length > 0 ? `${prefixParts.join(' ')} ` : '';

  return syncStatus ? `${prefix}${syncStatus} ${label}` : `${prefix}${label}`;
}

function getItemContextValue(nodeType: NodeType, branch: BranchInfo): string {
  const baseContextValue = resolveBaseContextValue(nodeType, branch);
  if (branch.isSyncing) {
    return resolveBusyContextValue(baseContextValue);
  }

  if (branch.isDeletionProtected) {
    return resolveProtectedContextValue(baseContextValue);
  }

  return baseContextValue;
}

function resolveBaseContextValue(nodeType: NodeType, branch: BranchInfo): string {
  if (nodeType === 'worktree') {
    return branch.isCurrent ? 'currentWorktree' : 'worktree';
  }

  if (nodeType === 'missingUpstreamBranch') {
    return branch.isCurrent ? 'publishableCurrentBranch' : 'missingUpstreamBranch';
  }

  if ((nodeType === 'branch' || nodeType === 'currentBranch') && isPublishableBranch(branch)) {
    return branch.isCurrent ? 'publishableCurrentBranch' : 'publishableBranch';
  }

  return nodeType;
}

function resolveBusyContextValue(contextValue: string): string {
  switch (contextValue) {
    case 'branch':
      return 'busyBranch';
    case 'currentBranch':
      return 'busyCurrentBranch';
    case 'publishableBranch':
      return 'busyPublishableBranch';
    case 'publishableCurrentBranch':
      return 'busyPublishableCurrentBranch';
    case 'missingUpstreamBranch':
      return 'busyMissingUpstreamBranch';
    default:
      return contextValue;
  }
}

function resolveProtectedContextValue(contextValue: string): string {
  switch (contextValue) {
    case 'branch':
      return 'protectedBranch';
    case 'publishableBranch':
      return 'protectedPublishableBranch';
    case 'missingUpstreamBranch':
      return 'protectedMissingUpstreamBranch';
    case 'remoteBranch':
      return 'protectedRemoteBranch';
    case 'staleRemoteBranch':
      return 'protectedStaleRemoteBranch';
    default:
      return contextValue;
  }
}

function getItemIcon(nodeType: NodeType): TreeItemIconDescriptor {
  switch (nodeType) {
    case 'currentBranch':
      return {
        id: 'git-branch',
        colorId: 'gitDecoration.addedResourceForeground',
      };
    case 'missingUpstreamBranch':
      return {
        id: 'git-branch',
        colorId: 'list.warningForeground',
      };
    case 'remoteBranch':
      return { id: 'cloud' };
    case 'staleRemoteBranch':
      return {
        id: 'cloud',
        colorId: 'list.warningForeground',
      };
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

function shouldActivateOnClick(nodeType: NodeType, isCurrent: boolean): boolean {
  if (nodeType === 'branch' || nodeType === 'missingUpstreamBranch') {
    return !isCurrent;
  }
  return false;
}
