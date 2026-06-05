export interface BranchInfo {
  name: string;
  isCurrent: boolean;
  scope?: 'local' | 'remote' | 'tag' | 'stash';
  remoteName?: string;
  lastCommit?: string;
  lastCommitDate?: string;
  lastCommitTimestamp?: number;
  upstreamName?: string;
  aheadCount?: number;
  behindCount?: number;
  upstreamMissing?: boolean;
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

const branchNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

export function sortBranches(
  branches: readonly BranchInfo[],
  sortOrder: BranchSortOrder
): BranchInfo[] {
  return [...branches].sort((left, right) => {
    if (left.isCurrent !== right.isCurrent) {
      return left.isCurrent ? -1 : 1;
    }

    if (sortOrder === 'recent') {
      const timestampDelta =
        (right.lastCommitTimestamp ?? Number.NEGATIVE_INFINITY) -
        (left.lastCommitTimestamp ?? Number.NEGATIVE_INFINITY);

      if (timestampDelta !== 0) {
        return timestampDelta;
      }
    }

    return branchNameCollator.compare(left.name, right.name);
  });
}

export function buildBranchTree(
  branches: readonly BranchInfo[],
  groupByFolder: boolean
): TreeChildNode[] {
  const branchOrder = new Map(branches.map((branch, index) => [getBranchKey(branch), index]));

  if (!groupByFolder) {
    return sortTreeNodes(branches.map((branch) => createBranchNode(branch)), branchOrder);
  }

  const root: TreeFolder = {
    kind: 'folder',
    label: '__root__',
    path: '',
    children: [],
  };

  for (const branch of branches) {
    const segments = branch.name.split('/').filter(Boolean);

    if (segments.length <= 1) {
      root.children.push(createBranchNode(branch));
      continue;
    }

    let currentFolder = root;
    let currentPath = '';

    for (const segment of segments.slice(0, -1)) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;

      let nextFolder = currentFolder.children.find(
        (node): node is TreeFolder =>
          node.kind === 'folder' && node.path === currentPath
      );

      if (!nextFolder) {
        nextFolder = {
          kind: 'folder',
          label: segment,
          path: currentPath,
          children: [],
        };
        currentFolder.children.push(nextFolder);
      }

      currentFolder = nextFolder;
    }

    currentFolder.children.push(createBranchNode(branch));
  }

  return sortTreeNodes(root.children, branchOrder);
}

export function buildBranchSections(
  localBranches: readonly BranchInfo[],
  remoteBranches: readonly BranchInfo[],
  stashBranches: readonly BranchInfo[],
  tagBranches: readonly BranchInfo[],
  groupByFolder: boolean
): TreeSection[] {
  const sections: TreeSection[] = [];

  if (localBranches.length > 0) {
    sections.push({
      kind: 'section',
      label: 'Local',
      path: 'section:local',
      children: buildBranchTree(localBranches, groupByFolder),
    });
  }

  if (remoteBranches.length > 0) {
    sections.push({
      kind: 'section',
      label: 'Remote',
      path: 'section:remote',
      children: buildBranchTree(remoteBranches, groupByFolder),
    });
  }

  if (stashBranches.length > 0) {
    sections.push({
      kind: 'section',
      label: 'Stash',
      path: 'section:stash',
      children: buildBranchTree(stashBranches, groupByFolder),
    });
  }

  if (tagBranches.length > 0) {
    sections.push({
      kind: 'section',
      label: 'Tags',
      path: 'section:tags',
      children: buildBranchTree(tagBranches, groupByFolder),
    });
  }

  return sections;
}

export function findFolderNode(
  nodes: readonly BranchTreeNode[],
  folderPath: string
): TreeFolder | undefined {
  for (const node of nodes) {
    if (node.kind === 'branch') {
      continue;
    }

    if (node.kind === 'folder' && node.path === folderPath) {
      return node;
    }

    const nestedMatch = findFolderNode(node.children, folderPath);
    if (nestedMatch) {
      return nestedMatch;
    }
  }

  return undefined;
}

export function parseUpstreamTrack(trackText: string): BranchSyncState {
  const normalizedTrackText = trackText.trim();
  if (!normalizedTrackText) {
    return {
      aheadCount: 0,
      behindCount: 0,
      upstreamMissing: false,
    };
  }

  if (normalizedTrackText === 'gone') {
    return {
      aheadCount: 0,
      behindCount: 0,
      upstreamMissing: true,
    };
  }

  const aheadMatch = normalizedTrackText.match(/ahead\s+(\d+)/i);
  const behindMatch = normalizedTrackText.match(/behind\s+(\d+)/i);

  return {
    aheadCount: aheadMatch ? Number(aheadMatch[1]) : 0,
    behindCount: behindMatch ? Number(behindMatch[1]) : 0,
    upstreamMissing: false,
  };
}

export function formatSyncStatus(syncState: Pick<BranchInfo, 'aheadCount' | 'behindCount'>): string {
  const behindCount = syncState.behindCount ?? 0;
  const aheadCount = syncState.aheadCount ?? 0;
  const statusParts: string[] = [];

  if (behindCount > 0) {
    statusParts.push(`${behindCount}↓`);
  }

  if (aheadCount > 0) {
    statusParts.push(`${aheadCount}↑`);
  }

  return statusParts.join(' ');
}

export function buildBranchDescription(
  branch: Pick<BranchInfo, 'aheadCount' | 'behindCount' | 'lastCommit' | 'lastCommitDate' | 'scope'>
): string {
  const descriptionParts =
    branch.scope === 'stash'
      ? [branch.lastCommit ?? '', branch.lastCommitDate ?? ''].filter(Boolean)
      : [formatSyncStatus(branch), branch.lastCommitDate ?? ''].filter(Boolean);

  return descriptionParts.join(' • ');
}

function createBranchNode(branch: BranchInfo): TreeBranch {
  const segments = branch.name.split('/').filter(Boolean);
  const label = segments.length > 0 ? segments[segments.length - 1] : branch.name;

  return {
    kind: 'branch',
    info: branch,
    fullName: branch.name,
    label,
    path: branch.name,
  };
}

function sortTreeNodes(
  nodes: ReadonlyArray<TreeChildNode>,
  branchOrder: ReadonlyMap<string, number>
): TreeChildNode[] {
  const sortedNodes = nodes.map((node) => {
    if (node.kind !== 'folder') {
      return node;
    }

    return {
      ...node,
      children: sortTreeNodes(node.children, branchOrder),
    } satisfies TreeFolder;
  });

  return sortedNodes.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'folder' ? -1 : 1;
    }

    if (left.kind === 'folder' && right.kind === 'folder') {
      return branchNameCollator.compare(left.path, right.path);
    }

    return left.kind === 'branch' && right.kind === 'branch'
      ? (branchOrder.get(getBranchKey(left.info)) ?? Number.MAX_SAFE_INTEGER) -
        (branchOrder.get(getBranchKey(right.info)) ?? Number.MAX_SAFE_INTEGER)
      : branchNameCollator.compare(left.path, right.path);
  });
}

function getBranchKey(branch: Pick<BranchInfo, 'name' | 'scope'>): string {
  return `${branch.scope ?? 'local'}:${branch.name}`;
}
