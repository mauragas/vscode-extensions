export type {
  BranchInfo,
  HookSource,
  RemoteTrackingState,
  BranchSortOrder,
  TagSortOrder,
  BranchSyncState,
  TreeRepository,
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
  buildRepositoryNode,
  buildBranchSections,
  buildBranchTree,
  findFolderNode,
  sortBranches,
} from './branchModel/treeBuilder';
