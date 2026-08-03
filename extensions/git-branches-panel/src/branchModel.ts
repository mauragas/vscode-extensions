export type {
  BranchInfo,
  CreatedFromDisplayKind,
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
  getCreatedFromLabel,
  getCreatedFromReferenceDescription,
  getCreatedFromStatusLabel,
  getPublishTargetName,
  getUpdateFromSourceActionLabel,
  hasSourceBranchUpdate,
  isInferredCreatedFrom,
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
