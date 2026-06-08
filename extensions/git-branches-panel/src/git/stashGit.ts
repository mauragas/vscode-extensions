import { type BranchInfo } from '../branchModel';
import { getErrorMessage } from '../errorUtils';
import { runGit } from './shared';

const GIT_RECORD_SEPARATOR = '\u001e';
const GIT_FIELD_SEPARATOR = '\u001f';
const STASH_OUTPUT_FORMAT = [
  '%gd',
  '%cr',
  '%ct',
  '%H',
  '%gs',
].join(`${GIT_FIELD_SEPARATOR}`) + GIT_RECORD_SEPARATOR;

export async function getStashes(repoRoot: string): Promise<BranchInfo[]> {
  const { stdout } = await runGit(repoRoot, ['stash', 'list', `--format=${STASH_OUTPUT_FORMAT}`]);

  return stdout
    .split(GIT_RECORD_SEPARATOR)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [
        name = '',
        lastCommitDate = '',
        lastCommitTimestamp = '',
        stashRevision = '',
        lastCommit = '',
      ] =
        record.split(GIT_FIELD_SEPARATOR);

      return {
        name,
        isCurrent: false,
        scope: 'stash',
        lastCommitDate,
        lastCommitTimestamp: Number.isFinite(Number(lastCommitTimestamp))
          ? Number(lastCommitTimestamp)
          : undefined,
        stashRevision: stashRevision || undefined,
        lastCommit,
      } satisfies BranchInfo;
    });
}

export async function applyStash(repoRoot: string, stashName: string): Promise<void> {
  await runGit(repoRoot, ['stash', 'apply', stashName]);
}

export async function popStash(repoRoot: string, stashName: string): Promise<void> {
  await runGit(repoRoot, ['stash', 'pop', stashName]);
}

export async function dropStash(repoRoot: string, stashName: string): Promise<void> {
  await runGit(repoRoot, ['stash', 'drop', stashName]);
}

export async function dropAllStashes(repoRoot: string): Promise<void> {
  await runGit(repoRoot, ['stash', 'clear']);
}

export async function renameStash(
  repoRoot: string,
  stashIdentifier: string,
  newMessage: string
): Promise<void> {
  const normalizedMessage = newMessage.trim();
  if (!normalizedMessage) {
    throw new Error('Stash message cannot be empty.');
  }

  const stashes = await getStashes(repoRoot);
  const targetStash = stashes.find(
    (stash) => stash.name === stashIdentifier || stash.stashRevision === stashIdentifier
  );
  if (!targetStash?.stashRevision) {
    throw new Error(`Stash '${stashIdentifier}' was not found.`);
  }

  const originalEntries = stashes.map(toStoredStashEntry);
  const renamedEntries = originalEntries.map((entry) =>
    entry.revision === targetStash.stashRevision
      ? {
          ...entry,
          message: buildRenamedStashMessage(targetStash.lastCommit, normalizedMessage),
        }
      : entry
  );

  try {
    await rebuildStashStack(repoRoot, renamedEntries);
  } catch (error) {
    try {
      await rebuildStashStack(repoRoot, originalEntries);
    } catch (restoreError) {
      throw new Error(
        `${getErrorMessage(error)} Failed to restore original stashes: ${getErrorMessage(restoreError)}`
      );
    }

    throw error;
  }
}

export async function stashAllChanges(
  repoRoot: string,
  message?: string
): Promise<boolean> {
  return createStash(repoRoot, {
    includeUntracked: true,
    message,
  });
}

export async function stashSilently(repoRoot: string): Promise<boolean> {
  return stashAllChanges(repoRoot);
}

export async function stashStagedChanges(
  repoRoot: string,
  message?: string
): Promise<boolean> {
  return createStash(repoRoot, {
    staged: true,
    message,
  });
}

export async function stashStagedSilently(repoRoot: string): Promise<boolean> {
  return stashStagedChanges(repoRoot);
}

interface CreateStashOptions {
  readonly includeUntracked?: boolean;
  readonly staged?: boolean;
  readonly message?: string;
}

interface StoredStashEntry {
  readonly revision: string;
  readonly message: string;
}

async function createStash(repoRoot: string, options: CreateStashOptions): Promise<boolean> {
  const hasStashableChanges = options.staged
    ? await hasStagedChanges(repoRoot)
    : await hasWorkingTreeChanges(repoRoot);

  if (!hasStashableChanges) {
    return false;
  }

  const args = ['stash', 'push'];

  if (options.staged) {
    args.push('--staged');
  }

  if (options.includeUntracked) {
    args.push('--include-untracked');
  }

  const message = options.message?.trim();
  if (message) {
    args.push('--message', message);
  }

  await runGit(repoRoot, args);
  return true;
}

async function hasWorkingTreeChanges(repoRoot: string): Promise<boolean> {
  const { stdout } = await runGit(repoRoot, ['status', '--porcelain', '--untracked-files=all']);
  return Boolean(stdout.trim());
}

async function hasStagedChanges(repoRoot: string): Promise<boolean> {
  const { stdout } = await runGit(repoRoot, ['diff', '--cached', '--name-only', '--no-ext-diff']);
  return Boolean(stdout.trim());
}

function toStoredStashEntry(stash: BranchInfo): StoredStashEntry {
  if (!stash.stashRevision) {
    throw new Error(`Stash '${stash.name}' is missing its revision.`);
  }

  return {
    revision: stash.stashRevision,
    message: stash.lastCommit || stash.name,
  };
}

function buildRenamedStashMessage(currentMessage: string | undefined, newMessage: string): string {
  const prefixMatch = currentMessage?.match(/^(?:WIP on|On) ([^:]+):/u);
  if (prefixMatch?.[1]) {
    return `On ${prefixMatch[1]}: ${newMessage}`;
  }

  return newMessage;
}

async function rebuildStashStack(
  repoRoot: string,
  entries: readonly StoredStashEntry[]
): Promise<void> {
  await runGit(repoRoot, ['stash', 'clear']);

  for (const entry of [...entries].reverse()) {
    await runGit(repoRoot, ['stash', 'store', '-m', entry.message, entry.revision]);
  }
}
