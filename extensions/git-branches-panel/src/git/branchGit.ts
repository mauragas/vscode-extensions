import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BranchInfo } from '../branchModel';
import { isTrackedBranch } from '../branchModel';
import { listRefs } from './refListing';
import { fetchRemoteState } from './remoteGit';
import { clearCheckedOutTag } from './tagGit';
import {
  parseRemoteBranchReference,
  doesRemoteBranchExist,
  doesLocalBranchExist,
  doesTagExist,
  ensureRemoteExists,
  getAheadBehindCounts,
  readGitConfig,
  readGitConfigEntries,
  runGit,
  unsetGitConfig,
  writeGitConfig,
} from './shared';

const CREATED_FROM_CONFIG_KEY_SUFFIX = 'gitbranchespanelcreatedfromref';
const GITHUB_PR_BASE_BRANCH_CONFIG_KEY_SUFFIX = 'github-pr-base-branch';
const LOCAL_BRANCH_REF_PREFIX = 'refs/heads/';
const LOCAL_BRANCH_TIP_SHA_FIELD_SEPARATOR = '\u001f';
const LOCAL_BRANCH_TIP_SHA_RECORD_SEPARATOR = '\u001e';
const REF_PREFIX = 'refs/';
const REMOTE_BRANCH_REF_PREFIX = 'refs/remotes/';
const VSCODE_MERGE_BASE_CONFIG_KEY_SUFFIX = 'vscode-merge-base';

type CreatedFromResolutionKind = 'explicit' | 'githubPrBase' | 'mergeBase' | 'sameTipAnchor';

interface CreatedFromResolution {
  sourceRef: string;
  kind: CreatedFromResolutionKind;
}

interface BranchSourceMetadataLookup {
  localBranchNames: ReadonlySet<string>;
  createdFromEntries: ReadonlyMap<string, string>;
  githubPrBaseEntries: ReadonlyMap<string, string>;
  mergeBaseEntries: ReadonlyMap<string, string>;
}

export interface SyncBranchResult {
  branchName: string;
  upstreamName: string;
  didPull: boolean;
  didPush: boolean;
  publishedUpstream: boolean;
  didSkip?: boolean;
}

export interface SyncBranchOptions {
  refreshRemoteState?: boolean;
}

export interface CreateBranchFromRefOptions {
  checkout?: boolean;
  sourceRef?: string;
}

export interface CreateBranchOptions {
  sourceRef?: string;
}

export type ResetMode = 'soft' | 'mixed' | 'hard';

export interface RebaseBranchOptions {
  autostash?: boolean;
}

export interface RefComparisonChange {
  status: 'A' | 'D' | 'M' | 'R';
  path: string;
  originalPath?: string;
}

interface BranchSyncTarget {
  remoteName: string;
  remoteBranchName: string;
  upstreamName: string;
  hasConfiguredUpstream: boolean;
}

interface BranchRemoteState {
  branch: BranchInfo;
  syncTarget: BranchSyncTarget;
  remoteBranchExists: boolean;
  syncCounts: {
    aheadCount: number;
    behindCount: number;
  };
}

export async function getBranches(repoRoot: string): Promise<BranchInfo[]> {
  const branches = await listRefs(repoRoot, 'refs/heads', 'local');
  const localBranchTipShas = await getLocalBranchTipShas(repoRoot);
  const localBranchNames = new Set(branches.map((branch) => normalizeLocalBranchConfigName(branch.name)));
  const createdFromEntries = await readGitConfigEntries(
    repoRoot,
    `^branch\\..*\\.${CREATED_FROM_CONFIG_KEY_SUFFIX}$`
  );
  const githubPrBaseEntries = await readGitConfigEntries(
    repoRoot,
    `^branch\\..*\\.${GITHUB_PR_BASE_BRANCH_CONFIG_KEY_SUFFIX}$`
  );
  const mergeBaseEntries = await readGitConfigEntries(
    repoRoot,
    `^branch\\..*\\.${VSCODE_MERGE_BASE_CONFIG_KEY_SUFFIX}$`
  );

  const sourceMetadataLookup: BranchSourceMetadataLookup = {
    localBranchNames,
    createdFromEntries,
    githubPrBaseEntries,
    mergeBaseEntries,
  };

  const configuredCreatedFromByBranch = new Map<string, CreatedFromResolution | undefined>(
    await Promise.all(
      branches.map(async (branch) => [
        branch.name,
        await resolveConfiguredCreatedFromRef(repoRoot, branch.name, sourceMetadataLookup),
      ] as const)
    )
  );

  const resolvedCreatedFromByBranch = new Map<string, CreatedFromResolution | undefined>(
    branches.map((branch) => {
      const configuredCreatedFrom = configuredCreatedFromByBranch.get(branch.name);
      if (!shouldPreferSameTipSourceAnchor(configuredCreatedFrom)) {
        return [branch.name, configuredCreatedFrom] as const;
      }

      return [
        branch.name,
        resolveSameTipSourceAnchor(
          branch.name,
          localBranchTipShas,
          configuredCreatedFromByBranch
        ) ?? configuredCreatedFrom,
      ] as const;
    })
  );

  const enrichedBranches: BranchInfo[] = await Promise.all(
    branches.map(async (branch: BranchInfo) => {
      if (branch.createdFromRef) {
        return branch;
      }

      const createdFromRef = resolvedCreatedFromByBranch.get(branch.name)?.sourceRef;

      if (!createdFromRef) {
        return branch;
      }

      const sourceState = await resolveSourceBranchState(repoRoot, branch, createdFromRef);
      return {
        ...branch,
        createdFromRef,
        createdFromDisplayName: formatRefForDisplay(createdFromRef),
        ...sourceState,
      };
    })
  );

  return enrichedBranches;
}

export async function checkoutBranch(repoRoot: string, branchName: string): Promise<void> {
  await runGit(repoRoot, ['checkout', branchName]);
  await clearCheckedOutTag(repoRoot);
}

export async function createBranch(
  repoRoot: string,
  branchName: string,
  options: CreateBranchOptions = {}
): Promise<void> {
  await createBranchFromRef(repoRoot, branchName, 'HEAD', {
    checkout: true,
    sourceRef: options.sourceRef,
  });
}

export async function createBranchFromRef(
  repoRoot: string,
  branchName: string,
  startPoint: string,
  options: CreateBranchFromRefOptions = {}
): Promise<void> {
  if (options.checkout ?? false) {
    await runGit(repoRoot, ['checkout', '-b', branchName, startPoint]);
  } else {
    await runGit(repoRoot, ['branch', branchName, startPoint]);
  }

  if (options.sourceRef) {
    await writeGitConfig(repoRoot, buildCreatedFromConfigKey(branchName), options.sourceRef);
  }
}

export async function renameBranch(
  repoRoot: string,
  branchName: string,
  newBranchName: string
): Promise<void> {
  await runGit(repoRoot, ['branch', '-m', branchName, newBranchName]);

  const createdFromRef = await readGitConfig(repoRoot, buildCreatedFromConfigKey(branchName));
  if (createdFromRef) {
    await writeGitConfig(repoRoot, buildCreatedFromConfigKey(newBranchName), createdFromRef);
    await unsetGitConfig(repoRoot, buildCreatedFromConfigKey(branchName));
  }
}

export async function deleteBranch(
  repoRoot: string,
  branchName: string,
  force: boolean
): Promise<void> {
  await runGit(repoRoot, ['branch', force ? '-D' : '-d', branchName]);
  await unsetGitConfig(repoRoot, buildCreatedFromConfigKey(branchName));
}

export async function syncBranch(
  repoRoot: string,
  branchName: string,
  options: SyncBranchOptions = {}
): Promise<SyncBranchResult> {
  if (options.refreshRemoteState ?? true) {
    await fetchRemoteState(repoRoot);
  }

  const { branch, syncTarget, remoteBranchExists, syncCounts } = await resolveBranchRemoteState(
    repoRoot,
    branchName
  );

  if (!branch.upstreamName) {
    throw new Error(`Branch '${branch.name}' is not tracking a remote branch yet. Publish it first.`);
  }

  if (!isTrackedBranch(branch) || !remoteBranchExists) {
    throw new Error(
      `Tracked upstream '${syncTarget.upstreamName}' for '${branch.name}' no longer exists. Publish the branch again to recreate it.`
    );
  }

  const shouldPull = syncCounts.behindCount > 0;
  const shouldPush = syncCounts.aheadCount > 0;

  if (branch.isCurrent) {
    if (shouldPull) {
      await pullBranch(repoRoot, syncTarget, syncCounts.aheadCount > 0, true);
    }

    if (shouldPush) {
      await pushBranchToRemote(repoRoot, branch.name, syncTarget, false);
    }
  } else {
    await syncNonCurrentBranch(repoRoot, branch.name, syncTarget, {
      shouldPull,
      shouldPush,
      hasOutgoingCommits: syncCounts.aheadCount > 0,
      shouldSetUpstream: false,
    });
  }

  return {
    branchName: branch.name,
    upstreamName: syncTarget.upstreamName,
    didPull: shouldPull,
    didPush: shouldPush,
    publishedUpstream: false,
  };
}

export async function pullBranchChanges(
  repoRoot: string,
  branchName: string,
  options: SyncBranchOptions = {}
): Promise<SyncBranchResult> {
  if (options.refreshRemoteState ?? true) {
    await fetchRemoteState(repoRoot);
  }

  const { branch, syncTarget, remoteBranchExists, syncCounts } = await resolveBranchRemoteState(
    repoRoot,
    branchName
  );

  if (!branch.upstreamName) {
    throw new Error(`Branch '${branch.name}' is not tracking a remote branch yet. Publish it first.`);
  }

  if (!isTrackedBranch(branch) || !remoteBranchExists) {
    throw new Error(
      `Tracked upstream '${syncTarget.upstreamName}' for '${branch.name}' no longer exists. Publish the branch again to recreate it.`
    );
  }

  const shouldPull = syncCounts.behindCount > 0;

  if (shouldPull) {
    if (branch.isCurrent) {
      await pullBranch(repoRoot, syncTarget, syncCounts.aheadCount > 0, true);
    } else {
      await syncNonCurrentBranch(repoRoot, branch.name, syncTarget, {
        shouldPull: true,
        shouldPush: false,
        hasOutgoingCommits: syncCounts.aheadCount > 0,
        shouldSetUpstream: false,
      });
    }
  }

  return {
    branchName: branch.name,
    upstreamName: syncTarget.upstreamName,
    didPull: shouldPull,
    didPush: false,
    publishedUpstream: false,
  };
}

export async function pushBranch(
  repoRoot: string,
  branchName: string,
  options: SyncBranchOptions = {}
): Promise<SyncBranchResult> {
  if (options.refreshRemoteState ?? true) {
    await fetchRemoteState(repoRoot);
  }

  const { branch, syncTarget, remoteBranchExists, syncCounts } = await resolveBranchRemoteState(
    repoRoot,
    branchName
  );

  if (remoteBranchExists && syncCounts.behindCount > 0) {
    throw new Error(
      `Branch '${branch.name}' is behind '${syncTarget.upstreamName}'. Sync it before pushing.`
    );
  }

  const shouldSetUpstream =
    !syncTarget.hasConfiguredUpstream || branch.upstreamMissing || !remoteBranchExists;
  const shouldPush = syncCounts.aheadCount > 0 || shouldSetUpstream;

  if (branch.isCurrent) {
    if (shouldPush) {
      await pushBranchToRemote(repoRoot, branch.name, syncTarget, shouldSetUpstream);
    }
  } else {
    await syncNonCurrentBranch(repoRoot, branch.name, syncTarget, {
      shouldPull: false,
      shouldPush,
      hasOutgoingCommits: syncCounts.aheadCount > 0,
      shouldSetUpstream,
    });
  }

  return {
    branchName: branch.name,
    upstreamName: syncTarget.upstreamName,
    didPull: false,
    didPush: shouldPush,
    publishedUpstream: shouldSetUpstream,
  };
}

export async function mergeBranchIntoCurrent(
  repoRoot: string,
  refName: string
): Promise<void> {
  await runGit(repoRoot, ['merge', '--no-edit', refName]);
}

export async function cherryPickRef(
  repoRoot: string,
  refName: string
): Promise<void> {
  await runGit(repoRoot, ['cherry-pick', refName]);
}

export async function rebaseBranchOnto(
  repoRoot: string,
  branchName: string,
  ontoRef: string,
  options: RebaseBranchOptions = {}
): Promise<void> {
  const branches = await getBranches(repoRoot);
  const branch = branches.find((candidate) => candidate.name === branchName);
  if (!branch) {
    throw new Error(`Branch '${branchName}' was not found.`);
  }

  if (branch.isCurrent) {
    await rebaseWorkingTree(repoRoot, ontoRef, options);
    return;
  }

  await withTemporaryBranchWorktree(repoRoot, branchName, async (worktreePath) => {
    await rebaseWorkingTree(worktreePath, ontoRef, options);
  });
}

export async function squashMergeIntoCurrent(
  repoRoot: string,
  refName: string
): Promise<void> {
  await runGit(repoRoot, ['merge', '--squash', refName]);
}

export async function resetCurrentBranchToRef(
  repoRoot: string,
  refName: string,
  mode: ResetMode
): Promise<void> {
  await runGit(repoRoot, ['reset', `--${mode}`, refName]);
}

export async function forcePushBranch(
  repoRoot: string,
  branchName: string
): Promise<SyncBranchResult> {
  const { branch, syncTarget, remoteBranchExists } = await resolveBranchRemoteState(
    repoRoot,
    branchName
  );

  if (!branch.upstreamName || !syncTarget.hasConfiguredUpstream || branch.upstreamMissing || !remoteBranchExists) {
    throw new Error(
      `Branch '${branch.name}' is not tracking a live remote branch yet. Publish it before force-pushing with lease.`
    );
  }

  await forcePushBranchToRemote(repoRoot, branch.name, syncTarget);

  return {
    branchName: branch.name,
    upstreamName: syncTarget.upstreamName,
    didPull: false,
    didPush: true,
    publishedUpstream: false,
  };
}

export async function getDiffFilesBetweenRefs(
  repoRoot: string,
  leftRef: string,
  rightRef: string
): Promise<RefComparisonChange[]> {
  const { stdout } = await runGit(repoRoot, [
    'diff',
    '--name-status',
    '--find-renames',
    '--diff-filter=ADMR',
    '-z',
    `${leftRef}..${rightRef}`,
    '--',
  ]);

  return parseRefComparison(stdout);
}

async function syncNonCurrentBranch(
  repoRoot: string,
  branchName: string,
  syncTarget: BranchSyncTarget,
  syncPlan: {
    shouldPull: boolean;
    shouldPush: boolean;
    hasOutgoingCommits: boolean;
    shouldSetUpstream: boolean;
  }
): Promise<void> {
  await withTemporaryBranchWorktree(repoRoot, branchName, async (worktreePath) => {
    if (syncPlan.shouldPull) {
      await pullBranch(worktreePath, syncTarget, syncPlan.hasOutgoingCommits, false);
    }

    if (syncPlan.shouldPush) {
      await pushBranchToRemote(worktreePath, branchName, syncTarget, syncPlan.shouldSetUpstream);
    }
  });
}

async function withTemporaryBranchWorktree<T>(
  repoRoot: string,
  branchName: string,
  operation: (worktreePath: string) => Promise<T>
): Promise<T> {
  const worktreePath = await mkdtemp(join(tmpdir(), 'git-branches-panel-'));

  try {
    await addTemporaryBranchWorktree(repoRoot, worktreePath, branchName);
    return await operation(worktreePath);
  } finally {
    try {
      await runGit(repoRoot, ['worktree', 'remove', '--force', worktreePath]);
    } finally {
      await rm(worktreePath, { recursive: true, force: true });
    }
  }
}

async function addTemporaryBranchWorktree(
  repoRoot: string,
  worktreePath: string,
  branchName: string
): Promise<void> {
  try {
    await runGit(repoRoot, ['worktree', 'add', worktreePath, branchName]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!looksLikeBranchAlreadyCheckedOutError(message)) {
      throw error;
    }

    await runGit(repoRoot, ['worktree', 'add', '--force', worktreePath, branchName]);
  }
}

async function rebaseWorkingTree(
  workingDirectory: string,
  ontoRef: string,
  options: RebaseBranchOptions
): Promise<void> {
  const args = ['rebase'];

  if (options.autostash ?? false) {
    args.push('--autostash');
  }

  args.push(ontoRef);

  await runGit(workingDirectory, args);
}

async function pullBranch(
  workingDirectory: string,
  syncTarget: BranchSyncTarget,
  useRebase: boolean,
  allowAutostash: boolean
): Promise<void> {
  const args = ['pull'];

  if (useRebase) {
    args.push('--rebase');
    if (allowAutostash) {
      args.push('--autostash');
    }
  } else {
    args.push('--ff-only');
  }

  args.push(syncTarget.remoteName, syncTarget.remoteBranchName);

  await runGit(workingDirectory, args);
}

async function pushBranchToRemote(
  workingDirectory: string,
  branchName: string,
  syncTarget: BranchSyncTarget,
  setUpstream: boolean
): Promise<void> {
  const args = ['push'];

  if (setUpstream) {
    args.push('-u');
  }

  args.push(
    syncTarget.remoteName,
    `${branchName}:refs/heads/${syncTarget.remoteBranchName}`
  );

  await runGit(workingDirectory, args);
}

async function forcePushBranchToRemote(
  workingDirectory: string,
  branchName: string,
  syncTarget: BranchSyncTarget
): Promise<void> {
  await runGit(workingDirectory, [
    'push',
    '--force-with-lease',
    syncTarget.remoteName,
    `${branchName}:refs/heads/${syncTarget.remoteBranchName}`,
  ]);
}

async function resolveBranchRemoteState(
  repoRoot: string,
  branchName: string
): Promise<BranchRemoteState> {
  const branches = await getBranches(repoRoot);
  const branch = branches.find((candidate) => candidate.name === branchName);
  if (!branch) {
    throw new Error(`Branch '${branchName}' was not found.`);
  }

  const syncTarget = await resolveBranchSyncTarget(repoRoot, branchName);
  await ensureRemoteExists(repoRoot, syncTarget.remoteName);

  const remoteBranchExists = await doesRemoteBranchExist(
    repoRoot,
    syncTarget.remoteName,
    syncTarget.remoteBranchName
  );

  const syncCounts = remoteBranchExists
    ? await getAheadBehindCounts(
        repoRoot,
        branch.name,
        `${syncTarget.remoteName}/${syncTarget.remoteBranchName}`
      )
    : {
        aheadCount: branch.aheadCount ?? 0,
        behindCount: branch.behindCount ?? 0,
      };

  return {
    branch,
    syncTarget,
    remoteBranchExists,
    syncCounts,
  };
}

async function resolveBranchSyncTarget(
  repoRoot: string,
  branchName: string
): Promise<BranchSyncTarget> {
  const remoteName = await readGitConfig(repoRoot, `branch.${branchName}.remote`);
  const mergeRef = await readGitConfig(repoRoot, `branch.${branchName}.merge`);

  if (remoteName && mergeRef?.startsWith('refs/heads/')) {
    const remoteBranchName = mergeRef.slice('refs/heads/'.length);

    return {
      remoteName,
      remoteBranchName,
      upstreamName: `${remoteName}/${remoteBranchName}`,
      hasConfiguredUpstream: true,
    };
  }

  return {
    remoteName: 'origin',
    remoteBranchName: branchName,
    upstreamName: `origin/${branchName}`,
    hasConfiguredUpstream: false,
  };
}

function looksLikeBranchAlreadyCheckedOutError(message: string): boolean {
  return /already used by worktree/i.test(message);
}

function buildCreatedFromConfigKey(branchName: string): string {
  return buildBranchConfigKey(branchName, CREATED_FROM_CONFIG_KEY_SUFFIX);
}

function buildBranchConfigKey(branchName: string, keySuffix: string): string {
  return `branch.${normalizeLocalBranchConfigName(branchName)}.${keySuffix}`;
}

function buildLocalBranchRef(branchName: string): string {
  return `${LOCAL_BRANCH_REF_PREFIX}${normalizeLocalBranchConfigName(branchName)}`;
}

function buildActualLocalBranchRef(branchName: string): string {
  return branchName.startsWith(LOCAL_BRANCH_REF_PREFIX)
    ? branchName
    : `${LOCAL_BRANCH_REF_PREFIX}${branchName}`;
}

function normalizeLocalBranchConfigName(branchName: string): string {
  return branchName.startsWith(LOCAL_BRANCH_REF_PREFIX)
    ? branchName.slice(LOCAL_BRANCH_REF_PREFIX.length)
    : branchName;
}

function formatRefForDisplay(refName: string): string {
  if (!refName) {
    return refName;
  }

  if (refName.startsWith('refs/heads/')) {
    return refName.slice('refs/heads/'.length);
  }

  if (refName.startsWith('refs/remotes/')) {
    return refName.slice('refs/remotes/'.length);
  }

  if (refName.startsWith('refs/tags/')) {
    return refName.slice('refs/tags/'.length);
  }

  return refName;
}

async function resolveSourceBranchState(
  repoRoot: string,
  branch: BranchInfo,
  sourceRef: string
): Promise<Pick<BranchInfo, 'sourceBehindCount' | 'sourceRefMissing'>> {
  try {
    await runGit(repoRoot, ['rev-parse', '--verify', '--quiet', sourceRef]);
  } catch {
    return {
      sourceBehindCount: 0,
      sourceRefMissing: true,
    };
  }

  if (!branch.isCurrent) {
    return {
      sourceBehindCount: 0,
      sourceRefMissing: false,
    };
  }

  const currentBranchRef = await resolveActualLocalBranchRef(repoRoot, branch.name);
  const counts = await getAheadBehindCounts(repoRoot, currentBranchRef, sourceRef);
  return {
    sourceBehindCount: counts.behindCount,
    sourceRefMissing: false,
  };
}

async function resolveConfiguredCreatedFromRef(
  repoRoot: string,
  branchName: string,
  sourceMetadataLookup: BranchSourceMetadataLookup
): Promise<CreatedFromResolution | undefined> {
  const explicitCreatedFromRef = sourceMetadataLookup.createdFromEntries.get(
    buildCreatedFromConfigKey(branchName)
  );
  if (explicitCreatedFromRef) {
    const normalizedExplicitSourceRef = await normalizeExplicitSourceRef(
      repoRoot,
      explicitCreatedFromRef,
      sourceMetadataLookup.localBranchNames
    );
    if (await doesSourceRefExist(repoRoot, normalizedExplicitSourceRef)) {
      return {
        sourceRef: normalizedExplicitSourceRef,
        kind: 'explicit',
      };
    }

    const fallbackSourceRef = await resolveCompatibleConfigCreatedFromRef(
      repoRoot,
      branchName,
      sourceMetadataLookup
    );
    return fallbackSourceRef ?? {
      sourceRef: normalizedExplicitSourceRef,
      kind: 'explicit',
    };
  }

  return resolveCompatibleConfigCreatedFromRef(repoRoot, branchName, sourceMetadataLookup);
}

async function resolveCompatibleConfigCreatedFromRef(
  repoRoot: string,
  branchName: string,
  sourceMetadataLookup: BranchSourceMetadataLookup
): Promise<CreatedFromResolution | undefined> {
  const githubPrBaseRef = inferCreatedFromRefFromGitHubPrBase(
    branchName,
    sourceMetadataLookup.githubPrBaseEntries,
    sourceMetadataLookup.localBranchNames
  );
  if (githubPrBaseRef && (await doesSourceRefExist(repoRoot, githubPrBaseRef))) {
    return {
      sourceRef: githubPrBaseRef,
      kind: 'githubPrBase',
    };
  }

  const mergeBaseRef = inferCreatedFromRefFromMergeBase(
    branchName,
    sourceMetadataLookup.mergeBaseEntries,
    sourceMetadataLookup.localBranchNames
  );
  if (mergeBaseRef && (await doesSourceRefExist(repoRoot, mergeBaseRef))) {
    return {
      sourceRef: mergeBaseRef,
      kind: 'mergeBase',
    };
  }

  return undefined;
}

function shouldPreferSameTipSourceAnchor(
  createdFromResolution: CreatedFromResolution | undefined
): boolean {
  return !createdFromResolution || createdFromResolution.kind === 'mergeBase';
}

function resolveSameTipSourceAnchor(
  branchName: string,
  localBranchTipShas: ReadonlyMap<string, string>,
  configuredCreatedFromByBranch: ReadonlyMap<string, CreatedFromResolution | undefined>
): CreatedFromResolution | undefined {
  const tipSha = localBranchTipShas.get(branchName);
  if (!tipSha) {
    return undefined;
  }

  const sameTipBranchNames = [...localBranchTipShas.entries()]
    .filter(([, candidateTipSha]) => candidateTipSha === tipSha)
    .map(([candidateBranchName]) => candidateBranchName);

  if (sameTipBranchNames.length < 2) {
    return undefined;
  }

  const sameTipBranchNameSet = new Set(sameTipBranchNames);
  const sameTipSourceBranches = new Set<string>();
  const sameTipSourceTargets = new Set<string>();

  for (const candidateBranchName of sameTipBranchNames) {
    const sourceBranchName = getSameTipLocalSourceBranchName(
      configuredCreatedFromByBranch.get(candidateBranchName)?.sourceRef,
      sameTipBranchNameSet
    );
    if (!sourceBranchName || sourceBranchName === candidateBranchName) {
      continue;
    }

    sameTipSourceBranches.add(candidateBranchName);
    sameTipSourceTargets.add(sourceBranchName);
  }

  const sourceAnchorBranchNames = [...sameTipSourceTargets].filter(
    (candidateBranchName) => !sameTipSourceBranches.has(candidateBranchName)
  );

  if (sourceAnchorBranchNames.length !== 1) {
    return undefined;
  }

  const [sourceAnchorBranchName] = sourceAnchorBranchNames;
  if (!sourceAnchorBranchName || sourceAnchorBranchName === branchName) {
    return undefined;
  }

  return {
    sourceRef: buildLocalBranchRef(sourceAnchorBranchName),
    kind: 'sameTipAnchor',
  };
}

function getSameTipLocalSourceBranchName(
  sourceRef: string | undefined,
  sameTipBranchNameSet: ReadonlySet<string>
): string | undefined {
  if (!sourceRef?.startsWith(LOCAL_BRANCH_REF_PREFIX)) {
    return undefined;
  }

  const sourceBranchName = normalizeLocalBranchConfigName(sourceRef);
  return sameTipBranchNameSet.has(sourceBranchName) ? sourceBranchName : undefined;
}

async function normalizeExplicitSourceRef(
  repoRoot: string,
  refName: string,
  localBranchNames: ReadonlySet<string>
): Promise<string> {
  const normalizedRefName = refName.trim().replace(/^"+|"+$/gu, '');
  if (!normalizedRefName.startsWith(LOCAL_BRANCH_REF_PREFIX)) {
    return normalizedRefName;
  }

  const localBranchName = normalizeLocalBranchConfigName(normalizedRefName);
  if (localBranchNames.has(localBranchName) || (await doesLocalBranchExist(repoRoot, localBranchName))) {
    return normalizedRefName;
  }

  if (await doesTagExist(repoRoot, localBranchName)) {
    return `refs/tags/${localBranchName}`;
  }

  return normalizedRefName;
}

async function doesSourceRefExist(repoRoot: string, refName: string): Promise<boolean> {
  try {
    await runGit(repoRoot, ['rev-parse', '--verify', '--quiet', refName]);
    return true;
  } catch {
    return false;
  }
}

async function resolveActualLocalBranchRef(repoRoot: string, branchName: string): Promise<string> {
  const normalizedBranchName = normalizeLocalBranchConfigName(branchName);

  if (await doesLocalBranchExist(repoRoot, normalizedBranchName)) {
    return `${LOCAL_BRANCH_REF_PREFIX}${normalizedBranchName}`;
  }

  if (await doesLocalBranchExist(repoRoot, branchName)) {
    return `${LOCAL_BRANCH_REF_PREFIX}${branchName}`;
  }

  return buildActualLocalBranchRef(branchName);
}

function inferCreatedFromRefFromGitHubPrBase(
  branchName: string,
  githubPrBaseEntries: ReadonlyMap<string, string>,
  localBranchNames: ReadonlySet<string>
): string | undefined {
  const githubPrBase = githubPrBaseEntries.get(
    buildBranchConfigKey(branchName, GITHUB_PR_BASE_BRANCH_CONFIG_KEY_SUFFIX)
  );
  if (!githubPrBase) {
    return undefined;
  }

  const match = githubPrBase.match(/^[^#]+#[^#]+#(.+)$/u);
  return normalizeInferredSourceRef(match?.[1], localBranchNames);
}

function inferCreatedFromRefFromMergeBase(
  branchName: string,
  mergeBaseEntries: ReadonlyMap<string, string>,
  localBranchNames: ReadonlySet<string>
): string | undefined {
  const mergeBase = mergeBaseEntries.get(buildBranchConfigKey(branchName, VSCODE_MERGE_BASE_CONFIG_KEY_SUFFIX));
  return normalizeInferredSourceRef(mergeBase, localBranchNames);
}

function normalizeInferredSourceRef(
  refName: string | undefined,
  localBranchNames: ReadonlySet<string>
): string | undefined {
  const normalizedRefName = refName?.trim().replace(/^"+|"+$/gu, '');
  if (!normalizedRefName || normalizedRefName === 'HEAD') {
    return undefined;
  }

  if (normalizedRefName.startsWith(REF_PREFIX)) {
    return normalizedRefName;
  }

  if (localBranchNames.has(normalizedRefName)) {
    return `${LOCAL_BRANCH_REF_PREFIX}${normalizedRefName}`;
  }

  const remoteBranchReference = parseRemoteBranchReference(normalizedRefName);
  if (remoteBranchReference) {
    const localBranchName = normalizeLocalBranchConfigName(remoteBranchReference.branchName);
    if (localBranchNames.has(localBranchName)) {
      return `${LOCAL_BRANCH_REF_PREFIX}${localBranchName}`;
    }

    return `${REMOTE_BRANCH_REF_PREFIX}${remoteBranchReference.fullName}`;
  }

  return buildLocalBranchRef(normalizedRefName);
}

async function getLocalBranchTipShas(repoRoot: string): Promise<Map<string, string>> {
  const { stdout } = await runGit(repoRoot, [
    'for-each-ref',
    `--format=%(refname:lstrip=2)${LOCAL_BRANCH_TIP_SHA_FIELD_SEPARATOR}%(objectname)${LOCAL_BRANCH_TIP_SHA_RECORD_SEPARATOR}`,
    'refs/heads',
  ]);

  return new Map(
    stdout
      .split(LOCAL_BRANCH_TIP_SHA_RECORD_SEPARATOR)
      .map((record) => record.trim())
      .filter(Boolean)
      .map((record) => {
        const [branchName = '', tipSha = ''] = record.split(LOCAL_BRANCH_TIP_SHA_FIELD_SEPARATOR);
        return [branchName, tipSha] as const;
      })
      .filter(([branchName, tipSha]) => Boolean(branchName) && Boolean(tipSha))
  );
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
