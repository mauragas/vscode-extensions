import type { BranchInfo, BranchSyncState } from './types';

export function parseUpstreamTrack(trackText: string): BranchSyncState {
  const normalizedTrackText = trackText.trim();
  if (!normalizedTrackText) {
    return {
      aheadCount: 0,
      behindCount: 0,
      upstreamMissing: false,
    };
  }

  if (normalizedTrackText === 'gone') {
    return {
      aheadCount: 0,
      behindCount: 0,
      upstreamMissing: true,
    };
  }

  const aheadMatch = normalizedTrackText.match(/ahead\s+(\d+)/i);
  const behindMatch = normalizedTrackText.match(/behind\s+(\d+)/i);

  return {
    aheadCount: aheadMatch ? Number(aheadMatch[1]) : 0,
    behindCount: behindMatch ? Number(behindMatch[1]) : 0,
    upstreamMissing: false,
  };
}

export function formatSyncStatus(
  syncState: Pick<BranchInfo, 'aheadCount' | 'behindCount'>
): string {
  const behindCount = syncState.behindCount ?? 0;
  const aheadCount = syncState.aheadCount ?? 0;
  const statusParts: string[] = [];

  if (behindCount > 0) {
    statusParts.push(`${behindCount}↓`);
  }

  if (aheadCount > 0) {
    statusParts.push(`${aheadCount}↑`);
  }

  return statusParts.join(' ');
}

export function isTrackedBranch(
  branch: Pick<BranchInfo, 'scope' | 'upstreamName' | 'upstreamMissing'>
): boolean {
  return (branch.scope ?? 'local') === 'local' && Boolean(branch.upstreamName) && !branch.upstreamMissing;
}

export function isPublishableBranch(
  branch: Pick<BranchInfo, 'scope' | 'upstreamName' | 'upstreamMissing'>
): boolean {
  return (branch.scope ?? 'local') === 'local' && !isTrackedBranch(branch);
}

export function getPublishTargetName(
  branch: Pick<BranchInfo, 'name' | 'upstreamName'>
): string {
  return branch.upstreamName ?? `origin/${branch.name}`;
}

export function buildBranchDescription(
  branch: Pick<
    BranchInfo,
    | 'aheadCount'
    | 'behindCount'
    | 'hookActive'
    | 'hookEnabled'
    | 'hookSource'
    | 'lastCommit'
    | 'lastCommitDate'
    | 'scope'
    | 'worktreeRef'
    | 'worktreeIsBare'
    | 'worktreeLockedReason'
    | 'worktreePrunableReason'
  >
): string {
  const descriptionParts = getDescriptionParts(branch);

  return descriptionParts.join(' • ');
}

function getDescriptionParts(
  branch: Pick<
    BranchInfo,
    | 'aheadCount'
    | 'behindCount'
    | 'hookActive'
    | 'hookEnabled'
    | 'hookSource'
    | 'lastCommit'
    | 'lastCommitDate'
    | 'scope'
    | 'worktreeRef'
    | 'worktreeIsBare'
    | 'worktreeLockedReason'
    | 'worktreePrunableReason'
  >
): string[] {
  switch (branch.scope) {
    case 'stash':
      return [branch.lastCommit ?? '', branch.lastCommitDate ?? ''].filter(Boolean);
    case 'hook':
      return [resolveHookStatus(branch), branch.hookSource ?? ''].filter(Boolean);
    case 'worktree':
      return [
        branch.worktreeRef ?? '',
        branch.worktreeIsBare ? 'bare' : '',
        branch.worktreeLockedReason ? 'locked' : '',
        branch.worktreePrunableReason ? 'prunable' : '',
      ].filter(Boolean);
    default:
      return [formatSyncStatus(branch), branch.lastCommitDate ?? ''].filter(Boolean);
  }
}

function resolveHookStatus(
  branch: Pick<BranchInfo, 'hookActive' | 'hookEnabled'>
): string {
  if (branch.hookActive) {
    return 'active';
  }

  if (branch.hookEnabled) {
    return 'inactive';
  }

  return 'disabled';
}
