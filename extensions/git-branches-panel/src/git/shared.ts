import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { getErrorMessage } from '../errorUtils';

const execFileAsync = promisify(execFile);

export interface RemoteBranchReference {
  remoteName: string;
  branchName: string;
  fullName: string;
}

export interface WorkingTreeStatus {
  hasStagedChanges: boolean;
  hasUnstagedChanges: boolean;
  hasUntrackedFiles: boolean;
  isDirty: boolean;
}

export interface GitOperationState {
  inProgress: boolean;
  type?: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'sequencer';
  message?: string;
}

export function parseRemoteBranchReference(
  remoteBranchName: string
): RemoteBranchReference | null {
  const [remoteName, ...branchSegments] = remoteBranchName.split('/');
  const branchName = branchSegments.join('/').trim();

  if (!remoteName || !branchName || branchName === 'HEAD') {
    return null;
  }

  return {
    remoteName,
    branchName,
    fullName: remoteBranchName,
  };
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

export async function runGit(
  workingDirectory: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync('git', args, {
      cwd: workingDirectory,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    const message = getErrorMessage(error, 'Unknown git error');
    throw new Error(message);
  }
}

export async function cleanRepository(repoRoot: string): Promise<void> {
  await runGit(repoRoot, ['clean', '-fdx']);
}

export async function ensureRemoteExists(
  repoRoot: string,
  remoteName: string
): Promise<void> {
  try {
    await runGit(repoRoot, ['remote', 'get-url', remoteName]);
  } catch {
    throw new Error(`Remote '${remoteName}' was not found.`);
  }
}

export async function doesRemoteBranchExist(
  repoRoot: string,
  remoteName: string,
  remoteBranchName: string
): Promise<boolean> {
  try {
    await runGit(repoRoot, [
      'show-ref',
      '--verify',
      '--quiet',
      `refs/remotes/${remoteName}/${remoteBranchName}`,
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function doesLocalBranchExist(
  repoRoot: string,
  branchName: string
): Promise<boolean> {
  try {
    await runGit(repoRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`]);
    return true;
  } catch {
    return false;
  }
}

export async function readGitConfig(
  repoRoot: string,
  key: string
): Promise<string | null> {
  try {
    const { stdout } = await runGit(repoRoot, ['config', '--get', key]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function getAheadBehindCounts(
  repoRoot: string,
  localRef: string,
  remoteRef: string
): Promise<{ aheadCount: number; behindCount: number }> {
  const { stdout } = await runGit(repoRoot, [
    'rev-list',
    '--left-right',
    '--count',
    `${localRef}...${remoteRef}`,
  ]);
  const [aheadCount = '0', behindCount = '0'] = stdout.trim().split(/\s+/u);

  return {
    aheadCount: Number(aheadCount) || 0,
    behindCount: Number(behindCount) || 0,
  };
}

export async function getWorkingTreeStatus(
  repoRoot: string
): Promise<WorkingTreeStatus> {
  const { stdout } = await runGit(repoRoot, ['status', '--porcelain=v1', '--untracked-files=all']);
  const entries = stdout
    .split(/\r?\n/u)
    .map((entry) => entry.trimEnd())
    .filter(Boolean);

  let hasStagedChanges = false;
  let hasUnstagedChanges = false;
  let hasUntrackedFiles = false;

  for (const entry of entries) {
    const indexStatus = entry[0] ?? ' ';
    const worktreeStatus = entry[1] ?? ' ';

    if (entry.startsWith('??')) {
      hasUntrackedFiles = true;
      continue;
    }

    if (indexStatus !== ' ') {
      hasStagedChanges = true;
    }

    if (worktreeStatus !== ' ') {
      hasUnstagedChanges = true;
    }
  }

  return {
    hasStagedChanges,
    hasUnstagedChanges,
    hasUntrackedFiles,
    isDirty: hasStagedChanges || hasUnstagedChanges || hasUntrackedFiles,
  };
}

export async function getGitOperationState(
  repoRoot: string
): Promise<GitOperationState> {
  const { stdout } = await runGit(repoRoot, ['rev-parse', '--absolute-git-dir']);
  const gitDir = stdout.trim();

  if (!gitDir) {
    return { inProgress: false };
  }

  const operationChecks: Array<{
    path: string;
    type: NonNullable<GitOperationState['type']>;
    message: string;
  }> = [
    {
      path: join(gitDir, 'rebase-merge'),
      type: 'rebase',
      message: 'A rebase is already in progress for this repository.',
    },
    {
      path: join(gitDir, 'rebase-apply'),
      type: 'rebase',
      message: 'A rebase is already in progress for this repository.',
    },
    {
      path: join(gitDir, 'MERGE_HEAD'),
      type: 'merge',
      message: 'A merge is already in progress for this repository.',
    },
    {
      path: join(gitDir, 'CHERRY_PICK_HEAD'),
      type: 'cherry-pick',
      message: 'A cherry-pick is already in progress for this repository.',
    },
    {
      path: join(gitDir, 'REVERT_HEAD'),
      type: 'revert',
      message: 'A revert is already in progress for this repository.',
    },
    {
      path: join(gitDir, 'sequencer'),
      type: 'sequencer',
      message: 'A Git sequencer operation is already in progress for this repository.',
    },
  ];

  for (const operationCheck of operationChecks) {
    if (await doesPathExist(operationCheck.path)) {
      return {
        inProgress: true,
        type: operationCheck.type,
        message: operationCheck.message,
      };
    }
  }

  return {
    inProgress: false,
  };
}

async function doesPathExist(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}
