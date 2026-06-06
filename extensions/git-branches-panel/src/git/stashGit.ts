import { type BranchInfo } from '../branchModel';
import { runGit } from './shared';

const GIT_RECORD_SEPARATOR = '\u001e';
const GIT_FIELD_SEPARATOR = '\u001f';
const STASH_OUTPUT_FORMAT = [
  '%gd',
  '%cr',
  '%ct',
  '%gs',
].join(`${GIT_FIELD_SEPARATOR}`) + GIT_RECORD_SEPARATOR;

export async function getStashes(repoRoot: string): Promise<BranchInfo[]> {
  const { stdout } = await runGit(repoRoot, ['stash', 'list', `--format=${STASH_OUTPUT_FORMAT}`]);

  return stdout
    .split(GIT_RECORD_SEPARATOR)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [name = '', lastCommitDate = '', lastCommitTimestamp = '', lastCommit = ''] =
        record.split(GIT_FIELD_SEPARATOR);

      return {
        name,
        isCurrent: false,
        scope: 'stash',
        lastCommitDate,
        lastCommitTimestamp: Number.isFinite(Number(lastCommitTimestamp))
          ? Number(lastCommitTimestamp)
          : undefined,
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

export async function stashSilently(repoRoot: string): Promise<boolean> {
  const { stdout } = await runGit(repoRoot, ['status', '--porcelain', '--untracked-files=all']);

  if (!stdout.trim()) {
    return false;
  }

  await runGit(repoRoot, ['stash', 'push', '--include-untracked']);
  return true;
}
