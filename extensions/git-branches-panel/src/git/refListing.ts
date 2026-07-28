import { parseUpstreamTrack, type BranchInfo } from '../branchModel';
import {
  parseRemoteBranchReference,
  runGit,
} from './shared';

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

export async function listRefs(
  repoRoot: string,
  refPattern: string,
  scope: 'local' | 'remote' | 'tag'
): Promise<BranchInfo[]> {
  const currentTagNames = scope === 'tag' ? await getCurrentTagNames(repoRoot) : new Set<string>();
  const detachedHeadSha = scope === 'local' ? await getDetachedHeadSha(repoRoot) : null;
  const detachedHeadLocalBranches = detachedHeadSha ? await getLocalBranchesAtCommit(repoRoot, detachedHeadSha) : new Set<string>();
  const { stdout } = await runGit(repoRoot, [
    'for-each-ref',
    '--sort=-committerdate',
    `--format=${GIT_OUTPUT_FORMAT}`,
    refPattern,
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
      ] = record.split(GIT_FIELD_SEPARATOR);
      const syncState = parseUpstreamTrack(upstreamTrack);
      const remoteBranchRef = scope === 'remote' ? parseRemoteBranchReference(name) : null;

      return {
        name,
        isCurrent:
          scope === 'tag'
            ? currentTagNames.has(name)
            : scope === 'local' && (headMarker === '*' || detachedHeadLocalBranches.has(name)),
        scope,
        remoteName: remoteBranchRef?.remoteName,
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

async function getCurrentTagNames(repoRoot: string): Promise<Set<string>> {
  try {
    await runGit(repoRoot, ['symbolic-ref', '-q', 'HEAD']);
    return new Set<string>();
  } catch {
    const { stdout } = await runGit(repoRoot, ['tag', '--points-at', 'HEAD']);

    return new Set(
      stdout
        .split(/\r?\n/u)
        .map((tagName) => tagName.trim())
        .filter(Boolean)
    );
  }
}

async function getDetachedHeadSha(repoRoot: string): Promise<string | null> {
  try {
    await runGit(repoRoot, ['symbolic-ref', '-q', 'HEAD']);
    return null;
  } catch {
    const { stdout } = await runGit(repoRoot, ['rev-parse', 'HEAD']);
    return stdout.trim() || null;
  }
}

async function getLocalBranchesAtCommit(repoRoot: string, sha: string): Promise<Set<string>> {
  try {
    const { stdout } = await runGit(repoRoot, [
      'for-each-ref',
      '--format=%(refname:short)',
      'refs/heads',
      '--contains',
      sha,
    ]);

    return new Set(
      stdout
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
    );
  } catch {
    return new Set<string>();
  }
}
