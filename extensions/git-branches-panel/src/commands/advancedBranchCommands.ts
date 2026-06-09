import * as vscode from 'vscode';

import {
  forcePushBranch,
  getGitOperationState,
  getWorkingTreeStatus,
  rebaseBranchOnto,
  resetCurrentBranchToRef,
  squashMergeIntoCurrent,
  type ResetMode,
} from '../git';
import { BranchTreeItem } from '../treeProvider';
import { NO_CURRENT_BRANCH_MESSAGE, type CommandContext } from './shared';

const ENABLE_FORCE_PUSH_WITH_LEASE_SETTING = 'advanced.enableForcePushWithLease';
const DEFAULT_RESET_MODE_SETTING = 'advanced.defaultResetMode';
const ALLOW_NON_CURRENT_BRANCH_REBASE_SETTING = 'advanced.allowNonCurrentBranchRebase';
const REBASE_AUTOSTASH_SETTING = 'advanced.rebaseAutostash';
const FORCE_PUSH_ACTION = 'Force Push with Lease';

interface AdvancedBranchConfiguration {
  enableForcePushWithLease: boolean;
  defaultResetMode: ResetMode;
  allowNonCurrentBranchRebase: boolean;
  rebaseAutostash: boolean;
}

interface AdvancedBranchActionQuickPickItem extends vscode.QuickPickItem {
  run(): Promise<void>;
}

interface AdvancedOperationTarget {
  branchInfo?: BranchTreeItem['branchInfo'];
  branchName: string;
  nodeType: BranchTreeItem['nodeType'];
  repoRoot: string;
}

interface ResetModeQuickPickItem extends vscode.QuickPickItem {
  mode: ResetMode;
}

interface RebaseAutostashQuickPickItem extends vscode.QuickPickItem {
  autostash?: boolean;
}

export function registerAdvancedBranchCommands(
  context: vscode.ExtensionContext,
  commandContext: CommandContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitBranchesPanel.showAdvancedBranchOperations',
      async (item?: BranchTreeItem) => {
        await handleShowAdvancedBranchOperations(item, commandContext);
      }
    ),
    vscode.commands.registerCommand(
      'gitBranchesPanel.rebaseCurrentOntoSelected',
      async (item: BranchTreeItem) => {
        await handleRebaseCurrentOntoSelected(item, commandContext);
      }
    ),
    vscode.commands.registerCommand(
      'gitBranchesPanel.rebaseSelectedOntoCurrent',
      async (item: BranchTreeItem) => {
        await handleRebaseSelectedOntoCurrent(item, commandContext);
      }
    ),
    vscode.commands.registerCommand(
      'gitBranchesPanel.squashMergeIntoCurrent',
      async (item: BranchTreeItem) => {
        await handleSquashMergeIntoCurrent(item, commandContext);
      }
    ),
    vscode.commands.registerCommand(
      'gitBranchesPanel.resetCurrentToSelected',
      async (item: BranchTreeItem) => {
        await handleResetCurrentToSelected(item, commandContext);
      }
    ),
    vscode.commands.registerCommand(
      'gitBranchesPanel.forcePushWithLease',
      async (item?: BranchTreeItem) => {
        await handleForcePushWithLease(item, commandContext);
      }
    )
  );
}

async function handleShowAdvancedBranchOperations(
  item: BranchTreeItem | undefined,
  commandContext: CommandContext
): Promise<void> {
  const target = await resolveAdvancedOperationTarget(item, commandContext);
  if (!target) {
    return;
  }

  const currentBranch = await commandContext.requireCurrentBranch(
    NO_CURRENT_BRANCH_MESSAGE,
    target.repoRoot
  );
  if (!currentBranch) {
    return;
  }

  const configuration = getAdvancedBranchConfiguration();
  const actionItems = buildAdvancedBranchActionItems(target, currentBranch, configuration);
  if (actionItems.length === 0) {
    vscode.window.showInformationMessage(
      `No advanced branch operations are available for '${target.branchName}'.`
    );
    return;
  }

  const selection = await vscode.window.showQuickPick(actionItems, {
    placeHolder: `Choose an advanced branch operation for '${target.branchName}'`,
    matchOnDescription: true,
  });
  if (!selection) {
    return;
  }

  await selection.run();
}

async function handleRebaseCurrentOntoSelected(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  const target = toAdvancedOperationTarget(item);
  if (!target || !canRebaseCurrentOntoSelected(target)) {
    return;
  }

  const currentBranch = await commandContext.requireCurrentBranch(
    NO_CURRENT_BRANCH_MESSAGE,
    target.repoRoot
  );
  if (!currentBranch) {
    return;
  }

  if (target.branchName === currentBranch.name) {
    vscode.window.showInformationMessage(
      `Current branch '${currentBranch.name}' is already the selected ref.`
    );
    return;
  }

  if (!(await ensureNoGitOperationInProgress(target.repoRoot))) {
    return;
  }

  const autostash = await resolveRebaseAutostash(target.repoRoot, getAdvancedBranchConfiguration());
  if (autostash === undefined) {
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    `Rebase current branch '${currentBranch.name}' onto '${target.branchName}'${autostash ? ' with autostash' : ''}?`,
    { modal: true },
    'Rebase'
  );
  if (confirmation !== 'Rebase') {
    return;
  }

  try {
    await rebaseBranchOnto(target.repoRoot, currentBranch.name, target.branchName, {
      autostash,
    });
    await completeRewriteOperation({
      baseMessage: `Rebased current branch '${currentBranch.name}' onto '${target.branchName}'.`,
      branchName: currentBranch.name,
      commandContext,
      repoRoot: target.repoRoot,
      upstreamName: currentBranch.upstreamMissing ? undefined : currentBranch.upstreamName,
    });
  } catch (error) {
    commandContext.showCommandError(
      `Failed to rebase current branch '${currentBranch.name}' onto '${target.branchName}'`,
      error
    );
  }
}

async function handleRebaseSelectedOntoCurrent(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  const target = toAdvancedOperationTarget(item);
  const configuration = getAdvancedBranchConfiguration();
  if (!target || !canRebaseSelectedOntoCurrent(target, configuration)) {
    return;
  }

  const currentBranch = await commandContext.requireCurrentBranch(
    NO_CURRENT_BRANCH_MESSAGE,
    target.repoRoot
  );
  if (!currentBranch) {
    return;
  }

  if (target.branchName === currentBranch.name) {
    vscode.window.showInformationMessage(
      `Branch '${target.branchName}' is already the current branch.`
    );
    return;
  }

  if (!(await ensureNoGitOperationInProgress(target.repoRoot))) {
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    `Rebase '${target.branchName}' onto current branch '${currentBranch.name}'? This runs in a temporary worktree so your current checkout stays put.`,
    { modal: true },
    'Rebase Selected Branch'
  );
  if (confirmation !== 'Rebase Selected Branch') {
    return;
  }

  try {
    await rebaseBranchOnto(target.repoRoot, target.branchName, currentBranch.name);
    await completeRewriteOperation({
      baseMessage: `Rebased '${target.branchName}' onto current branch '${currentBranch.name}'.`,
      branchName: target.branchName,
      commandContext,
      repoRoot: target.repoRoot,
      upstreamName: target.branchInfo?.upstreamMissing ? undefined : target.branchInfo?.upstreamName,
    });
  } catch (error) {
    commandContext.showCommandError(
      `Failed to rebase '${target.branchName}' onto current branch '${currentBranch.name}'`,
      error
    );
  }
}

async function handleSquashMergeIntoCurrent(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  const target = toAdvancedOperationTarget(item);
  if (!target || !canSquashMergeIntoCurrent(target)) {
    return;
  }

  const currentBranch = await commandContext.requireCurrentBranch(
    NO_CURRENT_BRANCH_MESSAGE,
    target.repoRoot
  );
  if (!currentBranch) {
    return;
  }

  if (target.branchName === currentBranch.name) {
    vscode.window.showInformationMessage(
      `Branch '${target.branchName}' is already the current branch.`
    );
    return;
  }

  if (!(await ensureNoGitOperationInProgress(target.repoRoot))) {
    return;
  }

  if (
    !(await confirmDirtyCurrentBranchAction(
      target.repoRoot,
      'Squash Merge',
      `Current branch '${currentBranch.name}' has uncommitted changes. Squash-merging will combine them with the staged squash result.`
    ))
  ) {
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    `Squash-merge '${target.branchName}' into current branch '${currentBranch.name}'? Git will stage the combined changes without creating a commit.`,
    { modal: true },
    'Squash Merge'
  );
  if (confirmation !== 'Squash Merge') {
    return;
  }

  try {
    await squashMergeIntoCurrent(target.repoRoot, target.branchName);
    await commandContext.showSuccessAndRefresh(
      `Squash-merged '${target.branchName}' into '${currentBranch.name}'. Review the staged changes and create a commit when you're ready.`,
      {
        fetchRemoteState: false,
      }
    );
  } catch (error) {
    commandContext.showCommandError(
      `Failed to squash-merge '${target.branchName}' into '${currentBranch.name}'`,
      error
    );
  }
}

async function handleResetCurrentToSelected(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  const target = toAdvancedOperationTarget(item);
  if (!target || !canResetCurrentToSelected(target)) {
    return;
  }

  const currentBranch = await commandContext.requireCurrentBranch(
    NO_CURRENT_BRANCH_MESSAGE,
    target.repoRoot
  );
  if (!currentBranch) {
    return;
  }

  if (target.branchName === currentBranch.name) {
    vscode.window.showInformationMessage(
      `Branch '${target.branchName}' is already the current branch.`
    );
    return;
  }

  if (!(await ensureNoGitOperationInProgress(target.repoRoot))) {
    return;
  }

  const resetMode = await promptForResetMode(getAdvancedBranchConfiguration().defaultResetMode);
  if (!resetMode) {
    return;
  }

  const workingTreeStatus = await getWorkingTreeStatus(target.repoRoot);
  const confirmation = await vscode.window.showWarningMessage(
    buildResetConfirmationMessage(currentBranch.name, target.branchName, resetMode, workingTreeStatus),
    { modal: true },
    'Reset'
  );
  if (confirmation !== 'Reset') {
    return;
  }

  try {
    await resetCurrentBranchToRef(target.repoRoot, target.branchName, resetMode);
    await completeRewriteOperation({
      baseMessage: `Reset current branch '${currentBranch.name}' to '${target.branchName}' with --${resetMode}.`,
      branchName: currentBranch.name,
      commandContext,
      repoRoot: target.repoRoot,
      upstreamName: currentBranch.upstreamMissing ? undefined : currentBranch.upstreamName,
    });
  } catch (error) {
    commandContext.showCommandError(
      `Failed to reset current branch '${currentBranch.name}' to '${target.branchName}'`,
      error
    );
  }
}

async function handleForcePushWithLease(
  item: BranchTreeItem | undefined,
  commandContext: CommandContext
): Promise<void> {
  const configuration = getAdvancedBranchConfiguration();
  if (!configuration.enableForcePushWithLease) {
    vscode.window.showInformationMessage(
      'Force Push with Lease is currently disabled by settings.'
    );
    return;
  }

  const target = await resolveForcePushTarget(item, commandContext);
  if (!target) {
    return;
  }

  if (!(await ensureNoGitOperationInProgress(target.repoRoot))) {
    return;
  }

  const upstreamName = target.branchInfo?.upstreamMissing ? undefined : target.branchInfo?.upstreamName;
  if (!upstreamName) {
    vscode.window.showInformationMessage(
      `Branch '${target.branchName}' does not track a live upstream yet. Publish it before force-pushing with lease.`
    );
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    `Force-push '${target.branchName}' to '${upstreamName}' with lease? This rewrites remote history but stops if the remote branch changed unexpectedly.`,
    { modal: true },
    FORCE_PUSH_ACTION
  );
  if (confirmation !== FORCE_PUSH_ACTION) {
    return;
  }

  try {
    const result = await forcePushBranch(target.repoRoot, target.branchName);
    await commandContext.showSuccessAndRefresh(
      `Force-pushed '${result.branchName}' to '${result.upstreamName}' with lease.`,
      {
        fetchRemoteState: true,
        forceFetchRemoteState: true,
      }
    );
  } catch (error) {
    commandContext.showCommandError(
      `Failed to force-push '${target.branchName}' with lease`,
      error
    );
  }
}

async function completeRewriteOperation(options: {
  baseMessage: string;
  branchName: string;
  commandContext: CommandContext;
  repoRoot: string;
  upstreamName?: string;
}): Promise<void> {
  const configuration = getAdvancedBranchConfiguration();
  if (!configuration.enableForcePushWithLease || !options.upstreamName) {
    await options.commandContext.showSuccessAndRefresh(options.baseMessage, {
      fetchRemoteState: false,
    });
    return;
  }

  const selection = await vscode.window.showInformationMessage(
    `${options.baseMessage} Force-push '${options.branchName}' to '${options.upstreamName}' with lease now?`,
    FORCE_PUSH_ACTION,
    'Not Now'
  );

  if (selection === FORCE_PUSH_ACTION) {
    try {
      const result = await forcePushBranch(options.repoRoot, options.branchName);
      await options.commandContext.showSuccessAndRefresh(
        `${options.baseMessage} Force-pushed '${result.branchName}' to '${result.upstreamName}' with lease.`,
        {
          fetchRemoteState: true,
          forceFetchRemoteState: true,
        }
      );
      return;
    } catch (error) {
      options.commandContext.showCommandError(
        `Rewrite succeeded, but force-pushing '${options.branchName}' with lease failed`,
        error
      );
      return;
    }
  }

  await options.commandContext.refresh({
    fetchRemoteState: false,
  });
}

function buildAdvancedBranchActionItems(
  target: AdvancedOperationTarget,
  currentBranch: NonNullable<Awaited<ReturnType<CommandContext['requireCurrentBranch']>>>,
  configuration: AdvancedBranchConfiguration
): AdvancedBranchActionQuickPickItem[] {
  const actionItems: AdvancedBranchActionQuickPickItem[] = [];

  if (canRebaseCurrentOntoSelected(target) && target.branchName !== currentBranch.name) {
    actionItems.push({
      label: '$(git-merge) Rebase Current onto Selected',
      description: `Rebase '${currentBranch.name}' onto '${target.branchName}'`,
      run: async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.rebaseCurrentOntoSelected', target);
      },
    });
  }

  if (canRebaseSelectedOntoCurrent(target, configuration) && target.branchName !== currentBranch.name) {
    actionItems.push({
      label: '$(git-merge) Rebase Selected onto Current',
      description: `Rebase '${target.branchName}' onto '${currentBranch.name}' in a temporary worktree`,
      run: async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.rebaseSelectedOntoCurrent', target);
      },
    });
  }

  if (canSquashMergeIntoCurrent(target) && target.branchName !== currentBranch.name) {
    actionItems.push({
      label: '$(git-merge) Squash Merge into Current',
      description: `Stage the squashed changes from '${target.branchName}' on '${currentBranch.name}'`,
      run: async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.squashMergeIntoCurrent', target);
      },
    });
  }

  if (canResetCurrentToSelected(target) && target.branchName !== currentBranch.name) {
    actionItems.push({
      label: '$(discard) Reset Current to Selected…',
      description: `Move '${currentBranch.name}' to '${target.branchName}' with soft, mixed, or hard reset`,
      run: async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.resetCurrentToSelected', target);
      },
    });
  }

  if (canForcePushWithLease(target, configuration)) {
    actionItems.push({
      label: '$(cloud-upload) Force Push with Lease',
      description: `Safely rewrite the remote history for '${target.branchName}'`,
      run: async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.forcePushWithLease', target);
      },
    });
  }

  return actionItems;
}

function getAdvancedBranchConfiguration(): AdvancedBranchConfiguration {
  const configuration = vscode.workspace.getConfiguration('gitBranchesPanel');

  return {
    enableForcePushWithLease: configuration.get<boolean>(
      ENABLE_FORCE_PUSH_WITH_LEASE_SETTING,
      true
    ),
    defaultResetMode: configuration.get<ResetMode>(DEFAULT_RESET_MODE_SETTING, 'mixed'),
    allowNonCurrentBranchRebase: configuration.get<boolean>(
      ALLOW_NON_CURRENT_BRANCH_REBASE_SETTING,
      true
    ),
    rebaseAutostash: configuration.get<boolean>(REBASE_AUTOSTASH_SETTING, true),
  };
}

async function resolveAdvancedOperationTarget(
  item: BranchTreeItem | undefined,
  commandContext: CommandContext
): Promise<AdvancedOperationTarget | undefined> {
  if (item) {
    return toAdvancedOperationTarget(item);
  }

  const repoRoot = await commandContext.requireRepoRoot();
  if (!repoRoot) {
    return undefined;
  }

  const currentBranch = await commandContext.requireCurrentBranch(NO_CURRENT_BRANCH_MESSAGE, repoRoot);
  if (!currentBranch) {
    return undefined;
  }

  return {
    branchInfo: currentBranch,
    branchName: currentBranch.name,
    nodeType: 'currentBranch',
    repoRoot,
  };
}

async function resolveForcePushTarget(
  item: BranchTreeItem | undefined,
  commandContext: CommandContext
): Promise<AdvancedOperationTarget | undefined> {
  const target = await resolveAdvancedOperationTarget(item, commandContext);
  if (!target || !canForcePushWithLease(target, getAdvancedBranchConfiguration())) {
    return undefined;
  }

  return target;
}

function toAdvancedOperationTarget(
  item: Pick<BranchTreeItem, 'branchInfo' | 'branchName' | 'nodeType' | 'repoRoot'>
): AdvancedOperationTarget | undefined {
  if (!item.branchName || !item.repoRoot) {
    return undefined;
  }

  if (
    item.nodeType !== 'branch' &&
    item.nodeType !== 'currentBranch' &&
    item.nodeType !== 'missingUpstreamBranch' &&
    item.nodeType !== 'remoteBranch' &&
    item.nodeType !== 'staleRemoteBranch' &&
    item.nodeType !== 'tag'
  ) {
    return undefined;
  }

  return {
    branchInfo: item.branchInfo,
    branchName: item.branchName,
    nodeType: item.nodeType,
    repoRoot: item.repoRoot,
  };
}

function canRebaseCurrentOntoSelected(target: AdvancedOperationTarget): boolean {
  return (
    target.nodeType === 'branch' ||
    target.nodeType === 'missingUpstreamBranch' ||
    target.nodeType === 'remoteBranch' ||
    target.nodeType === 'staleRemoteBranch' ||
    target.nodeType === 'tag'
  );
}

function canRebaseSelectedOntoCurrent(
  target: AdvancedOperationTarget,
  configuration: AdvancedBranchConfiguration
): boolean {
  return (
    configuration.allowNonCurrentBranchRebase &&
    (target.nodeType === 'branch' || target.nodeType === 'missingUpstreamBranch')
  );
}

function canSquashMergeIntoCurrent(target: AdvancedOperationTarget): boolean {
  return canRebaseCurrentOntoSelected(target);
}

function canResetCurrentToSelected(target: AdvancedOperationTarget): boolean {
  return canRebaseCurrentOntoSelected(target);
}

function canForcePushWithLease(
  target: AdvancedOperationTarget,
  configuration: AdvancedBranchConfiguration
): boolean {
  return Boolean(
    configuration.enableForcePushWithLease &&
      (target.nodeType === 'branch' || target.nodeType === 'currentBranch') &&
      target.branchInfo?.upstreamName &&
      !target.branchInfo.upstreamMissing
  );
}

async function ensureNoGitOperationInProgress(repoRoot: string): Promise<boolean> {
  const operationState = await getGitOperationState(repoRoot);
  if (!operationState.inProgress) {
    return true;
  }

  vscode.window.showWarningMessage(
    operationState.message ?? 'A Git operation is already in progress for this repository.'
  );
  return false;
}

async function resolveRebaseAutostash(
  repoRoot: string,
  configuration: AdvancedBranchConfiguration
): Promise<boolean | undefined> {
  const workingTreeStatus = await getWorkingTreeStatus(repoRoot);
  if (!workingTreeStatus.isDirty) {
    return configuration.rebaseAutostash;
  }

  const selection = await vscode.window.showQuickPick<RebaseAutostashQuickPickItem>(
    [
      {
        label: 'Continue with autostash',
        description: 'Temporarily stash and restore your local changes during the rebase',
        detail: configuration.rebaseAutostash
          ? 'Recommended from gitBranchesPanel.advanced.rebaseAutostash'
          : undefined,
        autostash: true,
      },
      {
        label: 'Cancel',
        description: 'Leave the working tree untouched and abort the rebase',
      },
    ],
    {
      placeHolder:
        'The current working tree has local changes. Rebase needs autostash or a clean working tree.',
      matchOnDescription: true,
      matchOnDetail: true,
    }
  );

  return selection?.autostash;
}

async function confirmDirtyCurrentBranchAction(
  repoRoot: string,
  confirmationLabel: string,
  message: string
): Promise<boolean> {
  const workingTreeStatus = await getWorkingTreeStatus(repoRoot);
  if (!workingTreeStatus.isDirty) {
    return true;
  }

  const selection = await vscode.window.showWarningMessage(
    message,
    { modal: true },
    confirmationLabel
  );

  return selection === confirmationLabel;
}

async function promptForResetMode(defaultMode: ResetMode): Promise<ResetMode | undefined> {
  const resetModes: ResetModeQuickPickItem[] = [
    {
      mode: 'mixed',
      label: 'Mixed reset',
      description: 'Move HEAD and reset the index while keeping working tree changes',
    },
    {
      mode: 'soft',
      label: 'Soft reset',
      description: 'Move HEAD only and keep staged plus working tree changes',
    },
    {
      mode: 'hard',
      label: 'Hard reset',
      description: 'Move HEAD and discard staged plus unstaged tracked changes',
    },
  ].sort((left, right) => Number(right.mode === defaultMode) - Number(left.mode === defaultMode));

  const selection = await vscode.window.showQuickPick(resetModes, {
    placeHolder: 'Choose the reset mode for the current branch',
    matchOnDescription: true,
  });

  return selection?.mode;
}

function buildResetConfirmationMessage(
  currentBranchName: string,
  targetRef: string,
  resetMode: ResetMode,
  workingTreeStatus: Awaited<ReturnType<typeof getWorkingTreeStatus>>
): string {
  const impactByMode: Record<ResetMode, string> = {
    soft: 'This moves HEAD only and keeps staged plus working tree changes intact.',
    mixed: 'This moves HEAD and resets the index, but keeps working tree changes.',
    hard: 'This moves HEAD and discards staged plus unstaged tracked changes.',
  };

  const extraWarnings: string[] = [];
  if (workingTreeStatus.hasUntrackedFiles) {
    extraWarnings.push('Untracked files will remain untouched.');
  }

  if (workingTreeStatus.isDirty) {
    extraWarnings.push('The current branch already has local changes.');
  }

  return [
    `Reset current branch '${currentBranchName}' to '${targetRef}' with --${resetMode}?`,
    impactByMode[resetMode],
    ...extraWarnings,
  ].join(' ');
}
