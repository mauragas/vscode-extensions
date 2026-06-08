import { type BranchInfo } from '../branchModel';
import { runGit } from './shared';

interface ParsedWorktreeRecord {
  worktreePath: string;
  head?: string;
  branchRef?: string;
  detached: boolean;
  bare: boolean;
  lockedReason?: string;
  prunableReason?: string;
}

export async function getWorktrees(repoRoot: string): Promise<BranchInfo[]> {
  const { stdout } = await runGit(repoRoot, ['worktree', 'list', '--porcelain']);

  return parseWorktreeRecords(stdout).map((record) => ({
    name: record.worktreePath,
    isCurrent: record.worktreePath === repoRoot,
    scope: 'worktree',
    worktreePath: record.worktreePath,
    worktreeRef: formatWorktreeReference(record),
    worktreeIsBare: record.bare || undefined,
    worktreeLockedReason: record.lockedReason,
    worktreePrunableReason: record.prunableReason,
  }) satisfies BranchInfo);
}

export async function removeWorktree(
  repoRoot: string,
  worktreePath: string,
  force = false
): Promise<void> {
  await runGit(repoRoot, ['worktree', 'remove', ...(force ? ['--force'] : []), worktreePath]);
}

export async function renameWorktree(
  repoRoot: string,
  worktreePath: string,
  newWorktreePath: string
): Promise<void> {
  await runGit(repoRoot, ['worktree', 'move', worktreePath, newWorktreePath]);
}

export async function createWorktree(
  repoRoot: string,
  worktreePath: string,
  refName: string,
  options: {
    detach?: boolean;
  } = {}
): Promise<void> {
  const baseArgs = ['worktree', 'add'];
  if (options.detach ?? false) {
    baseArgs.push('--detach');
  }

  const args = [...baseArgs, worktreePath, refName];

  try {
    await runGit(repoRoot, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if ((options.detach ?? false) || !looksLikeBranchAlreadyCheckedOutError(message)) {
      throw error;
    }

    await runGit(repoRoot, ['worktree', 'add', '--force', worktreePath, refName]);
  }
}

function parseWorktreeRecords(stdout: string): ParsedWorktreeRecord[] {
  const records: ParsedWorktreeRecord[] = [];
  let currentRecord: ParsedWorktreeRecord | undefined;

  for (const rawLine of stdout.split(/\r?\n/u)) {
    const line = rawLine.trimEnd();
    if (!line) {
      continue;
    }

    if (line.startsWith('worktree ')) {
      if (currentRecord) {
        records.push(currentRecord);
      }

      currentRecord = {
        worktreePath: line.slice('worktree '.length),
        detached: false,
        bare: false,
      };
      continue;
    }

    if (!currentRecord) {
      continue;
    }

    if (line.startsWith('HEAD ')) {
      currentRecord.head = line.slice('HEAD '.length);
      continue;
    }

    if (line.startsWith('branch ')) {
      currentRecord.branchRef = line.slice('branch '.length);
      continue;
    }

    if (line === 'detached') {
      currentRecord.detached = true;
      continue;
    }

    if (line === 'bare') {
      currentRecord.bare = true;
      continue;
    }

    if (line.startsWith('locked')) {
      currentRecord.lockedReason = line.slice('locked'.length).trim() || 'locked';
      continue;
    }

    if (line.startsWith('prunable')) {
      currentRecord.prunableReason = line.slice('prunable'.length).trim() || 'prunable';
    }
  }

  if (currentRecord) {
    records.push(currentRecord);
  }

  return records;
}

function formatWorktreeReference(record: ParsedWorktreeRecord): string {
  if (record.branchRef?.startsWith('refs/heads/')) {
    return record.branchRef.slice('refs/heads/'.length);
  }

  if (record.detached) {
    return record.head ? `detached at ${record.head.slice(0, 7)}` : 'detached';
  }

  if (record.bare) {
    return 'bare';
  }

  return record.head ? record.head.slice(0, 7) : '';
}

function looksLikeBranchAlreadyCheckedOutError(message: string): boolean {
  return /already used by worktree/i.test(message);
}
