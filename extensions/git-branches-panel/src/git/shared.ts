import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { getErrorMessage } from '../errorUtils';

const execFileAsync = promisify(execFile);

export interface RemoteBranchReference {
  remoteName: string;
  branchName: string;
  fullName: string;
}

export function parseRemoteBranchReference(
  remoteBranchName: string
): RemoteBranchReference | null {
  const [remoteName, ...branchSegments] = remoteBranchName.split('/');
  const branchName = branchSegments.join('/').trim();

  if (!remoteName || !branchName) {
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
