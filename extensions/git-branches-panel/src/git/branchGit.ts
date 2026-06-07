import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isTrackedBranch } from '../branchModel';
import { listRefs } from './refListing';
import { fetchRemoteState } from './remoteGit';
import {
  doesRemoteBranchExist,
  ensureRemoteExists,
  getAheadBehindCounts,
  readGitConfig,
  runGit,
} from './shared';

export interface SyncBranchResult {
  branchName: string;
  upstreamName: string;
  didPull: boolean;
  didPush: boolean;
  publishedUpstream: boolean;
}

export interface SyncBranchOptions {
  refreshRemoteState?: boolean;
}

export interface CreateBranchFromRefOptions {
  checkout?: boolean;
}

export interface RefComparisonChange {
  status: 'A' | 'D' | 'M' | 'R';
  path: string;
  originalPath?: string;
}

interface BranchSyncTarget {
  remoteName: string;
  remoteBranchName: string;
  upstreamName: string;
  hasConfiguredUpstream: boolean;
}

interface BranchRemoteState {
  branch: Awaited<ReturnType<typeof getBranches>>[number];
  syncTarget: BranchSyncTarget;
  remoteBranchExists: boolean;
  syncCounts: {
    aheadCount: number;
    behindCount: number;
  };
}

export async function getBranches(repoRoot: string) {
  return listRefs(repoRoot, 'refs/heads', 'local');
}

export async function checkoutBranch(repoRoot: string, branchName: string): Promise<void> {
  await runGit(repoRoot, ['checkout', branchName]);
}

export async function createBranch(repoRoot: string, branchName: string): Promise<void> {
  await createBranchFromRef(repoRoot, branchName, 'HEAD', { checkout: true });
}

export async function createBranchFromRef(
  repoRoot: string,
  branchName: string,
  startPoint: string,
  options: CreateBranchFromRefOptions = {}
): Promise<void> {
  if (options.checkout ?? false) {
    await runGit(repoRoot, ['checkout', '-b', branchName, startPoint]);
    return;
  }

  await runGit(repoRoot, ['branch', branchName, startPoint]);
}

export async function renameBranch(
  repoRoot: string,
  branchName: string,
  newBranchName: string
): Promise<void> {
  await runGit(repoRoot, ['branch', '-m', branchName, newBranchName]);
}

export async function deleteBranch(
  repoRoot: string,
  branchName: string,
  force: boolean
): Promise<void> {
  await runGit(repoRoot, ['branch', force ? '-D' : '-d', branchName]);
}

export async function syncBranch(
  repoRoot: string,
  branchName: string,
  options: SyncBranchOptions = {}
): Promise<SyncBranchResult> {
  if (options.refreshRemoteState ?? true) {
    await fetchRemoteState(repoRoot);
  }

  const { branch, syncTarget, remoteBranchExists, syncCounts } = await resolveBranchRemoteState(
    repoRoot,
    branchName
  );

  if (!branch.upstreamName) {
    throw new Error(`Branch '${branch.name}' is not tracking a remote branch yet. Publish it first.`);
  }

  if (!isTrackedBranch(branch) || !remoteBranchExists) {
    throw new Error(
      `Tracked upstream '${syncTarget.upstreamName}' for '${branch.name}' no longer exists. Publish the branch again to recreate it.`
    );
  }

  const shouldPull = syncCounts.behindCount > 0;
  const shouldPush = syncCounts.aheadCount > 0;

  if (branch.isCurrent) {
    if (shouldPull) {
      await pullBranch(repoRoot, syncTarget, syncCounts.aheadCount > 0, true);
    }

    if (shouldPush) {
      await pushBranchToRemote(repoRoot, branch.name, syncTarget, false);
    }
  } else {
    await syncNonCurrentBranch(repoRoot, branch.name, syncTarget, {
      shouldPull,
      shouldPush,
      hasOutgoingCommits: syncCounts.aheadCount > 0,
      shouldSetUpstream: false,
    });
  }

  return {
    branchName: branch.name,
    upstreamName: syncTarget.upstreamName,
    didPull: shouldPull,
    didPush: shouldPush,
    publishedUpstream: false,
  };
}

export async function pushBranch(
  repoRoot: string,
  branchName: string,
  options: SyncBranchOptions = {}
): Promise<SyncBranchResult> {
  if (options.refreshRemoteState ?? true) {
    await fetchRemoteState(repoRoot);
  }

  const { branch, syncTarget, remoteBranchExists, syncCounts } = await resolveBranchRemoteState(
    repoRoot,
    branchName
  );

  if (remoteBranchExists && syncCounts.behindCount > 0) {
    throw new Error(
      `Branch '${branch.name}' is behind '${syncTarget.upstreamName}'. Sync it before pushing.`
    );
  }

  const shouldSetUpstream =
    !syncTarget.hasConfiguredUpstream || branch.upstreamMissing || !remoteBranchExists;
  const shouldPush = syncCounts.aheadCount > 0 || shouldSetUpstream;

  if (branch.isCurrent) {
    if (shouldPush) {
      await pushBranchToRemote(repoRoot, branch.name, syncTarget, shouldSetUpstream);
    }
  } else {
    await syncNonCurrentBranch(repoRoot, branch.name, syncTarget, {
      shouldPull: false,
      shouldPush,
      hasOutgoingCommits: syncCounts.aheadCount > 0,
      shouldSetUpstream,
    });
  }

  return {
    branchName: branch.name,
    upstreamName: syncTarget.upstreamName,
    didPull: false,
    didPush: shouldPush,
    publishedUpstream: shouldSetUpstream,
  };
}

export async function mergeBranchIntoCurrent(
  repoRoot: string,
  branchName: string
): Promise<void> {
  await runGit(repoRoot, ['merge', '--no-edit', branchName]);
}

export async function cherryPickRef(
  repoRoot: string,
  refName: string
): Promise<void> {
  await runGit(repoRoot, ['cherry-pick', refName]);
}

export async function getDiffFilesBetweenRefs(
  repoRoot: string,
  leftRef: string,
  rightRef: string
): Promise<RefComparisonChange[]> {
  const { stdout } = await runGit(repoRoot, [
    'diff',
    '--name-status',
    '--find-renames',
    '--diff-filter=ADMR',
    '-z',
    `${leftRef}..${rightRef}`,
    '--',
  ]);

  return parseRefComparison(stdout);
}

async function syncNonCurrentBranch(
  repoRoot: string,
  branchName: string,
  syncTarget: BranchSyncTarget,
  syncPlan: {
    shouldPull: boolean;
    shouldPush: boolean;
    hasOutgoingCommits: boolean;
    shouldSetUpstream: boolean;
  }
): Promise<void> {
  const worktreePath = await mkdtemp(join(tmpdir(), 'git-branches-panel-'));

  try {
    await addTemporarySyncWorktree(repoRoot, worktreePath, branchName);

    if (syncPlan.shouldPull) {
      await pullBranch(worktreePath, syncTarget, syncPlan.hasOutgoingCommits, false);
    }

    if (syncPlan.shouldPush) {
      await pushBranchToRemote(worktreePath, branchName, syncTarget, syncPlan.shouldSetUpstream);
    }
  } finally {
    try {
      await runGit(repoRoot, ['worktree', 'remove', '--force', worktreePath]);
    } finally {
      await rm(worktreePath, { recursive: true, force: true });
    }
  }
}

async function addTemporarySyncWorktree(
  repoRoot: string,
  worktreePath: string,
  branchName: string
): Promise<void> {
  try {
    await runGit(repoRoot, ['worktree', 'add', worktreePath, branchName]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!looksLikeBranchAlreadyCheckedOutError(message)) {
      throw error;
    }

    await runGit(repoRoot, ['worktree', 'add', '--force', worktreePath, branchName]);
  }
}

async function pullBranch(
  workingDirectory: string,
  syncTarget: BranchSyncTarget,
  useRebase: boolean,
  allowAutostash: boolean
): Promise<void> {
  const args = ['pull'];

  if (useRebase) {
    args.push('--rebase');
    if (allowAutostash) {
      args.push('--autostash');
    }
  } else {
    args.push('--ff-only');
  }

  args.push(syncTarget.remoteName, syncTarget.remoteBranchName);

  await runGit(workingDirectory, args);
}

async function pushBranchToRemote(
  workingDirectory: string,
  branchName: string,
  syncTarget: BranchSyncTarget,
  setUpstream: boolean
): Promise<void> {
  const args = ['push'];

  if (setUpstream) {
    args.push('-u');
  }

  args.push(
    syncTarget.remoteName,
    `${branchName}:refs/heads/${syncTarget.remoteBranchName}`
  );

  await runGit(workingDirectory, args);
}

async function resolveBranchRemoteState(
  repoRoot: string,
  branchName: string
): Promise<BranchRemoteState> {
  const branches = await getBranches(repoRoot);
  const branch = branches.find((candidate) => candidate.name === branchName);
  if (!branch) {
    throw new Error(`Branch '${branchName}' was not found.`);
  }

  const syncTarget = await resolveBranchSyncTarget(repoRoot, branchName);
  await ensureRemoteExists(repoRoot, syncTarget.remoteName);

  const remoteBranchExists = await doesRemoteBranchExist(
    repoRoot,
    syncTarget.remoteName,
    syncTarget.remoteBranchName
  );

  const syncCounts = remoteBranchExists
    ? await getAheadBehindCounts(
        repoRoot,
        branch.name,
        `${syncTarget.remoteName}/${syncTarget.remoteBranchName}`
      )
    : {
        aheadCount: branch.aheadCount ?? 0,
        behindCount: branch.behindCount ?? 0,
      };

  return {
    branch,
    syncTarget,
    remoteBranchExists,
    syncCounts,
  };
}

async function resolveBranchSyncTarget(
  repoRoot: string,
  branchName: string
): Promise<BranchSyncTarget> {
  const remoteName = await readGitConfig(repoRoot, `branch.${branchName}.remote`);
  const mergeRef = await readGitConfig(repoRoot, `branch.${branchName}.merge`);

  if (remoteName && mergeRef?.startsWith('refs/heads/')) {
    const remoteBranchName = mergeRef.slice('refs/heads/'.length);

    return {
      remoteName,
      remoteBranchName,
      upstreamName: `${remoteName}/${remoteBranchName}`,
      hasConfiguredUpstream: true,
    };
  }

  return {
    remoteName: 'origin',
    remoteBranchName: branchName,
    upstreamName: `origin/${branchName}`,
    hasConfiguredUpstream: false,
  };
}

function looksLikeBranchAlreadyCheckedOutError(message: string): boolean {
  return /already used by worktree/i.test(message);
}

function parseRefComparison(stdout: string): RefComparisonChange[] {
  const entries = stdout.split('\u0000').filter(Boolean);
  const changes: RefComparisonChange[] = [];

  for (let index = 0; index < entries.length; ) {
    const rawStatus = entries[index] ?? '';
    const status = rawStatus[0];

    if (!status) {
      index += 1;
      continue;
    }

    if (status === 'R') {
      const originalPath = entries[index + 1];
      const path = entries[index + 2];
      if (originalPath && path) {
        changes.push({ status: 'R', originalPath, path });
      }
      index += 3;
      continue;
    }

    const path = entries[index + 1];
    if (path && (status === 'A' || status === 'D' || status === 'M')) {
      changes.push({ status, path });
    }

    index += 2;
  }

  return changes;
}
