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
  | 'stash';
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
      contextValue: node.path === 'section:tags' ? 'tagsSection' : 'section',
      collapsibleState: 'expanded',
      icon: {
        id:
          node.path === 'section:remote'
            ? 'cloud'
            : node.path === 'section:stash'
              ? 'archive'
              : 'source-control',
      },
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

  const isRemoteBranch = node.info.scope === 'remote';
  const isTag = node.info.scope === 'tag';
  const isStash = node.info.scope === 'stash';
  const isCurrentBranch = !isRemoteBranch && !isTag && !isStash && node.info.isCurrent;
  const nodeType: NodeType = isCurrentBranch
    ? 'currentBranch'
    : isStash
      ? 'stash'
    : isTag
      ? 'tag'
      : isRemoteBranch
        ? 'remoteBranch'
        : 'branch';
  const description = buildBranchDescription(node.info) || undefined;

  return {
    nodeType,
    label: isCurrentBranch ? `● ${node.label}` : node.label,
    id: `${node.info.scope ?? 'local'}:branch:${node.fullName}`,
    contextValue: nodeType,
    collapsibleState: 'none',
    icon: isCurrentBranch
      ? {
        id: 'git-branch',
        colorId: 'gitDecoration.addedResourceForeground',
      }
      : isStash
        ? { id: 'archive' }
      : isTag
        ? { id: 'tag' }
        : isRemoteBranch
          ? { id: 'cloud' }
          : { id: 'git-branch' },
    description,
    tooltip: buildBranchTooltipContent(node),
    branchName: node.fullName,
    command: !isCurrentBranch && !isRemoteBranch && !isTag && !isStash
      ? {
        command: 'gitBranchesPanel.activateBranchItem',
        title: 'Activate Branch Item',
      }
      : undefined,
  };
}

export function buildBranchTooltipContent(node: TreeBranch): string {
  const tooltipLines = [`**${node.fullName}**`];
  const isRemoteBranch = node.info.scope === 'remote';
  const isTag = node.info.scope === 'tag';
  const isStash = node.info.scope === 'stash';

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
