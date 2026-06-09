import type { RemoteTrackingState } from '../branchModel';
import type { RemoteInfo } from './hosting';
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

export interface DeleteRemoteBranchOptions {
  skipPushHooks?: boolean;
}

export async function getRemoteDetails(repoRoot: string): Promise<RemoteInfo[]> {
  const { stdout } = await runGit(repoRoot, ['remote', '-v']);
  const remotesByName = new Map<string, RemoteInfo>();

  for (const rawLine of stdout.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/u);
    if (!match) {
      continue;
    }

    const [, name = '', url = '', type = 'fetch'] = match;
    const existingRemote = remotesByName.get(name) ?? {
      name,
      fetchUrl: '',
      pushUrl: '',
    };

    if (type === 'fetch') {
      existingRemote.fetchUrl = url;
      if (!existingRemote.pushUrl) {
        existingRemote.pushUrl = url;
      }
    } else {
      existingRemote.pushUrl = url;
      if (!existingRemote.fetchUrl) {
        existingRemote.fetchUrl = url;
      }
    }

    remotesByName.set(name, existingRemote);
  }

  return [...remotesByName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export async function getRemoteBranches(repoRoot: string) {
  const [branches, remotes] = await Promise.all([
    listRefs(repoRoot, 'refs/remotes', 'remote'),
    getRemotes(repoRoot),
  ]);
  const configuredRemotes = new Set(remotes);

  return branches.filter(
    (branch) => branch.name.includes('/') && !branch.name.endsWith('/HEAD')
  ).map((branch) => ({
    ...branch,
    remoteTrackingState: resolveRemoteTrackingState(configuredRemotes, branch.remoteName),
  }));
}

export async function getRemoteBranchTrackingState(
  repoRoot: string,
  remoteBranchName: string
): Promise<RemoteTrackingState> {
  const remoteBranchRef = parseRemoteBranchReference(remoteBranchName);
  if (!remoteBranchRef) {
    throw new Error(`Remote branch '${remoteBranchName}' is invalid.`);
  }

  const remotes = await getRemotes(repoRoot);
  return resolveRemoteTrackingState(new Set(remotes), remoteBranchRef.remoteName);
}

export async function removeRemoteTrackingRef(
  repoRoot: string,
  remoteBranchName: string
): Promise<void> {
  const remoteBranchRef = parseRemoteBranchReference(remoteBranchName);
  if (!remoteBranchRef) {
    throw new Error(`Remote branch '${remoteBranchName}' is invalid.`);
  }

  await runGit(repoRoot, [
    'update-ref',
    '-d',
    `refs/remotes/${remoteBranchRef.remoteName}/${remoteBranchRef.branchName}`,
  ]);
}

export async function getRemotes(repoRoot: string): Promise<string[]> {
  return (await getRemoteDetails(repoRoot)).map((remote) => remote.name);
}

export async function getRemoteDefaultBranch(
  repoRoot: string,
  remoteName: string
): Promise<string | undefined> {
  try {
    const { stdout } = await runGit(repoRoot, [
      'symbolic-ref',
      '--short',
      `refs/remotes/${remoteName}/HEAD`,
    ]);
    const normalizedReference = stdout.trim();
    const prefix = `${remoteName}/`;

    return normalizedReference.startsWith(prefix)
      ? normalizedReference.slice(prefix.length)
      : normalizedReference;
  } catch {
    return undefined;
  }
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
  remoteBranchName: string,
  options: DeleteRemoteBranchOptions = {}
): Promise<void> {
  const remoteBranchRef = parseRemoteBranchReference(remoteBranchName);
  if (!remoteBranchRef) {
    throw new Error(`Remote branch '${remoteBranchName}' is invalid.`);
  }

  await ensureRemoteExists(repoRoot, remoteBranchRef.remoteName);
  const args = ['push'];

  if (options.skipPushHooks ?? false) {
    args.push('--no-verify');
  }

  args.push(remoteBranchRef.remoteName, '--delete', remoteBranchRef.branchName);
  await runGit(repoRoot, args);
}

export async function fetchRemoteState(repoRoot: string): Promise<void> {
  await runGit(repoRoot, ['fetch', '--all', '--prune']);
}

export async function fetchAllRemotes(repoRoot: string): Promise<void> {
  await runGit(repoRoot, ['fetch', '--all']);
}

export { parseRemoteBranchReference };
export type { RemoteBranchReference };

function resolveRemoteTrackingState(
  configuredRemotes: ReadonlySet<string>,
  remoteName?: string
): RemoteTrackingState {
  return remoteName && configuredRemotes.has(remoteName) ? 'live' : 'stale';
}
