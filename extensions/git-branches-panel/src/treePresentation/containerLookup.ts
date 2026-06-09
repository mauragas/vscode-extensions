import type { BranchTreeNode, TreeBranch } from '../branchModel/types';
import type { TreeContainerNode } from './types';

export function getContainerNodeKey(node: TreeContainerNode): string {
  if (node.kind === 'repository') {
    return node.path;
  }

  if (node.kind === 'section') {
    return node.repoRoot ? `repo:${node.repoRoot}:${node.path}` : node.path;
  }

  return node.repoRoot
    ? `repo:${node.repoRoot}:folder:${node.scope}:${node.path}`
    : `folder:${node.scope}:${node.path}`;
}

export function findContainerNode(
  nodes: readonly BranchTreeNode[],
  containerKey: string
): TreeContainerNode | undefined {
  for (const node of nodes) {
    if (node.kind === 'branch') {
      continue;
    }

    if (getContainerNodeKey(node) === containerKey) {
      return node;
    }

    const nestedMatch = findContainerNode(node.children, containerKey);
    if (nestedMatch) {
      return nestedMatch;
    }
  }

  return undefined;
}

export function collectDescendantBranches(node: TreeContainerNode): TreeBranch[] {
  const descendants: TreeBranch[] = [];

  for (const child of node.children) {
    if (child.kind === 'branch') {
      descendants.push(child);
      continue;
    }

    descendants.push(...collectDescendantBranches(child));
  }

  return descendants;
}

export function findDescendantBranches(
  nodes: readonly BranchTreeNode[],
  containerKey: string
): TreeBranch[] {
  const container = findContainerNode(nodes, containerKey);
  return container ? collectDescendantBranches(container) : [];
}
