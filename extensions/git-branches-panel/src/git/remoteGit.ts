import { listRefs } from './refListing';
import {
  doesLocalBranchExist,
  ensureRemoteExists,
  parseRemoteBranchReference,
  runGit,
  type RemoteBranchReference,
} from './shared';

export interface CheckoutRemoteBranchResult {
  localBranchName: string;
  remoteBranchName: string;
  createdLocalBranch: boolean;
}

export async function getRemoteBranches(repoRoot: string) {
  const branches = await listRefs(repoRoot, 'refs/remotes', 'remote');

  return branches.filter(
    (branch) => branch.name.includes('/') && !branch.name.endsWith('/HEAD')
  );
}

export async function getRemotes(repoRoot: string): Promise<string[]> {
  const { stdout } = await runGit(repoRoot, ['remote']);

  return stdout
    .split(/\r?\n/u)
    .map((remote) => remote.trim())
    .filter(Boolean);
}

export async function checkoutRemoteBranch(
  repoRoot: string,
  remoteBranchName: string
): Promise<CheckoutRemoteBranchResult> {
  const remoteBranchRef = parseRemoteBranchReference(remoteBranchName);
  if (!remoteBranchRef) {
    throw new Error(`Remote branch '${remoteBranchName}' is invalid.`);
  }

  if (await doesLocalBranchExist(repoRoot, remoteBranchRef.branchName)) {
    await runGit(repoRoot, ['checkout', remoteBranchRef.branchName]);
    return {
      localBranchName: remoteBranchRef.branchName,
      remoteBranchName: remoteBranchRef.fullName,
      createdLocalBranch: false,
    };
  }

  await runGit(repoRoot, [
    'checkout',
    '-b',
    remoteBranchRef.branchName,
    '--track',
    remoteBranchRef.fullName,
  ]);

  return {
    localBranchName: remoteBranchRef.branchName,
    remoteBranchName: remoteBranchRef.fullName,
    createdLocalBranch: true,
  };
}

export async function deleteRemoteBranch(
  repoRoot: string,
  remoteBranchName: string
): Promise<void> {
  const remoteBranchRef = parseRemoteBranchReference(remoteBranchName);
  if (!remoteBranchRef) {
    throw new Error(`Remote branch '${remoteBranchName}' is invalid.`);
  }

  await ensureRemoteExists(repoRoot, remoteBranchRef.remoteName);
  await runGit(repoRoot, [
    'push',
    remoteBranchRef.remoteName,
    '--delete',
    remoteBranchRef.branchName,
  ]);
}

export async function fetchRemoteState(repoRoot: string): Promise<void> {
  await runGit(repoRoot, ['fetch', '--all', '--prune']);
}

export async function fetchAllRemotes(repoRoot: string): Promise<void> {
  await runGit(repoRoot, ['fetch', '--all']);
}

export { parseRemoteBranchReference };
export type { RemoteBranchReference };
