export type {
  BranchInfo,
  HookSource,
  RemoteConfigInfo,
  RemoteTrackingState,
  BranchSortOrder,
  TagSortOrder,
  BranchSyncState,
  TreeRepository,
  BranchTreeNode,
  TreeContainerScope,
  TreeBranch,
  TreeRemote,
  TreeChildNode,
  TreeFolder,
  TreeSection,
} from './branchModel/types';

export {
  buildBranchDescription,
  canUpdateFromSourceBranch,
  formatSourceBranchStatus,
  formatSyncStatus,
  getPublishTargetName,
  hasSourceBranchUpdate,
  isPublishableBranch,
  isTrackedBranch,
  parseUpstreamTrack,
} from './branchModel/descriptions';

export {
  buildRepositoryNode,
  buildBranchSections,
  buildBranchTree,
  buildRemoteTree,
  findFolderNode,
  sortBranches,
} from './branchModel/treeBuilder';
