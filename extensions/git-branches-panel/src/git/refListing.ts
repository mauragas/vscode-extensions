import { parseUpstreamTrack, type BranchInfo } from '../branchModel';
import {
  parseRemoteBranchReference,
  runGit,
} from './shared';

const GIT_RECORD_SEPARATOR = '\u001e';
const GIT_FIELD_SEPARATOR = '\u001f';
const GIT_OUTPUT_FORMAT = [
  '%(refname:lstrip=2)',
  '%(HEAD)',
  '%(committerdate:relative)',
  '%(committerdate:unix)',
  '%(subject)',
  '%(upstream:short)',
  '%(upstream:track,nobracket)',
].join(`${GIT_FIELD_SEPARATOR}`) + GIT_RECORD_SEPARATOR;
const REMOTE_TAG_CACHE_TTL_MS = 30_000;

const remoteTagCache = new Map<string, {
  expiresAt: number;
  tagNames: ReadonlySet<string>;
}>();
const remoteTagLoads = new Map<string, Promise<Set<string> | null>>();

export function invalidateRemoteTagCache(repoRoot?: string): void {
  if (repoRoot) {
    remoteTagCache.delete(repoRoot);
    remoteTagLoads.delete(repoRoot);
    return;
  }

  remoteTagCache.clear();
  remoteTagLoads.clear();
}

export async function listRefs(
  repoRoot: string,
  refPattern: string,
  scope: 'local' | 'remote' | 'tag'
): Promise<BranchInfo[]> {
  const currentTagNames = scope === 'tag' ? await getCurrentTagNames(repoRoot) : new Set<string>();
  const remoteTagNames = scope === 'tag' ? await getRemoteTagNames(repoRoot) : null;
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
            : scope === 'local' && headMarker === '*',
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
        isRemoteTag: scope === 'tag' && remoteTagNames?.has(name),
      } satisfies BranchInfo;
    });
}

async function getCurrentTagNames(repoRoot: string): Promise<Set<string>> {
  try {
    await runGit(repoRoot, ['symbolic-ref', '-q', 'HEAD']);
    return new Set<string>();
  } catch {
    try {
      const { stdout } = await runGit(repoRoot, [
        'config',
        '--local',
        'gitBranchesPanel.checkedOutTag',
      ]);

      const tagName = stdout.trim();
      if (tagName) {
        return new Set([tagName]);
      }
    } catch {
    }

    const { stdout } = await runGit(repoRoot, ['tag', '--points-at', 'HEAD']);

    return new Set(
      stdout
        .split(/\r?\n/u)
        .map((tagName) => tagName.trim())
        .filter(Boolean)
    );
  }
}

async function getRemoteTagNames(repoRoot: string): Promise<Set<string> | null> {
  const cachedEntry = remoteTagCache.get(repoRoot);
  if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
    return cachedEntry.tagNames as Set<string>;
  }

  const pendingLoad = remoteTagLoads.get(repoRoot);
  if (pendingLoad) {
    const loadedTagNames = await pendingLoad;
    return loadedTagNames ?? (cachedEntry?.tagNames as Set<string> | undefined) ?? null;
  }

  const loadPromise = loadRemoteTagNames(repoRoot)
    .then((tagNames) => {
      if (tagNames) {
        remoteTagCache.set(repoRoot, {
          expiresAt: Date.now() + REMOTE_TAG_CACHE_TTL_MS,
          tagNames,
        });
      }

      return tagNames;
    })
    .finally(() => {
      remoteTagLoads.delete(repoRoot);
    });

  remoteTagLoads.set(repoRoot, loadPromise);

  const loadedTagNames = await loadPromise;
  return loadedTagNames ?? (cachedEntry?.tagNames as Set<string> | undefined) ?? null;
}

async function loadRemoteTagNames(repoRoot: string): Promise<Set<string> | null> {
  const allTagNames = new Set<string>();

  try {
    const { stdout } = await runGit(repoRoot, ['remote']);
    const remotes = stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);

    if (remotes.length === 0) {
      return new Set<string>();
    }

    for (const remote of remotes) {
      try {
        const { stdout: tagsOutput } = await runGit(repoRoot, ['ls-remote', '--tags', '--refs', remote]);

        if (tagsOutput.trim()) {
          for (const line of tagsOutput.split(/\r?\n/u)) {
            const tagName = line.trim().split('\t')[1]?.replace('refs/tags/', '');
            if (tagName) {
              allTagNames.add(tagName);
            }
          }
        }
      } catch {
        // Skip remotes that fail
      }
    }

    return allTagNames;
  } catch {
    return null;
  }
}
