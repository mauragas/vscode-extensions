import type {
  BranchInfo,
  BranchSortOrder,
  BranchTreeNode,
  TagSortOrder,
  TreeBranch,
  TreeChildNode,
  TreeContainerScope,
  TreeFolder,
  TreeSection,
} from './types';

const branchNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

const tagVersionPattern =
  /(?:^|[/_-])(v?\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u;

export function sortBranches(
  branches: readonly BranchInfo[],
  sortOrder: BranchSortOrder | TagSortOrder
): BranchInfo[] {
  return [...branches].sort((left, right) => {
    if (Boolean(left.isPinned) !== Boolean(right.isPinned)) {
      return left.isPinned ? -1 : 1;
    }

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

    if (sortOrder === 'versionAscending' || sortOrder === 'versionDescending') {
      const leftVersion = parseTagVersion(left.name);
      const rightVersion = parseTagVersion(right.name);

      if (leftVersion || rightVersion) {
        if (!leftVersion) {
          return 1;
        }

        if (!rightVersion) {
          return -1;
        }

        const versionDelta = compareParsedTagVersions(leftVersion, rightVersion);

        if (versionDelta !== 0) {
          return sortOrder === 'versionDescending' ? -versionDelta : versionDelta;
        }
      }
    }

    return branchNameCollator.compare(left.name, right.name);
  });
}

export function buildBranchTree(
  branches: readonly BranchInfo[],
  groupByFolder: boolean,
  scope: TreeContainerScope = 'local'
): TreeChildNode[] {
  const branchOrder = new Map(branches.map((branch, index) => [getBranchKey(branch), index]));

  if (!groupByFolder) {
    return sortTreeNodes(branches.map((branch) => createBranchNode(branch)), branchOrder);
  }

  const root: TreeFolder = {
    kind: 'folder',
    label: '__root__',
    path: '',
    scope,
    children: [],
  };

  for (const branch of branches) {
    if (branch.isPinned) {
      root.children.push(createBranchNode(branch));
      continue;
    }

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
          scope,
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
  worktreeBranches: readonly BranchInfo[],
  tagBranches: readonly BranchInfo[],
  groupByFolder: boolean
): TreeSection[] {
  const sections: TreeSection[] = [];

  if (localBranches.length > 0) {
    sections.push({
      kind: 'section',
      label: 'Local',
      path: 'section:local',
      scope: 'local',
      children: buildBranchTree(localBranches, groupByFolder, 'local'),
    });
  }

  if (remoteBranches.length > 0) {
    sections.push({
      kind: 'section',
      label: 'Remote',
      path: 'section:remote',
      scope: 'remote',
      children: buildBranchTree(remoteBranches, groupByFolder, 'remote'),
    });
  }

  if (stashBranches.length > 0) {
    sections.push({
      kind: 'section',
      label: 'Stash',
      path: 'section:stash',
      scope: 'stash',
      children: buildBranchTree(stashBranches, groupByFolder, 'stash'),
    });
  }

  if (worktreeBranches.length > 0) {
    sections.push({
      kind: 'section',
      label: 'Worktree',
      path: 'section:worktree',
      scope: 'worktree',
      children: buildBranchTree(worktreeBranches, false, 'worktree'),
    });
  }

  if (tagBranches.length > 0) {
    sections.push({
      kind: 'section',
      label: 'Tags',
      path: 'section:tags',
      scope: 'tag',
      children: buildBranchTree(tagBranches, groupByFolder, 'tag'),
    });
  }

  return sections;
}

export function findFolderNode(
  nodes: readonly BranchTreeNode[],
  folderPath: string,
  scope?: TreeContainerScope
): TreeFolder | undefined {
  for (const node of nodes) {
    if (node.kind === 'branch') {
      continue;
    }

    if (node.kind === 'folder' && node.path === folderPath && (!scope || node.scope === scope)) {
      return node;
    }

    const nestedMatch = findFolderNode(node.children, folderPath, scope);
    if (nestedMatch) {
      return nestedMatch;
    }
  }

  return undefined;
}

function createBranchNode(branch: BranchInfo): TreeBranch {
  const label = getBranchNodeLabel(branch);

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
    const leftPinned = left.kind === 'branch' && Boolean(left.info.isPinned);
    const rightPinned = right.kind === 'branch' && Boolean(right.info.isPinned);

    if (leftPinned !== rightPinned) {
      return leftPinned ? -1 : 1;
    }

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

function getBranchNodeLabel(branch: Pick<BranchInfo, 'name' | 'scope'>): string {
  const separatorPattern = branch.scope === 'worktree' ? /[\\/]+/u : /\//u;
  const segments = branch.name.split(separatorPattern).filter(Boolean);

  return segments.length > 0 ? segments[segments.length - 1] : branch.name;
}

interface ParsedTagVersion {
  components: number[];
  prerelease: string[];
}

function parseTagVersion(tagName: string): ParsedTagVersion | undefined {
  const match = tagVersionPattern.exec(tagName.trim());

  if (!match) {
    return undefined;
  }

  const [core = '', prereleaseText = ''] = match.slice(1);

  return {
    components: core
      .replace(/^v/i, '')
      .split('.')
      .map((component) => Number.parseInt(component, 10)),
    prerelease: prereleaseText ? prereleaseText.split('.') : [],
  };
}

function compareParsedTagVersions(left: ParsedTagVersion, right: ParsedTagVersion): number {
  const length = Math.max(left.components.length, right.components.length);

  for (let index = 0; index < length; index += 1) {
    const componentDelta = (left.components[index] ?? 0) - (right.components[index] ?? 0);

    if (componentDelta !== 0) {
      return componentDelta;
    }
  }

  return comparePrereleaseIdentifiers(left.prerelease, right.prerelease);
}

function comparePrereleaseIdentifiers(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 && right.length === 0) {
    return 0;
  }

  if (left.length === 0) {
    return 1;
  }

  if (right.length === 0) {
    return -1;
  }

  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left[index];
    const rightIdentifier = right[index];

    if (leftIdentifier === undefined) {
      return -1;
    }

    if (rightIdentifier === undefined) {
      return 1;
    }

    const leftIsNumeric = isNumericIdentifier(leftIdentifier);
    const rightIsNumeric = isNumericIdentifier(rightIdentifier);

    if (leftIsNumeric && rightIsNumeric) {
      const numericDelta = Number.parseInt(leftIdentifier, 10) - Number.parseInt(rightIdentifier, 10);

      if (numericDelta !== 0) {
        return numericDelta;
      }

      continue;
    }

    if (leftIsNumeric !== rightIsNumeric) {
      return leftIsNumeric ? -1 : 1;
    }

    const identifierDelta = branchNameCollator.compare(leftIdentifier, rightIdentifier);

    if (identifierDelta !== 0) {
      return identifierDelta;
    }
  }

  return 0;
}

function isNumericIdentifier(value: string): boolean {
  return /^\d+$/u.test(value);
}
