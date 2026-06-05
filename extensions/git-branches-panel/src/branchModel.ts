export type {
  BranchInfo,
  BranchSortOrder,
  BranchSyncState,
  BranchTreeNode,
  TreeBranch,
  TreeChildNode,
  TreeFolder,
  TreeSection,
} from './branchModel/types';

export {
  buildBranchDescription,
  formatSyncStatus,
  parseUpstreamTrack,
} from './branchModel/descriptions';

export {
  buildBranchSections,
  buildBranchTree,
  findFolderNode,
  sortBranches,
} from './branchModel/treeBuilder';
