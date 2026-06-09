import * as vscode from 'vscode';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import { getErrorMessage } from '../errorUtils';
import { createWorktree, getWorktrees, lockWorktree, pruneWorktrees, removeWorktree, renameWorktree, unlockWorktree } from '../git';
import { BranchTreeItem } from '../treeProvider';
import { NO_CURRENT_BRANCH_MESSAGE, type CommandContext } from './shared';

const WORKTREE_PATH_PLACEHOLDER = '/path/to/your-worktree';
const PRUNE_WORKTREES_ACTION = 'Prune';

export function registerWorktreeCommands(
  context: vscode.ExtensionContext,
  commandContext: CommandContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitBranchesPanel.createWorktreeFromCurrentBranch',
      async (item?: BranchTreeItem) => {
        await handleCreateWorktreeFromCurrentBranch(item, commandContext);
      }
    ),
    vscode.commands.registerCommand(
      'gitBranchesPanel.createWorktreeFromRef',
      async (item: BranchTreeItem) => {
        await handleCreateWorktreeFromRef(item, commandContext);
      }
    ),
    vscode.commands.registerCommand('gitBranchesPanel.openWorktree', async (item: BranchTreeItem) => {
      await handleOpenWorktree(item, false);
    }),
    vscode.commands.registerCommand(
      'gitBranchesPanel.openWorktreeInNewWindow',
      async (item: BranchTreeItem) => {
        await handleOpenWorktree(item, true);
      }
    ),
    vscode.commands.registerCommand('gitBranchesPanel.revealWorktree', async (item: BranchTreeItem) => {
      await handleRevealWorktree(item);
    }),
    vscode.commands.registerCommand(
      'gitBranchesPanel.copyWorktreePath',
      async (item: BranchTreeItem) => {
        await handleCopyWorktreePath(item);
      }
    ),
    vscode.commands.registerCommand('gitBranchesPanel.renameWorktree', async (item: BranchTreeItem) => {
      await handleRenameWorktree(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.removeWorktree', async (item: BranchTreeItem) => {
      await handleRemoveWorktree(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.pruneWorktrees', async (item?: BranchTreeItem) => {
      await handlePruneWorktrees(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.lockWorktree', async (item: BranchTreeItem) => {
      await handleLockWorktree(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.unlockWorktree', async (item: BranchTreeItem) => {
      await handleUnlockWorktree(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.copyWorktreeRef', async (item: BranchTreeItem) => {
      await handleCopyWorktreeRef(item);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.openWorktreeInTerminal', async (item: BranchTreeItem) => {
      await handleOpenWorktreeInTerminal(item);
    })
  );
}

async function handleCreateWorktreeFromRef(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  const source = resolveWorktreeSourceFromItem(item);
  if (!source) {
    return;
  }

  await promptAndCreateWorktree(source, commandContext);
}

async function handleCreateWorktreeFromCurrentBranch(
  item: BranchTreeItem | undefined,
  commandContext: CommandContext
): Promise<void> {
  if (item && (item.nodeType !== 'section' || item.containerPath !== 'section:worktree')) {
    return;
  }

  const repoRoot = item?.repoRoot ?? (await commandContext.requireRepoRoot());
  if (!repoRoot) {
    return;
  }

  const currentBranch = await commandContext.requireCurrentBranch(
    NO_CURRENT_BRANCH_MESSAGE,
    repoRoot
  );
  if (!currentBranch) {
    return;
  }

  await promptAndCreateWorktree(
    {
      branchName: currentBranch.name,
      prompt: `Enter a path for the new worktree from current branch '${currentBranch.name}'`,
      refName: currentBranch.name,
      repoRoot,
      shouldDetach: false,
      successMessage: (worktreeLabel) =>
        `Created worktree '${worktreeLabel}' from current branch '${currentBranch.name}'.`,
    },
    commandContext
  );
}

interface WorktreeCreationSource {
  readonly branchName: string;
  readonly prompt: string;
  readonly refName: string;
  readonly repoRoot: string;
  readonly shouldDetach: boolean;
  successMessage(worktreeLabel: string): string;
}

async function promptAndCreateWorktree(
  source: WorktreeCreationSource,
  commandContext: CommandContext
): Promise<void> {
  const worktreePathInput = await vscode.window.showInputBox({
    prompt: source.prompt,
    placeHolder: WORKTREE_PATH_PLACEHOLDER,
    value: buildSuggestedWorktreePath(source.repoRoot, source.branchName),
    validateInput: (value) => validateWorktreePath(value, source.repoRoot),
  });
  if (!worktreePathInput) {
    return;
  }

  const worktreePath = resolveWorktreePath(source.repoRoot, worktreePathInput);
  const worktreeLabel = basename(worktreePath) || worktreePath;

  try {
    await createWorktree(source.repoRoot, worktreePath, source.refName, {
      detach: source.shouldDetach,
    });
    await commandContext.showSuccessAndRefresh(source.successMessage(worktreeLabel), {
      fetchRemoteState: false,
    });
  } catch (error) {
    commandContext.showCommandError(`Failed to create a worktree from '${source.branchName}'`, error);
  }
}

async function handleOpenWorktree(
  item: BranchTreeItem,
  forceNewWindow: boolean
): Promise<void> {
  if (!item.branchName || item.nodeType !== 'worktree') {
    return;
  }

  await vscode.commands.executeCommand(
    'vscode.openFolder',
    vscode.Uri.file(item.branchName),
    forceNewWindow
  );
}

async function handleRevealWorktree(item: BranchTreeItem): Promise<void> {
  if (!item.branchName || item.nodeType !== 'worktree') {
    return;
  }

  await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(item.branchName));
}

async function handleCopyWorktreePath(item: BranchTreeItem): Promise<void> {
  if (!item.branchName || item.nodeType !== 'worktree') {
    return;
  }

  await vscode.env.clipboard.writeText(item.branchName);
  vscode.window.showInformationMessage(`Copied worktree path '${item.branchName}' to the clipboard.`);
}

async function handleCopyWorktreeRef(item: BranchTreeItem): Promise<void> {
  if (!item.branchName || item.nodeType !== 'worktree') {
    return;
  }

  const worktreeRef = item.branchInfo?.worktreeRef;
  if (!worktreeRef) {
    vscode.window.showInformationMessage(`No worktree reference is available for '${item.branchName}'.`);
    return;
  }

  await vscode.env.clipboard.writeText(worktreeRef);
  vscode.window.showInformationMessage(`Copied worktree reference '${worktreeRef}' to the clipboard.`);
}

async function handleOpenWorktreeInTerminal(item: BranchTreeItem): Promise<void> {
  if (!item.branchName || item.nodeType !== 'worktree') {
    return;
  }

  const worktreeLabel = basename(item.branchName) || item.branchName;
  const terminal = vscode.window.createTerminal({
    name: `Worktree: ${worktreeLabel}`,
    cwd: item.branchName,
  });
  terminal.show();
}

async function handleRenameWorktree(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!item.branchName || !item.repoRoot || item.nodeType !== 'worktree') {
    return;
  }

  const currentWorktreePath = item.branchName;
  const repoRoot = item.repoRoot;

  if (item.branchInfo?.isCurrent) {
    vscode.window.showInformationMessage('Cannot rename the current worktree.');
    return;
  }

  if (item.branchInfo?.worktreePrunableReason) {
    vscode.window.showInformationMessage('Cannot rename a prunable worktree. Prune stale worktree metadata first.');
    return;
  }

  if (item.branchInfo?.worktreeLockedReason) {
    vscode.window.showInformationMessage('Cannot rename a locked worktree. Unlock it first.');
    return;
  }

  const worktreeLabel = basename(currentWorktreePath) || currentWorktreePath;
  const newWorktreePathInput = await vscode.window.showInputBox({
    prompt: `Enter a new path for worktree '${worktreeLabel}'`,
    placeHolder: WORKTREE_PATH_PLACEHOLDER,
    value: currentWorktreePath,
    validateInput: (value) => validateRenamedWorktreePath(value, currentWorktreePath, repoRoot),
  });
  if (!newWorktreePathInput) {
    return;
  }

  const newWorktreePath = resolveRenamedWorktreePath(currentWorktreePath, newWorktreePathInput);
  const newWorktreeLabel = basename(newWorktreePath) || newWorktreePath;

  try {
    await renameWorktree(repoRoot, currentWorktreePath, newWorktreePath);
    await commandContext.showSuccessAndRefresh(`Renamed worktree to '${newWorktreeLabel}'.`, {
      fetchRemoteState: false,
    });
  } catch (error) {
    commandContext.showCommandError(`Failed to rename worktree '${worktreeLabel}'`, error);
  }
}

async function handleRemoveWorktree(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!item.branchName || !item.repoRoot || item.nodeType !== 'worktree') {
    return;
  }

  if (item.branchInfo?.isCurrent) {
    vscode.window.showInformationMessage('Cannot remove the current worktree.');
    return;
  }

  if (item.branchInfo?.worktreeLockedReason) {
    vscode.window.showInformationMessage('Cannot remove a locked worktree. Unlock it first.');
    return;
  }

  if (item.branchInfo?.worktreePrunableReason) {
    vscode.window.showInformationMessage('Cannot remove a prunable worktree. Prune stale worktree metadata instead.');
    return;
  }

  const worktreeLabel = basename(item.branchName) || item.branchName;
  const confirmation = await vscode.window.showWarningMessage(
    `Remove worktree '${worktreeLabel}'?`,
    { modal: true },
    'Remove'
  );
  if (confirmation !== 'Remove') {
    return;
  }

  try {
    await removeWorktree(item.repoRoot, item.branchName, false);
    await commandContext.showSuccessAndRefresh(`Removed worktree '${worktreeLabel}'.`, {
      fetchRemoteState: false,
    });
  } catch (error) {
    const message = getErrorMessage(error);
    if (!looksLikeDirtyWorktreeError(message)) {
      commandContext.showCommandError(`Failed to remove worktree '${worktreeLabel}'`, error);
      return;
    }

    const forceRemove = await vscode.window.showWarningMessage(
      `Worktree '${worktreeLabel}' has local changes or untracked files. Force remove it?`,
      { modal: true },
      'Force Remove'
    );
    if (forceRemove !== 'Force Remove') {
      return;
    }

    try {
      await removeWorktree(item.repoRoot, item.branchName, true);
      await commandContext.showSuccessAndRefresh(`Force removed worktree '${worktreeLabel}'.`, {
        fetchRemoteState: false,
      });
    } catch (forceRemoveError) {
      commandContext.showCommandError(
        `Failed to force remove worktree '${worktreeLabel}'`,
        forceRemoveError
      );
    }
  }
}

async function handlePruneWorktrees(
  item: BranchTreeItem | undefined,
  commandContext: CommandContext
): Promise<void> {
  if (item && item.nodeType !== 'repository' && !isWorktreeMaintenanceItem(item)) {
    return;
  }

  const repoRoot = item?.repoRoot ?? (await commandContext.requireRepoRoot());
  if (!repoRoot) {
    return;
  }

  const prunableWorktrees = (await getWorktrees(repoRoot)).filter(
    (worktree) => worktree.worktreePrunableReason
  );
  const prunableWorktreeLabels = prunableWorktrees.map(
    (worktree) => basename(worktree.name) || worktree.name
  );

  if (prunableWorktreeLabels.length === 0) {
    vscode.window.showInformationMessage(
      item?.nodeType === 'worktree'
        ? 'No prunable worktree metadata was found for that item.'
        : 'No prunable worktree metadata was found for this repository.'
    );
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    prunableWorktreeLabels.length > 0
      ? `Prune stale worktree metadata for ${prunableWorktreeLabels.join(', ')}? This only removes broken worktree admin entries, not any existing directories.`
      : 'Prune stale worktree metadata for this repository? This only removes broken worktree admin entries, not any existing directories.',
    { modal: true },
    PRUNE_WORKTREES_ACTION
  );
  if (confirmation !== PRUNE_WORKTREES_ACTION) {
    return;
  }

  try {
    await pruneWorktrees(repoRoot);
    await commandContext.showSuccessAndRefresh('Pruned stale worktree metadata.', {
      sections: ['worktree'],
      repoRoots: [repoRoot],
      fetchRemoteState: false,
    });
  } catch (error) {
    commandContext.showCommandError('Failed to prune stale worktree metadata', error);
  }
}

async function handleLockWorktree(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!isWorktreeItem(item)) {
    return;
  }

  if (item.branchInfo?.isCurrent) {
    vscode.window.showInformationMessage('Cannot lock the current worktree.');
    return;
  }

  if (item.branchInfo?.worktreePrunableReason) {
    vscode.window.showInformationMessage('Cannot lock a prunable worktree. Prune stale metadata instead.');
    return;
  }

  if (item.branchInfo?.worktreeLockedReason) {
    vscode.window.showInformationMessage('This worktree is already locked.');
    return;
  }

  const worktreeLabel = basename(item.branchName) || item.branchName;
  const reasonInput = await vscode.window.showInputBox({
    prompt: `Enter an optional lock reason for worktree '${worktreeLabel}'`,
    placeHolder: 'Optional lock reason',
    value: '',
  });
  if (reasonInput === undefined) {
    return;
  }

  try {
    await lockWorktree(item.repoRoot, item.branchName, reasonInput);
    await commandContext.showSuccessAndRefresh(
      reasonInput.trim()
        ? `Locked worktree '${worktreeLabel}' (${reasonInput.trim()}).`
        : `Locked worktree '${worktreeLabel}'.`,
      {
        sections: ['worktree'],
        repoRoots: [item.repoRoot],
        fetchRemoteState: false,
      }
    );
  } catch (error) {
    commandContext.showCommandError(`Failed to lock worktree '${worktreeLabel}'`, error);
  }
}

async function handleUnlockWorktree(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!isWorktreeItem(item)) {
    return;
  }

  if (!item.branchInfo?.worktreeLockedReason) {
    vscode.window.showInformationMessage('This worktree is not locked.');
    return;
  }

  const worktreeLabel = basename(item.branchName) || item.branchName;

  try {
    await unlockWorktree(item.repoRoot, item.branchName);
    await commandContext.showSuccessAndRefresh(`Unlocked worktree '${worktreeLabel}'.`, {
      sections: ['worktree'],
      repoRoots: [item.repoRoot],
      fetchRemoteState: false,
    });
  } catch (error) {
    commandContext.showCommandError(`Failed to unlock worktree '${worktreeLabel}'`, error);
  }
}

function looksLikeDirtyWorktreeError(message: string): boolean {
  return /(not clean|contains modified or untracked files|use --force)/i.test(message);
}

function isWorktreeItem(
  item: BranchTreeItem
): item is BranchTreeItem & { branchName: string; repoRoot: string } {
  return Boolean(item.branchName && item.repoRoot && item.nodeType === 'worktree');
}

function isWorktreeMaintenanceItem(
  item: BranchTreeItem
): item is BranchTreeItem & { repoRoot: string } {
  return Boolean(
    item.repoRoot &&
      ((item.nodeType === 'section' && item.containerPath === 'section:worktree') ||
        (item.nodeType === 'worktree' && item.branchInfo?.worktreePrunableReason))
  );
}

function isWorktreeSourceItem(item: BranchTreeItem): boolean {
  return (
    item.nodeType === 'branch' ||
    item.nodeType === 'currentBranch' ||
    item.nodeType === 'missingUpstreamBranch' ||
    item.nodeType === 'remoteBranch' ||
    item.nodeType === 'staleRemoteBranch' ||
    item.nodeType === 'tag'
  );
}

function shouldDetachWorktreeSource(item: BranchTreeItem): boolean {
  return (
    item.nodeType === 'tag' ||
    item.nodeType === 'remoteBranch' ||
    item.nodeType === 'staleRemoteBranch'
  );
}

function resolveWorktreeSourceFromItem(
  item: BranchTreeItem
): WorktreeCreationSource | undefined {
  if (!item.branchName || !item.repoRoot || !isWorktreeSourceItem(item)) {
    return undefined;
  }

  const shouldDetach = shouldDetachWorktreeSource(item);

  return {
    branchName: item.branchName,
    prompt: buildCreateWorktreePrompt(item, shouldDetach),
    refName: resolveWorktreeRef(item),
    repoRoot: item.repoRoot,
    shouldDetach,
    successMessage: (worktreeLabel) =>
      shouldDetach
        ? `Created detached worktree '${worktreeLabel}' from '${item.branchName}'.`
        : `Created worktree '${worktreeLabel}' from '${item.branchName}'.`,
  };
}

function buildCreateWorktreePrompt(item: BranchTreeItem, shouldDetach: boolean): string {
  if (!shouldDetach) {
    return `Enter a path for the new worktree from '${item.branchName}'`;
  }

  if (item.nodeType === 'tag') {
    return `Enter a path for a detached worktree from tag '${item.branchName}'`;
  }

  return `Enter a path for a detached worktree from '${item.branchName}'`;
}

function resolveWorktreeRef(item: BranchTreeItem): string {
  return item.nodeType === 'tag' ? `refs/tags/${item.branchName}` : item.branchName ?? '';
}

function buildSuggestedWorktreePath(repoRoot: string, refName: string): string {
  const repoName = basename(repoRoot) || 'worktree';
  const refSuffix = refName
    .replace(/[\\/]+/gu, '-')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-+|-+$/gu, '');

  return join(dirname(repoRoot), `${repoName}-${refSuffix || 'worktree'}`);
}

function validateWorktreePath(value: string, repoRoot: string): string | undefined {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return 'Worktree path cannot be empty.';
  }

  const resolvedPath = resolveWorktreePath(repoRoot, trimmedValue);
  if (resolvedPath === repoRoot) {
    return 'Worktree path must be different from the repository root.';
  }

  return undefined;
}

function validateRenamedWorktreePath(
  value: string,
  currentWorktreePath: string,
  repoRoot: string
): string | undefined {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return 'Worktree path cannot be empty.';
  }

  const resolvedPath = resolveRenamedWorktreePath(currentWorktreePath, trimmedValue);
  if (resolvedPath === currentWorktreePath) {
    return 'Worktree path must be different from the current path.';
  }

  if (resolvedPath === repoRoot) {
    return 'Worktree path must be different from the repository root.';
  }

  return undefined;
}

function resolveWorktreePath(repoRoot: string, worktreePath: string): string {
  return isAbsolute(worktreePath) ? worktreePath : resolve(repoRoot, worktreePath);
}

function resolveRenamedWorktreePath(currentWorktreePath: string, worktreePath: string): string {
  return isAbsolute(worktreePath)
    ? worktreePath
    : resolve(dirname(currentWorktreePath), worktreePath);
}
