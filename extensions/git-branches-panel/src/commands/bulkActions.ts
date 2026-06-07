import * as vscode from 'vscode';

import { isTrackedBranch, type BranchInfo, type TreeBranch } from '../branchModel';
import {
  DEFAULT_PROTECTED_BRANCH_NAMES,
  isBranchProtectedFromDeletion,
  normalizeConfiguredBranchNames,
} from '../branchRules';
import { getErrorMessage } from '../errorUtils';
import { looksLikeMergeSafetyError } from '../extensionHelpers';
import {
  deleteBranch,
  deleteRemoteBranch,
  deleteTag,
  fetchRemoteState,
  getBranches,
  pushBranch,
  syncBranch,
  type SyncBranchResult,
} from '../git';
import { type BranchTreeItem } from '../treeProvider';
import type { CommandContext } from './shared';

type FolderActionScope = 'local' | 'remote' | 'tag';
type NotificationKind = 'info' | 'warning' | 'error';

interface AdvancedActionItem extends vscode.QuickPickItem {
  readonly actionId: string;
  run(): Promise<void>;
}

interface BulkDeleteResult {
  deleted: string[];
  skippedCurrent: string[];
  skippedProtected: string[];
  skippedNotFullyMerged: string[];
  failed: Array<{
    name: string;
    reason: string;
  }>;
}

interface BulkSyncResult {
  processed: SyncBranchResult[];
  skippedNeedsPublish: string[];
  failed: Array<{
    name: string;
    reason: string;
  }>;
}

interface BulkPushResult {
  processed: SyncBranchResult[];
  failed: Array<{
    name: string;
    reason: string;
  }>;
}

interface LocalBranchTarget {
  name: string;
  isCurrent: boolean;
}

export function getPrunableLocalBranches(branches: readonly BranchInfo[]): BranchInfo[] {
  return branches.filter(
    (branch) => resolveBranchScope(branch) === 'local' && !branch.isCurrent && branch.upstreamMissing
  );
}

export function registerBulkActionCommands(
  context: vscode.ExtensionContext,
  commandContext: CommandContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('gitBranchesPanel.showAdvancedActions', async () => {
      await handleShowAdvancedActions(commandContext);
    }),
    vscode.commands.registerCommand(
      'gitBranchesPanel.syncFolderBranches',
      async (item: BranchTreeItem) => {
        await handleSyncFolderBranches(item, commandContext);
      }
    ),
    vscode.commands.registerCommand(
      'gitBranchesPanel.pushFolderBranches',
      async (item: BranchTreeItem) => {
        await handlePushFolderBranches(item, commandContext);
      }
    ),
    vscode.commands.registerCommand(
      'gitBranchesPanel.deleteFolderBranches',
      async (item: BranchTreeItem) => {
        await handleDeleteFolderBranches(item, commandContext);
      }
    ),
    vscode.commands.registerCommand(
      'gitBranchesPanel.deleteRemoteFolderBranches',
      async (item: BranchTreeItem) => {
        await handleDeleteRemoteFolderBranches(item, commandContext);
      }
    ),
    vscode.commands.registerCommand('gitBranchesPanel.deleteFolderTags', async (item: BranchTreeItem) => {
      await handleDeleteFolderTags(item, commandContext);
    }),
    vscode.commands.registerCommand(
      'gitBranchesPanel.pruneMissingUpstreamBranches',
      async () => {
        await handlePruneMissingUpstreamBranches(commandContext);
      }
    )
  );
}

async function handleShowAdvancedActions(commandContext: CommandContext): Promise<void> {
  const selection = await vscode.window.showQuickPick(
    buildRepositoryActionItems(commandContext),
    {
      placeHolder: 'Choose an advanced repository action',
    }
  );

  if (!selection) {
    return;
  }

  await selection.run();
}

async function handleSyncFolderBranches(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!isLocalSyncContainerItem(item)) {
    return;
  }

  const repoRoot = item.repoRoot ?? (await commandContext.requireRepoRoot());
  if (!repoRoot) {
    return;
  }

  const folderLabel = getContainerLabel(item);
  const branches = getContainerBranches(item, commandContext, 'local');
  if (branches.length === 0) {
    vscode.window.showInformationMessage(
      `No local branches were found under '${folderLabel}'.`
    );
    return;
  }

  try {
    await fetchRemoteState(repoRoot);

    const result = await syncFolderBranches(repoRoot, branches);
    if (result.processed.length > 0) {
      const shouldRefreshRemoteState = result.processed.some((branch) => branch.didPush);
      await commandContext.refresh({
        fetchRemoteState: shouldRefreshRemoteState,
        forceFetchRemoteState: shouldRefreshRemoteState,
      });
    }

    showNotification(
      result.failed.length > 0 || result.skippedNeedsPublish.length > 0 ? 'warning' : 'info',
      buildFolderSyncResultMessage(folderLabel, result)
    );
  } catch (error) {
    commandContext.showCommandError(`Failed to sync tracked local branches under '${folderLabel}'`, error);
  }
}

async function handlePushFolderBranches(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!isFolderActionItem(item, 'local')) {
    return;
  }

  const repoRoot = item.repoRoot ?? (await commandContext.requireRepoRoot());
  if (!repoRoot) {
    return;
  }

  const folderLabel = getContainerLabel(item);
  const branches = getFolderBranches(item, commandContext, 'local');
  if (branches.length === 0) {
    vscode.window.showInformationMessage(
      `No local branches were found under '${folderLabel}'.`
    );
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    [
      `Push local branches under '${folderLabel}'?`,
      'Branches without a tracked upstream will be published.',
      buildNamePreview(branches.map((branch) => branch.fullName)),
    ]
      .filter(Boolean)
      .join(' '),
    { modal: true },
    'Push'
  );
  if (confirmation !== 'Push') {
    return;
  }

  try {
    await fetchRemoteState(repoRoot);

    const result = await pushFolderBranches(repoRoot, branches);
    if (result.processed.some((branch) => branch.didPush)) {
      await commandContext.refresh({
        fetchRemoteState: true,
        forceFetchRemoteState: true,
      });
    }

    showNotification(
      result.failed.length > 0 ? 'warning' : 'info',
      buildFolderPushResultMessage(folderLabel, result)
    );
  } catch (error) {
    commandContext.showCommandError(`Failed to push local branches under '${folderLabel}'`, error);
  }
}

async function handleDeleteFolderBranches(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!isFolderActionItem(item, 'local')) {
    return;
  }

  const repoRoot = item.repoRoot ?? (await commandContext.requireRepoRoot());
  if (!repoRoot) {
    return;
  }

  const folderLabel = getContainerLabel(item);
  const targets = getFolderBranches(item, commandContext, 'local').map((branch) => ({
    name: branch.fullName,
    isCurrent: branch.info.isCurrent,
  }));

  await handleBulkLocalDelete({
    repoRoot,
    folderLabel,
    targets,
    confirmationLabel: 'Delete',
    confirmationPrompt: `Delete local branches under '${folderLabel}'?`,
    emptyMessage: `No local branches were found under '${folderLabel}'.`,
    commandContext,
    successMessageBuilder: (result) => buildFolderDeleteResultMessage(folderLabel, result),
  });
}

async function handleDeleteRemoteFolderBranches(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!isFolderActionItem(item, 'remote')) {
    return;
  }

  const repoRoot = item.repoRoot ?? (await commandContext.requireRepoRoot());
  if (!repoRoot) {
    return;
  }

  const folderLabel = getContainerLabel(item);
  const descendantBranches = getFolderBranches(item, commandContext, 'remote');
  const staleBranches = descendantBranches
    .filter((branch) => branch.info.remoteTrackingState === 'stale')
    .map((branch) => branch.fullName);
  const protectedBranchNames = getProtectedBranchNames();
  const branches = descendantBranches
    .filter((branch) => branch.info.remoteTrackingState !== 'stale')
    .map((branch) => branch.fullName);
  const protectedBranches = branches.filter((branchName) =>
    isBranchProtectedFromDeletion(
      {
        name: branchName,
        scope: 'remote',
      },
      protectedBranchNames
    )
  );
  const deletableBranches = branches.filter((branchName) => !protectedBranches.includes(branchName));

  if (deletableBranches.length === 0) {
    vscode.window.showInformationMessage(
      [
        branches.length === 0
          ? staleBranches.length > 0
            ? `No live remote branches were found under '${folderLabel}'.`
            : `No remote branches were found under '${folderLabel}'.`
          : `No deletable remote branches were found under '${folderLabel}'.`,
        staleBranches.length > 0
          ? `Stale tracking ${pluralize('ref', staleBranches.length)}: ${formatNameList(staleBranches)}.`
          : '',
        protectedBranches.length > 0
          ? `Protected ${pluralize('branch', protectedBranches.length)}: ${formatNameList(protectedBranches)}.`
          : '',
      ]
        .filter(Boolean)
        .join(' ')
    );
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    [
      `Delete ${deletableBranches.length} remote ${pluralize('branch', deletableBranches.length)} under '${folderLabel}'?`,
      staleBranches.length > 0
        ? `Stale tracking ${pluralize('ref', staleBranches.length)} will be skipped: ${formatNameList(staleBranches)}.`
        : '',
      protectedBranches.length > 0
        ? `Protected ${pluralize('branch', protectedBranches.length)} will be skipped: ${formatNameList(protectedBranches)}.`
        : '',
      buildNamePreview(deletableBranches),
    ]
      .filter(Boolean)
      .join(' '),
    { modal: true },
    'Delete'
  );
  if (confirmation !== 'Delete') {
    return;
  }

  const result = await deleteNamedItems(deletableBranches, async (branchName) => {
    await deleteRemoteBranch(repoRoot, branchName);
  });

  if (result.deleted.length > 0) {
    await commandContext.refresh({
      fetchRemoteState: true,
      forceFetchRemoteState: true,
    });
  }

  showNotification(
    result.failed.length > 0 ? 'warning' : 'info',
    buildNamedDeleteResultMessage('remote branches', folderLabel, result, staleBranches, protectedBranches)
  );
}

async function handleDeleteFolderTags(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!isFolderActionItem(item, 'tag')) {
    return;
  }

  const repoRoot = item.repoRoot ?? (await commandContext.requireRepoRoot());
  if (!repoRoot) {
    return;
  }

  const folderLabel = getContainerLabel(item);
  const tags = getFolderBranches(item, commandContext, 'tag').map((branch) => branch.fullName);
  if (tags.length === 0) {
    vscode.window.showInformationMessage(`No tags were found under '${folderLabel}'.`);
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    [`Delete ${tags.length} ${pluralize('tag', tags.length)} under '${folderLabel}'?`, buildNamePreview(tags)]
      .filter(Boolean)
      .join(' '),
    { modal: true },
    'Delete'
  );
  if (confirmation !== 'Delete') {
    return;
  }

  const result = await deleteNamedItems(tags, async (tagName) => {
    await deleteTag(repoRoot, tagName);
  });

  if (result.deleted.length > 0) {
    await commandContext.refresh({ fetchRemoteState: false });
  }

  showNotification(
    result.failed.length > 0 ? 'warning' : 'info',
    buildNamedDeleteResultMessage('tags', folderLabel, result)
  );
}

async function handlePruneMissingUpstreamBranches(commandContext: CommandContext): Promise<void> {
  const repoRoot = await commandContext.requireRepoRoot();
  if (!repoRoot) {
    return;
  }

  try {
    await fetchRemoteState(repoRoot);
    const branches = getPrunableLocalBranches(await getBranches(repoRoot));

    await handleBulkLocalDelete({
      repoRoot,
      folderLabel: 'missing upstreams',
      targets: branches.map((branch) => ({
        name: branch.name,
        isCurrent: branch.isCurrent,
      })),
      confirmationLabel: 'Prune',
      confirmationPrompt:
        'Prune local branches whose tracked upstream no longer exists?',
      emptyMessage: 'No local branches with missing upstreams were found.',
      forceDelete: true,
      commandContext,
      successMessageBuilder: buildPruneResultMessage,
    });
  } catch (error) {
    commandContext.showCommandError('Failed to prune local branches with missing upstreams', error);
  }
}

function buildRepositoryActionItems(commandContext: CommandContext): AdvancedActionItem[] {
  return [
    {
      actionId: 'pruneMissingUpstream',
      label: 'Prune local branches with missing upstream',
      description: 'Delete non-current local branches whose tracked upstream no longer exists',
      run: async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.pruneMissingUpstreamBranches');
      },
    },
    {
      actionId: 'pushAllTags',
      label: 'Push all tags…',
      description: 'Choose a remote and push every local tag',
      run: async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.pushAllTags');
      },
    },
    {
      actionId: 'fetchAllPrune',
      label: 'Fetch all (prune)',
      description: 'Fetch every remote and prune deleted remote refs',
      run: async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.fetchAllPrune');
      },
    },
    {
      actionId: 'cleanRepository',
      label: 'Clean repository…',
      description: 'Run git clean -fdx to remove untracked and ignored files',
      run: async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.cleanRepository');
      },
    },
    {
      actionId: 'refresh',
      label: 'Refresh branch tree',
      description: 'Reload the currently visible tree sections',
      run: async () => {
        await commandContext.refresh({ fetchRemoteState: false });
      },
    },
  ];
}

async function syncFolderBranches(
  repoRoot: string,
  branches: readonly TreeBranch[]
): Promise<BulkSyncResult> {
  const latestBranches = await getBranches(repoRoot);
  const latestBranchesByName = new Map(latestBranches.map((branch) => [branch.name, branch]));
  const result: BulkSyncResult = {
    processed: [],
    skippedNeedsPublish: [],
    failed: [],
  };

  for (const branch of branches) {
    const latestBranch = latestBranchesByName.get(branch.fullName);
    if (!latestBranch) {
      result.failed.push({
        name: branch.fullName,
        reason: 'Branch was not found.',
      });
      continue;
    }

    if (!isTrackedBranch(latestBranch)) {
      result.skippedNeedsPublish.push(branch.fullName);
      continue;
    }

    try {
      result.processed.push(
        await syncBranch(repoRoot, branch.fullName, { refreshRemoteState: false })
      );
    } catch (error) {
      result.failed.push({
        name: branch.fullName,
        reason: getErrorMessage(error),
      });
    }
  }

  return result;
}

async function pushFolderBranches(
  repoRoot: string,
  branches: readonly TreeBranch[]
): Promise<BulkPushResult> {
  const result: BulkPushResult = {
    processed: [],
    failed: [],
  };

  for (const branch of branches) {
    try {
      result.processed.push(
        await pushBranch(repoRoot, branch.fullName, { refreshRemoteState: false })
      );
    } catch (error) {
      result.failed.push({
        name: branch.fullName,
        reason: getErrorMessage(error),
      });
    }
  }

  return result;
}

async function handleBulkLocalDelete(options: {
  repoRoot: string;
  folderLabel: string;
  targets: readonly LocalBranchTarget[];
  confirmationLabel: 'Delete' | 'Prune';
  confirmationPrompt: string;
  emptyMessage: string;
  forceDelete?: boolean;
  commandContext: CommandContext;
  successMessageBuilder(result: BulkDeleteResult): string;
}): Promise<void> {
  const {
    repoRoot,
    folderLabel,
    targets,
    confirmationLabel,
    confirmationPrompt,
    emptyMessage,
    forceDelete = false,
    commandContext,
  } = options;

  if (targets.length === 0) {
    vscode.window.showInformationMessage(emptyMessage);
    return;
  }

  const protectedBranchNames = getProtectedBranchNames();
  const skippedProtectedTargets = targets.filter((target) =>
    isBranchProtectedFromDeletion(
      {
        name: target.name,
        scope: 'local',
      },
      protectedBranchNames
    )
  );
  const unprotectedTargets = targets.filter(
    (target) => !skippedProtectedTargets.some((protectedTarget) => protectedTarget.name === target.name)
  );
  const deletableTargets = unprotectedTargets.filter((target) => !target.isCurrent);
  const skippedCurrentTargets = unprotectedTargets.filter((target) => target.isCurrent);

  if (deletableTargets.length === 0) {
    vscode.window.showInformationMessage(
      skippedCurrentTargets.length > 0 || skippedProtectedTargets.length > 0
        ? buildNoDeletableLocalBranchesMessage(
            folderLabel,
            skippedCurrentTargets,
            skippedProtectedTargets
          )
        : emptyMessage
    );
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    [
      `${confirmationPrompt} ${buildNamePreview(deletableTargets.map((target) => target.name))}`,
      skippedCurrentTargets.length > 0
        ? `The current ${pluralize('branch', skippedCurrentTargets.length)} will be skipped automatically.`
        : '',
      skippedProtectedTargets.length > 0
        ? `Protected ${pluralize('branch', skippedProtectedTargets.length)} will be skipped automatically.`
        : '',
    ]
      .filter(Boolean)
      .join(' '),
    { modal: true },
    confirmationLabel
  );
  if (confirmation !== confirmationLabel) {
    return;
  }

  const result = await deleteLocalBranches(repoRoot, unprotectedTargets, forceDelete);
  result.skippedProtected.push(...skippedProtectedTargets.map((target) => target.name));

  if (result.deleted.length > 0) {
    await commandContext.refresh({ fetchRemoteState: false });
  }

  showNotification(
    result.failed.length > 0 || result.skippedNotFullyMerged.length > 0 ? 'warning' : 'info',
    options.successMessageBuilder(result)
  );
}

async function deleteLocalBranches(
  repoRoot: string,
  targets: readonly LocalBranchTarget[],
  forceDelete = false
): Promise<BulkDeleteResult> {
  const result: BulkDeleteResult = {
    deleted: [],
    skippedCurrent: [],
    skippedProtected: [],
    skippedNotFullyMerged: [],
    failed: [],
  };

  for (const target of targets) {
    if (target.isCurrent) {
      result.skippedCurrent.push(target.name);
      continue;
    }

    try {
      await deleteBranch(repoRoot, target.name, forceDelete);
      result.deleted.push(target.name);
    } catch (error) {
      const message = getErrorMessage(error);
      if (looksLikeMergeSafetyError(message)) {
        result.skippedNotFullyMerged.push(target.name);
        continue;
      }

      result.failed.push({
        name: target.name,
        reason: message,
      });
    }
  }

  return result;
}

async function deleteNamedItems(
  names: readonly string[],
  remove: (name: string) => Promise<void>
): Promise<BulkDeleteResult> {
  const result: BulkDeleteResult = {
    deleted: [],
    skippedCurrent: [],
    skippedProtected: [],
    skippedNotFullyMerged: [],
    failed: [],
  };

  for (const name of names) {
    try {
      await remove(name);
      result.deleted.push(name);
    } catch (error) {
      result.failed.push({
        name,
        reason: getErrorMessage(error),
      });
    }
  }

  return result;
}

function getFolderBranches(
  item: BranchTreeItem,
  commandContext: CommandContext,
  scope: FolderActionScope
): TreeBranch[] {
  if (!item.containerKey) {
    return [];
  }

  return commandContext.provider
    .getDescendantBranches(item.containerKey)
    .filter((branch) => resolveBranchScope(branch.info) === scope);
}

function getContainerBranches(
  item: BranchTreeItem,
  commandContext: CommandContext,
  scope: FolderActionScope
): TreeBranch[] {
  return getFolderBranches(item, commandContext, scope);
}

function isFolderActionItem(
  item: BranchTreeItem | undefined,
  scope: FolderActionScope
): item is BranchTreeItem {
  return Boolean(
    item && item.nodeType === 'folder' && item.containerScope === scope && item.containerKey
  );
}

function isLocalSyncContainerItem(item: BranchTreeItem | undefined): item is BranchTreeItem {
  return Boolean(
    item &&
      item.containerScope === 'local' &&
      item.containerKey &&
      (item.nodeType === 'folder' || item.nodeType === 'section')
  );
}

function resolveBranchScope(branch: Pick<BranchInfo, 'scope'>): FolderActionScope | 'stash' | 'worktree' {
  return branch.scope ?? 'local';
}

function getContainerLabel(item: BranchTreeItem): string {
  if (item.nodeType === 'section' && typeof item.label === 'string') {
    return item.label;
  }

  return item.containerPath ?? (typeof item.label === 'string' ? item.label : 'folder');
}

function buildFolderSyncResultMessage(folderLabel: string, result: BulkSyncResult): string {
  if (result.processed.length === 0 && result.skippedNeedsPublish.length > 0 && result.failed.length === 0) {
    return [
      `No tracked local branches were found under '${folderLabel}'.`,
      `Needs publishing: ${formatNameList(result.skippedNeedsPublish)}.`,
    ].join(' ');
  }

  const attemptedCount = result.processed.length + result.failed.length;
  const syncedCount = result.processed.filter((branch) => branch.didPull || branch.didPush).length;
  const upToDateCount = countUpToDateSyncs(result.processed);
  const parts = [
    `Processed ${attemptedCount} tracked local ${pluralize('branch', attemptedCount)} under '${folderLabel}'.`,
  ];

  const details: string[] = [];
  if (syncedCount > 0) {
    details.push(`${syncedCount} synced`);
  }
  if (upToDateCount > 0) {
    details.push(`${upToDateCount} already up to date`);
  }
  if (result.skippedNeedsPublish.length > 0) {
    details.push(`${result.skippedNeedsPublish.length} need publishing`);
  }
  if (result.failed.length > 0) {
    details.push(`${result.failed.length} failed`);
  }

  if (details.length > 0) {
    parts.push(`Summary: ${details.join(', ')}.`);
  }

  if (result.failed.length > 0) {
    parts.push(`Failures: ${formatFailureList(result.failed)}.`);
  }

  if (result.skippedNeedsPublish.length > 0) {
    parts.push(`Needs publishing: ${formatNameList(result.skippedNeedsPublish)}.`);
  }

  return parts.join(' ');
}

function buildFolderPushResultMessage(folderLabel: string, result: BulkPushResult): string {
  const attemptedCount = result.processed.length + result.failed.length;
  const publishedCount = result.processed.filter((branch) => branch.publishedUpstream).length;
  const pushedCount = result.processed.filter(
    (branch) => branch.didPush && !branch.publishedUpstream
  ).length;
  const upToDateCount = countUpToDateSyncs(result.processed);
  const parts = [
    `Processed ${attemptedCount} local ${pluralize('branch', attemptedCount)} under '${folderLabel}'.`,
  ];

  const details: string[] = [];
  if (pushedCount > 0) {
    details.push(`${pushedCount} pushed`);
  }
  if (publishedCount > 0) {
    details.push(`${publishedCount} published`);
  }
  if (upToDateCount > 0) {
    details.push(`${upToDateCount} already up to date`);
  }
  if (result.failed.length > 0) {
    details.push(`${result.failed.length} failed`);
  }

  if (details.length > 0) {
    parts.push(`Summary: ${details.join(', ')}.`);
  }

  if (result.failed.length > 0) {
    parts.push(`Failures: ${formatFailureList(result.failed)}.`);
  }

  return parts.join(' ');
}

function buildFolderDeleteResultMessage(folderLabel: string, result: BulkDeleteResult): string {
  return buildLocalDeleteResultMessage(
    result.deleted.length === 1 ? 'local branch' : 'local branches',
    `under '${folderLabel}'`,
    result
  );
}

function buildPruneResultMessage(result: BulkDeleteResult): string {
  const parts = [`Pruned ${result.deleted.length} local ${pluralize('branch', result.deleted.length)}.`];

  if (result.skippedProtected.length > 0) {
    parts.push(
      `Skipped protected ${pluralize('branch', result.skippedProtected.length)}: ${formatNameList(result.skippedProtected)}.`
    );
  }

  if (result.skippedNotFullyMerged.length > 0) {
    parts.push(
      `Skipped not fully merged ${pluralize('branch', result.skippedNotFullyMerged.length)}: ${formatNameList(result.skippedNotFullyMerged)}.`
    );
  }

  if (result.failed.length > 0) {
    parts.push(`Failures: ${formatFailureList(result.failed)}.`);
  }

  return parts.join(' ');
}

function buildNoDeletableLocalBranchesMessage(
  folderLabel: string,
  skippedCurrentTargets: readonly LocalBranchTarget[],
  skippedProtectedTargets: readonly LocalBranchTarget[] = []
): string {
  const parts = [`No non-current local branches were found under '${folderLabel}'.`];

  if (skippedProtectedTargets.length > 0) {
    parts.push(
      `Skipped protected ${pluralize('branch', skippedProtectedTargets.length)}: ${formatNameList(
        skippedProtectedTargets.map((target) => target.name)
      )}.`
    );
  }

  if (skippedCurrentTargets.length > 0) {
    parts.push(
      `Skipped current ${pluralize('branch', skippedCurrentTargets.length)}: ${formatNameList(
        skippedCurrentTargets.map((target) => target.name)
      )}.`
    );
  }

  return parts.join(' ');
}

function buildLocalDeleteResultMessage(
  subject: string,
  location: string,
  result: BulkDeleteResult
): string {
  const parts = [`Deleted ${result.deleted.length} ${subject} ${location}.`];

  if (result.skippedProtected.length > 0) {
    parts.push(
      `Skipped protected ${pluralize('branch', result.skippedProtected.length)}: ${formatNameList(result.skippedProtected)}.`
    );
  }

  if (result.skippedCurrent.length > 0) {
    parts.push(
      `Skipped current ${pluralize('branch', result.skippedCurrent.length)}: ${formatNameList(result.skippedCurrent)}.`
    );
  }

  if (result.skippedNotFullyMerged.length > 0) {
    parts.push(
      `Skipped not fully merged ${pluralize('branch', result.skippedNotFullyMerged.length)}: ${formatNameList(result.skippedNotFullyMerged)}.`
    );
  }

  if (result.failed.length > 0) {
    parts.push(`Failures: ${formatFailureList(result.failed)}.`);
  }

  return parts.join(' ');
}

function buildNamedDeleteResultMessage(
  subject: string,
  folderLabel: string,
  result: BulkDeleteResult,
  skippedStaleNames: readonly string[] = [],
  skippedProtectedNames: readonly string[] = []
): string {
  const parts = [`Deleted ${result.deleted.length} ${subject} under '${folderLabel}'.`];

  if (skippedStaleNames.length > 0) {
    parts.push(
      `Skipped stale tracking ${pluralize('ref', skippedStaleNames.length)}: ${formatNameList(skippedStaleNames)}.`
    );
  }

  if (skippedProtectedNames.length > 0) {
    parts.push(
      `Skipped protected ${pluralize('branch', skippedProtectedNames.length)}: ${formatNameList(skippedProtectedNames)}.`
    );
  }

  if (result.failed.length > 0) {
    parts.push(`Failures: ${formatFailureList(result.failed)}.`);
  }

  return parts.join(' ');
}

function buildNamePreview(names: readonly string[]): string {
  if (names.length === 0) {
    return '';
  }

  return `Targets: ${formatNameList(names, 5)}.`;
}

function formatNameList(names: readonly string[], limit = 3): string {
  if (names.length <= limit) {
    return names.join(', ');
  }

  const remaining = names.length - limit;
  return `${names.slice(0, limit).join(', ')}, and ${remaining} more`;
}

function formatFailureList(
  failures: ReadonlyArray<{
    name: string;
    reason: string;
  }>
): string {
  return failures
    .map((failure) => `${failure.name} (${failure.reason})`)
    .join('; ');
}

function countUpToDateSyncs(results: readonly SyncBranchResult[]): number {
  return results.filter((result) => !result.didPull && !result.didPush).length;
}

function pluralize(noun: string, count: number): string {
  if (count === 1) {
    return noun;
  }

  return /(s|x|z|ch|sh)$/u.test(noun) ? `${noun}es` : `${noun}s`;
}

function showNotification(kind: NotificationKind, message: string): void {
  switch (kind) {
    case 'warning':
      vscode.window.showWarningMessage(message);
      return;
    case 'error':
      vscode.window.showErrorMessage(message);
      return;
    default:
      vscode.window.showInformationMessage(message);
  }
}

function getProtectedBranchNames(): string[] {
  return normalizeConfiguredBranchNames(
    vscode.workspace
      ?.getConfiguration('gitBranchesPanel')
      .get<string[]>('protectedBranchNames', [...DEFAULT_PROTECTED_BRANCH_NAMES]) ??
      [...DEFAULT_PROTECTED_BRANCH_NAMES]
  );
}
