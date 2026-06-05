export type {
  NodeType,
  TreeContainerNode,
  TreeItemCollapsibleKind,
  TreeItemCommandDescriptor,
  TreeItemIconDescriptor,
  TreeItemPresentation,
} from './treePresentation/types';

export {
  buildBranchTooltipContent,
  buildTreeItemPresentation,
} from './treePresentation/itemPresentation';

export {
  buildStatusBarText,
  buildStatusBarTooltipContent,
} from './treePresentation/statusBarPresentation';

export { findContainerNode } from './treePresentation/containerLookup';
