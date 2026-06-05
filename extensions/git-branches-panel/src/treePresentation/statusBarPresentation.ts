import { formatSyncStatus } from '../branchModel/descriptions';
import type { BranchInfo } from '../branchModel/types';

export function buildStatusBarText(branch: BranchInfo | undefined): string {
  if (!branch) {
    return '';
  }

  const syncStatus = formatSyncStatus(branch);

  return syncStatus ? `$(git-branch) ${branch.name} ${syncStatus}` : `$(git-branch) ${branch.name}`;
}

export function buildStatusBarTooltipContent(branch: BranchInfo): string {
  const tooltipLines = [`**Current branch:** ${branch.name}`];
  const syncStatus = formatSyncStatus(branch);

  if (branch.upstreamName) {
    tooltipLines.push('', `Upstream: ${branch.upstreamName}`);
  }

  if (branch.upstreamMissing) {
    tooltipLines.push('', '_Tracked upstream no longer exists_');
  } else if (syncStatus) {
    tooltipLines.push('', `Sync state: ${syncStatus}`);
  } else {
    tooltipLines.push('', 'Sync state: up to date');
  }

  tooltipLines.push('', 'Click to sync the current branch with its remote.');

  return tooltipLines.join('\n');
}
