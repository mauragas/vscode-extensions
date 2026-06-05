import type { BranchTreeNode } from '../branchModel/types';
import type { TreeContainerNode } from './types';

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
