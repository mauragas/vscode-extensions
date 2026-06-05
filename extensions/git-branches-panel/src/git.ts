import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { parseUpstreamTrack, type BranchInfo } from './branchModel';

const execFileAsync = promisify(execFile);
const GIT_RECORD_SEPARATOR = '\u001e';
const GIT_FIELD_SEPARATOR = '\u001f';
const GIT_OUTPUT_FORMAT = [
  '%(refname:short)',
  '%(HEAD)',
  '%(committerdate:relative)',
  '%(committerdate:unix)',
  '%(subject)',
  '%(upstream:short)',
  '%(upstream:track,nobracket)',
].join(`${GIT_FIELD_SEPARATOR}`) + GIT_RECORD_SEPARATOR;

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

export async function getRepoRoot(workspaceFolder: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
      cwd: workspaceFolder,
      encoding: 'utf8',
    });

    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function getBranches(repoRoot: string): Promise<BranchInfo[]> {
  const { stdout } = await runGit(repoRoot, [
    'for-each-ref',
    '--sort=-committerdate',
    `--format=${GIT_OUTPUT_FORMAT}`,
    'refs/heads',
  ]);

  return stdout
    .split(GIT_RECORD_SEPARATOR)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [
        name = '',
        headMarker = '',
        lastCommitDate = '',
        lastCommitTimestamp = '',
        lastCommit = '',
        upstreamName = '',
        upstreamTrack = '',
      ] =
        record.split(GIT_FIELD_SEPARATOR);
      const syncState = parseUpstreamTrack(upstreamTrack);

      return {
        name,
        isCurrent: headMarker === '*',
        lastCommitDate,
        lastCommitTimestamp: Number.isFinite(Number(lastCommitTimestamp))
          ? Number(lastCommitTimestamp)
          : undefined,
        lastCommit,
        upstreamName: upstreamName || undefined,
        aheadCount: syncState.aheadCount,
        behindCount: syncState.behindCount,
        upstreamMissing: syncState.upstreamMissing,
      } satisfies BranchInfo;
    });
}

export async function fetchRemoteState(repoRoot: string): Promise<void> {
  await runGit(repoRoot, ['fetch', '--all', '--prune']);
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

export async function syncBranch(repoRoot: string, branchName: string): Promise<SyncBranchResult> {
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

  const shouldSetUpstream = !syncTarget.hasConfiguredUpstream || branch.upstreamMissing || !remoteBranchExists;
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

export async function mergeBranchIntoCurrent(repoRoot: string, branchName: string): Promise<void> {
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

async function readGitConfig(repoRoot: string, key: string): Promise<string | null> {
  try {
    const { stdout } = await runGit(repoRoot, ['config', '--get', key]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function ensureRemoteExists(repoRoot: string, remoteName: string): Promise<void> {
  try {
    await runGit(repoRoot, ['remote', 'get-url', remoteName]);
  } catch {
    throw new Error(`Remote '${remoteName}' was not found.`);
  }
}

async function doesRemoteBranchExist(
  repoRoot: string,
  remoteName: string,
  remoteBranchName: string
): Promise<boolean> {
  try {
    await runGit(repoRoot, ['show-ref', '--verify', '--quiet', `refs/remotes/${remoteName}/${remoteBranchName}`]);
    return true;
  } catch {
    return false;
  }
}

async function getAheadBehindCounts(
  repoRoot: string,
  localRef: string,
  remoteRef: string
): Promise<{ aheadCount: number; behindCount: number }> {
  const { stdout } = await runGit(repoRoot, ['rev-list', '--left-right', '--count', `${localRef}...${remoteRef}`]);
  const [aheadCount = '0', behindCount = '0'] = stdout.trim().split(/\s+/u);

  return {
    aheadCount: Number(aheadCount) || 0,
    behindCount: Number(behindCount) || 0,
  };
}

async function runGit(workingDirectory: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync('git', args, {
      cwd: workingDirectory,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    const message = getErrorMessage(error);
    throw new Error(message);
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown git error';
}
