import * as vscode from 'vscode';

import { type BranchInfo } from './branchModel';
import { formatErrorMessage, getErrorMessage } from './errorUtils';
import {
  checkoutBranch,
  checkoutRemoteBranch,
  checkoutTag,
  createBranch,
  deleteRemoteBranch,
  deleteBranch,
  deleteTag,
  fetchRemoteState,
  mergeBranchIntoCurrent,
  renameBranch,
  syncBranch,
} from './git';
import {
  BranchItemActivationTracker,
  buildCurrentBranchAlreadyCheckedOutMessage,
  buildRemoteBranchCheckoutMessage,
  buildSyncResultMessage,
  looksLikeMergeSafetyError,
  validateBranchName,
} from './extensionHelpers';
import { resetTrackerAndRefresh } from './providerRefresh';
import { BranchTreeItem, BranchTreeProvider, type BranchLoadOptions } from './treeProvider';

const NO_REPOSITORY_MESSAGE = 'No git repository found in the current workspace.';
const NO_CURRENT_BRANCH_MESSAGE = 'No current git branch was found.';

export function registerBranchCommands(
  context: vscode.ExtensionContext,
  provider: BranchTreeProvider,
  activationTracker: BranchItemActivationTracker
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('gitBranchesPanel.refresh', async () => {
      await handleRefresh(provider, activationTracker);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.fetchAll', async () => {
      await handleFetchAll(provider, activationTracker);
    }),
    vscode.commands.registerCommand(
      'gitBranchesPanel.activateBranchItem',
      async (item: BranchTreeItem) => {
        await handleBranchItemActivation(item, provider, activationTracker);
      }
    ),
    vscode.commands.registerCommand('gitBranchesPanel.checkout', async (item: BranchTreeItem) => {
      await handleCheckout(item, provider, activationTracker, true);
    }),
    vscode.commands.registerCommand(
      'gitBranchesPanel.checkoutTag',
      async (item: BranchTreeItem) => {
        await handleCheckoutTag(item, provider, activationTracker);
      }
    ),
    vscode.commands.registerCommand('gitBranchesPanel.syncCurrentBranch', async () => {
      await handleSyncCurrentBranch(provider, activationTracker);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.syncBranch', async (item: BranchTreeItem) => {
      await handleSyncBranch(item, provider, activationTracker);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.deleteBranch', async (item: BranchTreeItem) => {
      await handleDeleteBranch(item, provider, activationTracker);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.newBranch', async () => {
      await handleNewBranch(provider, activationTracker);
    }),
    vscode.commands.registerCommand(
      'gitBranchesPanel.renameBranch',
      async (item: BranchTreeItem) => {
        await handleRenameBranch(item, provider, activationTracker);
      }
    ),
    vscode.commands.registerCommand(
      'gitBranchesPanel.copyBranchName',
      async (item: BranchTreeItem) => {
        await handleCopyBranchName(item);
      }
    ),
    vscode.commands.registerCommand('gitBranchesPanel.copyTagName', async (item: BranchTreeItem) => {
      await handleCopyTagName(item);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.deleteTag', async (item: BranchTreeItem) => {
      await handleDeleteTag(item, provider, activationTracker);
    }),
    vscode.commands.registerCommand(
      'gitBranchesPanel.mergeIntoCurrent',
      async (item: BranchTreeItem) => {
        await handleMergeIntoCurrent(item, provider, activationTracker);
      }
    )
  );
}

async function handleRefresh(
  provider: BranchTreeProvider,
  activationTracker: BranchItemActivationTracker
): Promise<void> {
  await resetTrackerAndRefresh(provider, activationTracker, { fetchRemoteState: true });
}

async function handleFetchAll(
  provider: BranchTreeProvider,
  activationTracker: BranchItemActivationTracker
): Promise<void> {
  const repoRoot = await requireRepoRoot(provider);
  if (!repoRoot) {
    return;
  }

  try {
    await fetchRemoteState(repoRoot);
    await showSuccessAndRefresh(
      'Fetched all remotes and refreshed branch status.',
      provider,
      activationTracker,
      { fetchRemoteState: false }
    );
  } catch (error) {
    showCommandError('Failed to fetch remotes', error);
  }
}

async function handleBranchItemActivation(
  item: BranchTreeItem,
  provider: BranchTreeProvider,
  activationTracker: BranchItemActivationTracker
): Promise<void> {
  if (item.nodeType !== 'branch') {
    return;
  }

  if (!activationTracker.shouldCheckout(item)) {
    return;
  }

  await handleCheckout(item, provider, activationTracker, false);
}

async function handleCheckout(
  item: BranchTreeItem,
  provider: BranchTreeProvider,
  activationTracker: BranchItemActivationTracker,
  allowCurrentBranchMessage = true
): Promise<void> {
  if (!item.branchName || !item.repoRoot) {
    return;
  }

  if (item.nodeType === 'currentBranch') {
    if (allowCurrentBranchMessage) {
      vscode.window.showInformationMessage(
        buildCurrentBranchAlreadyCheckedOutMessage(item.branchName)
      );
    }

    activationTracker.reset();
    return;
  }

  if (item.nodeType === 'remoteBranch') {
    try {
      const checkoutResult = await checkoutRemoteBranch(item.repoRoot, item.branchName);
      await showSuccessAndRefresh(
        buildRemoteBranchCheckoutMessage(checkoutResult),
        provider,
        activationTracker,
        { fetchRemoteState: false }
      );
    } catch (error) {
      showCommandError(`Failed to checkout '${item.branchName}'`, error);
    }

    return;
  }

  try {
    await checkoutBranch(item.repoRoot, item.branchName);
    await showSuccessAndRefresh(
      `Switched to '${item.branchName}'.`,
      provider,
      activationTracker,
      { fetchRemoteState: false }
    );
  } catch (error) {
    showCommandError(`Failed to checkout '${item.branchName}'`, error);
  }
}

async function handleCheckoutTag(
  item: BranchTreeItem,
  provider: BranchTreeProvider,
  activationTracker: BranchItemActivationTracker
): Promise<void> {
  if (!item.branchName || !item.repoRoot || item.nodeType !== 'tag') {
    return;
  }

  try {
    await checkoutTag(item.repoRoot, item.branchName);
    await showSuccessAndRefresh(
      `Checked out tag '${item.branchName}'. HEAD is now detached at that tag.`,
      provider,
      activationTracker,
      { fetchRemoteState: false }
    );
  } catch (error) {
    showCommandError(`Failed to checkout tag '${item.branchName}'`, error);
  }
}

async function handleSyncCurrentBranch(
  provider: BranchTreeProvider,
  activationTracker: BranchItemActivationTracker
): Promise<void> {
  const repoRoot = await resolveRepoRoot(provider);
  const currentBranch = await resolveCurrentBranch(provider);

  if (!repoRoot || !currentBranch) {
    vscode.window.showErrorMessage(NO_CURRENT_BRANCH_MESSAGE);
    return;
  }

  await syncBranchByName(repoRoot, currentBranch.name, provider, activationTracker);
}

async function handleSyncBranch(
  item: BranchTreeItem,
  provider: BranchTreeProvider,
  activationTracker: BranchItemActivationTracker
): Promise<void> {
  if (!item.branchName || !item.repoRoot) {
    return;
  }

  await syncBranchByName(item.repoRoot, item.branchName, provider, activationTracker);
}

async function handleDeleteBranch(
  item: BranchTreeItem,
  provider: BranchTreeProvider,
  activationTracker: BranchItemActivationTracker
): Promise<void> {
  if (!item.branchName || !item.repoRoot) {
    return;
  }

  if (item.nodeType === 'remoteBranch') {
    const confirmation = await vscode.window.showWarningMessage(
      `Delete remote branch '${item.branchName}'?`,
      { modal: true },
      'Delete'
    );
    if (confirmation !== 'Delete') {
      return;
    }

    try {
      await deleteRemoteBranch(item.repoRoot, item.branchName);
      await showSuccessAndRefresh(
        `Deleted remote branch '${item.branchName}'.`,
        provider,
        activationTracker,
        { fetchRemoteState: true, forceFetchRemoteState: true }
      );
    } catch (error) {
      showCommandError(`Failed to delete remote branch '${item.branchName}'`, error);
    }

    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    `Delete branch '${item.branchName}'?`,
    { modal: true },
    'Delete'
  );
  if (confirmation !== 'Delete') {
    return;
  }

  try {
    await deleteBranch(item.repoRoot, item.branchName, false);
    await showSuccessAndRefresh(
      `Deleted branch '${item.branchName}'.`,
      provider,
      activationTracker
    );
  } catch (error) {
    const message = getErrorMessage(error);
    if (!looksLikeMergeSafetyError(message)) {
      showCommandError(`Failed to delete '${item.branchName}'`, error);
      return;
    }

    const forceDelete = await vscode.window.showWarningMessage(
      `Branch '${item.branchName}' is not fully merged. Force delete it?`,
      { modal: true },
      'Force Delete'
    );
    if (forceDelete !== 'Force Delete') {
      return;
    }

    try {
      await deleteBranch(item.repoRoot, item.branchName, true);
      await showSuccessAndRefresh(
        `Force deleted branch '${item.branchName}'.`,
        provider,
        activationTracker
      );
    } catch (forceDeleteError) {
      showCommandError(`Failed to force delete '${item.branchName}'`, forceDeleteError);
    }
  }
}

async function handleNewBranch(
  provider: BranchTreeProvider,
  activationTracker: BranchItemActivationTracker
): Promise<void> {
  const repoRoot = await requireRepoRoot(provider);
  if (!repoRoot) {
    return;
  }

  const name = await vscode.window.showInputBox({
    prompt: 'Enter a name for the new branch',
    placeHolder: 'feature/my-feature or hotfix/bug-123',
    validateInput: (value) => validateBranchName(value),
  });
  if (!name) {
    return;
  }

  const branchName = name.trim();

  try {
    await createBranch(repoRoot, branchName);
    await showSuccessAndRefresh(
      `Created and switched to '${branchName}'.`,
      provider,
      activationTracker
    );
  } catch (error) {
    showCommandError(`Failed to create '${branchName}'`, error);
  }
}

async function handleRenameBranch(
  item: BranchTreeItem,
  provider: BranchTreeProvider,
  activationTracker: BranchItemActivationTracker
): Promise<void> {
  if (!item.branchName || !item.repoRoot) {
    return;
  }

  const newName = await vscode.window.showInputBox({
    prompt: `Rename '${item.branchName}' to:`,
    value: item.branchName,
    validateInput: (value) => validateBranchName(value, item.branchName),
  });
  if (!newName) {
    return;
  }

  const branchName = newName.trim();

  try {
    await renameBranch(item.repoRoot, item.branchName, branchName);
    await showSuccessAndRefresh(
      `Renamed branch to '${branchName}'.`,
      provider,
      activationTracker
    );
  } catch (error) {
    showCommandError(`Failed to rename '${item.branchName}'`, error);
  }
}

async function handleCopyBranchName(item: BranchTreeItem): Promise<void> {
  if (!item.branchName) {
    return;
  }

  await vscode.env.clipboard.writeText(item.branchName);
  vscode.window.showInformationMessage(`Copied '${item.branchName}' to the clipboard.`);
}

async function handleCopyTagName(item: BranchTreeItem): Promise<void> {
  if (!item.branchName) {
    return;
  }

  await vscode.env.clipboard.writeText(item.branchName);
  vscode.window.showInformationMessage(`Copied tag '${item.branchName}' to the clipboard.`);
}

async function handleDeleteTag(
  item: BranchTreeItem,
  provider: BranchTreeProvider,
  activationTracker: BranchItemActivationTracker
): Promise<void> {
  if (!item.branchName || !item.repoRoot || item.nodeType !== 'tag') {
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    `Delete tag '${item.branchName}'?`,
    { modal: true },
    'Delete'
  );
  if (confirmation !== 'Delete') {
    return;
  }

  try {
    await deleteTag(item.repoRoot, item.branchName);
    await showSuccessAndRefresh(
      `Deleted tag '${item.branchName}'.`,
      provider,
      activationTracker,
      { fetchRemoteState: false }
    );
  } catch (error) {
    showCommandError(`Failed to delete tag '${item.branchName}'`, error);
  }
}

async function handleMergeIntoCurrent(
  item: BranchTreeItem,
  provider: BranchTreeProvider,
  activationTracker: BranchItemActivationTracker
): Promise<void> {
  if (!item.branchName || !item.repoRoot || item.nodeType === 'currentBranch') {
    return;
  }

  const currentBranch = await requireCurrentBranch(
    provider,
    'Could not determine the current branch for this repository.'
  );
  if (!currentBranch) {
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    `Merge '${item.branchName}' into current branch '${currentBranch.name}'?`,
    { modal: true },
    'Merge'
  );
  if (confirmation !== 'Merge') {
    return;
  }

  try {
    await mergeBranchIntoCurrent(item.repoRoot, item.branchName);
    await showSuccessAndRefresh(
      `Merged '${item.branchName}' into '${currentBranch.name}'.`,
      provider,
      activationTracker,
      { fetchRemoteState: false }
    );
  } catch (error) {
    showCommandError(
      `Failed to merge '${item.branchName}' into '${currentBranch.name}'`,
      error
    );
  }
}

async function requireRepoRoot(provider: BranchTreeProvider): Promise<string | undefined> {
  const repoRoot = await resolveRepoRoot(provider);
  if (repoRoot) {
    return repoRoot;
  }

  vscode.window.showErrorMessage(NO_REPOSITORY_MESSAGE);
  return undefined;
}

async function requireCurrentBranch(
  provider: BranchTreeProvider,
  missingBranchMessage: string
): Promise<BranchInfo | undefined> {
  const currentBranch = await resolveCurrentBranch(provider);
  if (currentBranch) {
    return currentBranch;
  }

  vscode.window.showErrorMessage(missingBranchMessage);
  return undefined;
}

async function resolveRepoRoot(provider: BranchTreeProvider): Promise<string | null> {
  const existingRepoRoot = provider.getRepoRoot();
  if (existingRepoRoot) {
    return existingRepoRoot;
  }

  await provider.refresh({ fetchRemoteState: true });
  return provider.getRepoRoot();
}

async function resolveCurrentBranch(provider: BranchTreeProvider): Promise<BranchInfo | undefined> {
  const currentBranch = provider.getCurrentBranch();
  if (currentBranch) {
    return currentBranch;
  }

  await provider.refresh({ fetchRemoteState: true });
  return provider.getCurrentBranch();
}

async function syncBranchByName(
  repoRoot: string,
  branchName: string,
  provider: BranchTreeProvider,
  activationTracker: BranchItemActivationTracker
): Promise<void> {
  try {
    const syncResult = await syncBranch(repoRoot, branchName);
    await showSuccessAndRefresh(
      buildSyncResultMessage(syncResult),
      provider,
      activationTracker,
      { fetchRemoteState: true, forceFetchRemoteState: true }
    );
  } catch (error) {
    showCommandError(`Failed to sync '${branchName}'`, error);
  }
}

async function showSuccessAndRefresh(
  message: string,
  provider: BranchTreeProvider,
  activationTracker: BranchItemActivationTracker,
  refreshOptions: BranchLoadOptions = {}
): Promise<void> {
  vscode.window.showInformationMessage(message);
  await resetTrackerAndRefresh(provider, activationTracker, refreshOptions);
}

function showCommandError(prefix: string, error: unknown): void {
  vscode.window.showErrorMessage(formatErrorMessage(prefix, error));
}
