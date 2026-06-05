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
        isCurrent: scope === 'local' && headMarker === '*',
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
