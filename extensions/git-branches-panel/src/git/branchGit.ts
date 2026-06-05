import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

interface BranchSyncTarget {
  remoteName: string;
  remoteBranchName: string;
  upstreamName: string;
  hasConfiguredUpstream: boolean;
}

export async function getBranches(repoRoot: string) {
  return listRefs(repoRoot, 'refs/heads', 'local');
}

export async function checkoutBranch(repoRoot: string, branchName: string): Promise<void> {
  await runGit(repoRoot, ['checkout', branchName]);
}

export async function createBranch(repoRoot: string, branchName: string): Promise<void> {
  await runGit(repoRoot, ['checkout', '-b', branchName]);
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
  branchName: string
): Promise<SyncBranchResult> {
  await fetchRemoteState(repoRoot);

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

  const shouldSetUpstream =
    !syncTarget.hasConfiguredUpstream || branch.upstreamMissing || !remoteBranchExists;
  const shouldPull = remoteBranchExists && syncCounts.behindCount > 0;
  const shouldPush = syncCounts.aheadCount > 0 || shouldSetUpstream;

  if (branch.isCurrent) {
    if (shouldPull) {
      await pullBranch(repoRoot, syncTarget, syncCounts.aheadCount > 0, true);
    }

    if (shouldPush) {
      await pushBranch(repoRoot, branch.name, syncTarget, shouldSetUpstream);
    }
  } else {
    await syncNonCurrentBranch(repoRoot, branch.name, syncTarget, {
      shouldPull,
      shouldPush,
      hasOutgoingCommits: syncCounts.aheadCount > 0,
      shouldSetUpstream,
    });
  }

  return {
    branchName: branch.name,
    upstreamName: syncTarget.upstreamName,
    didPull: shouldPull,
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
    await runGit(repoRoot, ['worktree', 'add', worktreePath, branchName]);

    if (syncPlan.shouldPull) {
      await pullBranch(worktreePath, syncTarget, syncPlan.hasOutgoingCommits, false);
    }

    if (syncPlan.shouldPush) {
      await pushBranch(worktreePath, branchName, syncTarget, syncPlan.shouldSetUpstream);
    }
  } finally {
    try {
      await runGit(repoRoot, ['worktree', 'remove', '--force', worktreePath]);
    } finally {
      await rm(worktreePath, { recursive: true, force: true });
    }
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

async function pushBranch(
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
