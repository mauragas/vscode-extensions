import * as vscode from 'vscode';
import { join } from 'node:path';

import { getErrorMessage } from '../errorUtils';
import {
  checkoutBranch,
  checkoutRemoteBranch,
  createBranch,
  createBranchFromRef,
  deleteBranch,
  deleteRemoteBranch,
  getDiffFilesBetweenRefs,
  mergeBranchIntoCurrent,
  renameBranch,
  syncBranch,
} from '../git';
import {
  buildCurrentBranchAlreadyCheckedOutMessage,
  buildRemoteBranchCheckoutMessage,
  buildSyncResultMessage,
  looksLikeMergeSafetyError,
  validateBranchName,
} from '../extensionHelpers';
import { BranchTreeItem } from '../treeProvider';
import { NO_CURRENT_BRANCH_MESSAGE, type CommandContext } from './shared';

export function registerBranchDomainCommands(
  context: vscode.ExtensionContext,
  commandContext: CommandContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitBranchesPanel.activateBranchItem',
      async (item: BranchTreeItem) => {
        await handleBranchItemActivation(item, commandContext);
      }
    ),
    vscode.commands.registerCommand('gitBranchesPanel.checkout', async (item: BranchTreeItem) => {
      await handleCheckout(item, commandContext, true);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.syncCurrentBranch', async () => {
      await handleSyncCurrentBranch(commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.syncBranch', async (item: BranchTreeItem) => {
      await handleSyncBranch(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.deleteBranch', async (item: BranchTreeItem) => {
      await handleDeleteBranch(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.newBranch', async () => {
      await handleNewBranch(commandContext);
    }),
    vscode.commands.registerCommand(
      'gitBranchesPanel.newBranchFromSelected',
      async (item: BranchTreeItem) => {
        await handleCreateBranchFromSelected(item, commandContext, false);
      }
    ),
    vscode.commands.registerCommand(
      'gitBranchesPanel.newBranchFromSelectedAndCheckout',
      async (item: BranchTreeItem) => {
        await handleCreateBranchFromSelected(item, commandContext, true);
      }
    ),
    vscode.commands.registerCommand('gitBranchesPanel.renameBranch', async (item: BranchTreeItem) => {
      await handleRenameBranch(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.copyBranchName', async (item: BranchTreeItem) => {
      await handleCopyBranchName(item);
    }),
    vscode.commands.registerCommand(
      'gitBranchesPanel.compareBranchWithCurrent',
      async (item: BranchTreeItem) => {
        await handleCompareBranchWithCurrent(item, commandContext);
      }
    ),
    vscode.commands.registerCommand(
      'gitBranchesPanel.mergeIntoCurrent',
      async (item: BranchTreeItem) => {
        await handleMergeIntoCurrent(item, commandContext);
      }
    )
  );
}

async function handleBranchItemActivation(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (item.nodeType !== 'branch') {
    return;
  }

  if (!commandContext.activationTracker.shouldCheckout(item)) {
    return;
  }

  await handleCheckout(item, commandContext, false);
}

async function handleCheckout(
  item: BranchTreeItem,
  commandContext: CommandContext,
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

    commandContext.activationTracker.reset();
    return;
  }

  if (item.nodeType === 'remoteBranch') {
    try {
      const checkoutResult = await checkoutRemoteBranch(item.repoRoot, item.branchName);
      await commandContext.showSuccessAndRefresh(
        buildRemoteBranchCheckoutMessage(checkoutResult),
        { fetchRemoteState: false }
      );
    } catch (error) {
      commandContext.showCommandError(`Failed to checkout '${item.branchName}'`, error);
    }

    return;
  }

  try {
    await checkoutBranch(item.repoRoot, item.branchName);
    await commandContext.showSuccessAndRefresh(`Switched to '${item.branchName}'.`, {
      fetchRemoteState: false,
    });
  } catch (error) {
    commandContext.showCommandError(`Failed to checkout '${item.branchName}'`, error);
  }
}

async function handleSyncCurrentBranch(commandContext: CommandContext): Promise<void> {
  const repoRoot = await commandContext.requireRepoRoot();
  if (!repoRoot) {
    return;
  }

  const currentBranch = await commandContext.requireCurrentBranch(NO_CURRENT_BRANCH_MESSAGE);
  if (!currentBranch) {
    return;
  }

  await syncBranchByName(repoRoot, currentBranch.name, commandContext);
}

async function handleSyncBranch(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!item.branchName || !item.repoRoot) {
    return;
  }

  await syncBranchByName(item.repoRoot, item.branchName, commandContext);
}

async function handleDeleteBranch(
  item: BranchTreeItem,
  commandContext: CommandContext
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
      await commandContext.showSuccessAndRefresh(`Deleted remote branch '${item.branchName}'.`, {
        fetchRemoteState: true,
        forceFetchRemoteState: true,
      });
    } catch (error) {
      commandContext.showCommandError(
        `Failed to delete remote branch '${item.branchName}'`,
        error
      );
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
    await commandContext.showSuccessAndRefresh(`Deleted branch '${item.branchName}'.`);
  } catch (error) {
    const message = getErrorMessage(error);
    if (!looksLikeMergeSafetyError(message)) {
      commandContext.showCommandError(`Failed to delete '${item.branchName}'`, error);
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
      await commandContext.showSuccessAndRefresh(`Force deleted branch '${item.branchName}'.`);
    } catch (forceDeleteError) {
      commandContext.showCommandError(
        `Failed to force delete '${item.branchName}'`,
        forceDeleteError
      );
    }
  }
}

async function handleNewBranch(commandContext: CommandContext): Promise<void> {
  const repoRoot = await commandContext.requireRepoRoot();
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
    await commandContext.showSuccessAndRefresh(`Created and switched to '${branchName}'.`);
  } catch (error) {
    commandContext.showCommandError(`Failed to create '${branchName}'`, error);
  }
}

async function handleCreateBranchFromSelected(
  item: BranchTreeItem,
  commandContext: CommandContext,
  checkoutNewBranch: boolean
): Promise<void> {
  if (!item.branchName || !item.repoRoot) {
    return;
  }

  if (
    item.nodeType !== 'branch' &&
    item.nodeType !== 'currentBranch' &&
    item.nodeType !== 'remoteBranch'
  ) {
    return;
  }

  const sourceBranchName = item.branchName;
  const sourceBranchDisplayName = sourceBranchName;
  const name = await vscode.window.showInputBox({
    prompt: checkoutNewBranch
      ? `Enter a name for the new branch to create from '${sourceBranchDisplayName}' and switch to`
      : `Enter a name for the new branch to create from '${sourceBranchDisplayName}'`,
    placeHolder: 'feature/my-feature or hotfix/bug-123',
    validateInput: (value) =>
      validateBranchName(
        value,
        item.nodeType === 'remoteBranch' ? undefined : sourceBranchName
      ),
  });
  if (!name) {
    return;
  }

  const branchName = name.trim();

  try {
    await createBranchFromRef(item.repoRoot, branchName, sourceBranchName, {
      checkout: checkoutNewBranch,
    });
    await commandContext.showSuccessAndRefresh(
      checkoutNewBranch
        ? `Created and switched to '${branchName}' from '${sourceBranchDisplayName}'.`
        : `Created branch '${branchName}' from '${sourceBranchDisplayName}'.`,
      { fetchRemoteState: false }
    );
  } catch (error) {
    commandContext.showCommandError(
      `Failed to create '${branchName}' from '${sourceBranchDisplayName}'`,
      error
    );
  }
}

async function handleRenameBranch(
  item: BranchTreeItem,
  commandContext: CommandContext
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
    await commandContext.showSuccessAndRefresh(`Renamed branch to '${branchName}'.`);
  } catch (error) {
    commandContext.showCommandError(`Failed to rename '${item.branchName}'`, error);
  }
}

async function handleCopyBranchName(item: BranchTreeItem): Promise<void> {
  if (!item.branchName) {
    return;
  }

  await vscode.env.clipboard.writeText(item.branchName);
  vscode.window.showInformationMessage(`Copied '${item.branchName}' to the clipboard.`);
}

async function handleCompareBranchWithCurrent(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!item.branchName || !item.repoRoot) {
    return;
  }

  if (item.nodeType !== 'branch' && item.nodeType !== 'remoteBranch') {
    return;
  }

  const compareBranchName = item.branchName;
  const repoRoot = item.repoRoot;

  const currentBranch = await commandContext.requireCurrentBranch(NO_CURRENT_BRANCH_MESSAGE);
  if (!currentBranch) {
    return;
  }

  if (item.nodeType === 'branch' && compareBranchName === currentBranch.name) {
    vscode.window.showInformationMessage(`'${compareBranchName}' is already the current branch.`);
    return;
  }

  try {
    const changes = await getDiffFilesBetweenRefs(repoRoot, currentBranch.name, compareBranchName);
    if (changes.length === 0) {
      vscode.window.showInformationMessage(
        `No differences found between current branch '${currentBranch.name}' and '${compareBranchName}'.`
      );
      return;
    }

    const gitApi = await getGitApi();
    if (!gitApi) {
      vscode.window.showErrorMessage('The built-in Git extension API is not available.');
      return;
    }

    const repository = gitApi.getRepository(vscode.Uri.file(repoRoot));
    if (!repository) {
      vscode.window.showErrorMessage('Could not resolve the Git repository for this workspace.');
      return;
    }

    const resources = changes.map((change) =>
      buildCompareResource(change, repoRoot, currentBranch.name, compareBranchName, gitApi)
    );
    const reveal = resources.find((resource) => resource.modifiedUri || resource.originalUri);

    await vscode.commands.executeCommand('_workbench.openMultiDiffEditor', {
      multiDiffSourceUri: vscode.Uri.from({
        scheme: 'scm-history-item',
        path: `${repository.rootUri.path}/${currentBranch.name}..${compareBranchName}`,
      }),
      title: `Compare '${compareBranchName}' with current '${currentBranch.name}'`,
      resources,
      reveal,
    });
  } catch (error) {
    commandContext.showCommandError(
      `Failed to compare '${compareBranchName}' with current branch '${currentBranch.name}'`,
      error
    );
  }
}

async function handleMergeIntoCurrent(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!item.branchName || !item.repoRoot || item.nodeType === 'currentBranch') {
    return;
  }

  const currentBranch = await commandContext.requireCurrentBranch(
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
    await commandContext.showSuccessAndRefresh(
      `Merged '${item.branchName}' into '${currentBranch.name}'.`,
      { fetchRemoteState: false }
    );
  } catch (error) {
    commandContext.showCommandError(
      `Failed to merge '${item.branchName}' into '${currentBranch.name}'`,
      error
    );
  }
}

async function syncBranchByName(
  repoRoot: string,
  branchName: string,
  commandContext: CommandContext
): Promise<void> {
  try {
    const syncResult = await syncBranch(repoRoot, branchName);
    await commandContext.showSuccessAndRefresh(buildSyncResultMessage(syncResult), {
      fetchRemoteState: true,
      forceFetchRemoteState: true,
    });
  } catch (error) {
    commandContext.showCommandError(`Failed to sync '${branchName}'`, error);
  }
}

function buildCompareResource(
  change: {
    status: 'A' | 'D' | 'M' | 'R';
    path: string;
    originalPath?: string;
  },
  repoRoot: string,
  currentRef: string,
  compareRef: string,
  gitApi: GitApi
): { originalUri?: vscode.Uri; modifiedUri?: vscode.Uri } {
  switch (change.status) {
    case 'A':
      return {
        modifiedUri: gitApi.toGitUri(vscode.Uri.file(join(repoRoot, change.path)), compareRef),
      };
    case 'D':
      return {
        originalUri: gitApi.toGitUri(vscode.Uri.file(join(repoRoot, change.path)), currentRef),
      };
    case 'R':
      return {
        originalUri: change.originalPath
          ? gitApi.toGitUri(vscode.Uri.file(join(repoRoot, change.originalPath)), currentRef)
          : undefined,
        modifiedUri: gitApi.toGitUri(vscode.Uri.file(join(repoRoot, change.path)), compareRef),
      };
    default:
      return {
        originalUri: gitApi.toGitUri(vscode.Uri.file(join(repoRoot, change.path)), currentRef),
        modifiedUri: gitApi.toGitUri(vscode.Uri.file(join(repoRoot, change.path)), compareRef),
      };
  }
}

async function getGitApi(): Promise<GitApi | undefined> {
  const extension = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
  if (!extension) {
    return undefined;
  }

  const exports = extension.isActive ? extension.exports : await extension.activate();
  if (!exports || typeof exports.getAPI !== 'function') {
    return undefined;
  }

  return exports.getAPI(1);
}

interface GitApi {
  getRepository(uri: vscode.Uri): { rootUri: vscode.Uri } | null;
  toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
}

interface GitExtensionExports {
  getAPI(version: number): GitApi;
}
