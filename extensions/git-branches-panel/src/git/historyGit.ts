import { runGit } from './shared';
import type { RefComparisonChange } from './branchGit';

export interface RefHistoryEntry {
  sha: string;
  shortSha: string;
  authorName: string;
  authorEmail: string;
  authorTimestamp: number;
  authorRelativeDate: string;
  subject: string;
  body: string;
  parentShas: string[];
}

export interface RefHistoryOptions {
  limit?: number;
  includeMerges?: boolean;
}

const RECORD_SEPARATOR = '\u001e';
const FIELD_SEPARATOR = '\u001f';

export async function getRefHistory(
  repoRoot: string,
  ref: string,
  options: RefHistoryOptions = {}
): Promise<RefHistoryEntry[]> {
  const args = ['log'];

  if (options.includeMerges === false) {
    args.push('--no-merges');
  }

  if (options.limit && options.limit > 0) {
    args.push('-n', `${options.limit}`);
  }

  args.push(
    `--format=${RECORD_SEPARATOR}%H${FIELD_SEPARATOR}%h${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%ae${FIELD_SEPARATOR}%at${FIELD_SEPARATOR}%ar${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%b${FIELD_SEPARATOR}%P`,
    ref,
    '--'
  );

  const { stdout } = await runGit(repoRoot, args);
  return parseRefHistory(stdout);
}

export async function getCommitDetails(
  repoRoot: string,
  commitSha: string
): Promise<RefHistoryEntry | undefined> {
  return (await getRefHistory(repoRoot, commitSha, { limit: 1, includeMerges: true }))[0];
}

export async function getChangedFilesForCommit(
  repoRoot: string,
  commitSha: string
): Promise<RefComparisonChange[]> {
  const { stdout } = await runGit(repoRoot, [
    'diff-tree',
    '--root',
    '--no-commit-id',
    '--name-status',
    '--find-renames',
    '--diff-filter=ADMR',
    '-r',
    '-z',
    commitSha,
    '--',
  ]);

  return parseRefComparison(stdout);
}

function parseRefHistory(stdout: string): RefHistoryEntry[] {
  return stdout
    .split(RECORD_SEPARATOR)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [
        sha = '',
        shortSha = '',
        authorName = '',
        authorEmail = '',
        authorTimestamp = '0',
        authorRelativeDate = '',
        subject = '',
        body = '',
        parentShas = '',
      ] = entry.split(FIELD_SEPARATOR);

      return {
        sha,
        shortSha,
        authorName,
        authorEmail,
        authorTimestamp: Number.parseInt(authorTimestamp, 10) || 0,
        authorRelativeDate,
        subject,
        body: body.trimEnd(),
        parentShas: parentShas.trim().split(/\s+/u).filter(Boolean),
      } satisfies RefHistoryEntry;
    });
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
