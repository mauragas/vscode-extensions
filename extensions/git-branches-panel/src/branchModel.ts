export type {
  BranchInfo,
  RemoteTrackingState,
  BranchSortOrder,
  TagSortOrder,
  BranchSyncState,
  BranchTreeNode,
  TreeContainerScope,
  TreeBranch,
  TreeChildNode,
  TreeFolder,
  TreeSection,
} from './branchModel/types';

export {
  buildBranchDescription,
  formatSyncStatus,
  getPublishTargetName,
  isPublishableBranch,
  isTrackedBranch,
  parseUpstreamTrack,
} from './branchModel/descriptions';

export {
  buildBranchSections,
  buildBranchTree,
  findFolderNode,
  sortBranches,
} from './branchModel/treeBuilder';
