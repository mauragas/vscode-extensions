import type { BranchItemActivationTracker } from './extensionHelpers';
import type { BranchLoadOptions } from './treeProvider';
import type { BranchTreeProvider } from './treeProvider';

export async function resetTrackerAndRefresh(
  provider: BranchTreeProvider,
  activationTracker: BranchItemActivationTracker,
  options: BranchLoadOptions = {}
): Promise<void> {
  activationTracker.reset();
  await provider.refresh(options);
}
