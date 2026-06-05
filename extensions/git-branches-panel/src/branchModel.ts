export interface BranchInfo {
  name: string;
  isCurrent: boolean;
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

export interface TreeFolder {
  kind: 'folder';
  label: string;
  path: string;
  children: BranchTreeNode[];
}

export interface TreeBranch {
  kind: 'branch';
  info: BranchInfo;
  fullName: string;
  label: string;
  path: string;
}

export type BranchTreeNode = TreeFolder | TreeBranch;

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
): BranchTreeNode[] {
  if (!groupByFolder) {
    return branches.map((branch) => createBranchNode(branch));
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

  return root.children;
}

export function findFolderNode(
  nodes: readonly BranchTreeNode[],
  folderPath: string
): TreeFolder | undefined {
  for (const node of nodes) {
    if (node.kind !== 'folder') {
      continue;
    }

    if (node.path === folderPath) {
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
  branch: Pick<BranchInfo, 'aheadCount' | 'behindCount' | 'lastCommitDate'>
): string {
  const descriptionParts = [formatSyncStatus(branch), branch.lastCommitDate ?? ''].filter(Boolean);

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
