import * as vscode from 'vscode';

import {
  checkoutTag,
  createTag,
  deleteTag,
  getRemotes,
  pushAllTags,
} from '../git';
import { validateTagName } from '../extensionHelpers';
import { BranchTreeItem } from '../treeProvider';
import { NO_CURRENT_BRANCH_MESSAGE, type CommandContext } from './shared';

export function registerTagCommands(
  context: vscode.ExtensionContext,
  commandContext: CommandContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('gitBranchesPanel.createTag', async (item?: BranchTreeItem) => {
      await handleCreateTag(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.checkoutTag', async (item: BranchTreeItem) => {
      await handleCheckoutTag(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.copyTagName', async (item: BranchTreeItem) => {
      await handleCopyTagName(item);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.deleteTag', async (item: BranchTreeItem) => {
      await handleDeleteTag(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.pushAllTags', async (item?: BranchTreeItem) => {
      await handlePushAllTags(item, commandContext);
    })
  );
}

async function handleCreateTag(
  item: BranchTreeItem | undefined,
  commandContext: CommandContext
): Promise<void> {
  const source = await resolveTagSource(item, commandContext);
  if (!source) {
    return;
  }

  const name = await vscode.window.showInputBox({
    prompt: `Enter a name for the new tag on '${source.branchName}'`,
    placeHolder: 'v1.2.3 or release/2026-06-05',
    validateInput: (value) => validateTagName(value),
  });
  if (!name) {
    return;
  }

  const tagName = name.trim();

  try {
    await createTag(source.repoRoot, tagName, source.branchName);
    await commandContext.showSuccessAndRefresh(
      `Created tag '${tagName}' on '${source.branchName}'.`,
      { fetchRemoteState: false }
    );
  } catch (error) {
    commandContext.showCommandError(`Failed to create tag '${tagName}' on '${source.branchName}'`, error);
  }
}

async function handleCheckoutTag(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!item.branchName || !item.repoRoot || item.nodeType !== 'tag') {
    return;
  }

  try {
    await checkoutTag(item.repoRoot, item.branchName);
    await commandContext.showSuccessAndRefresh(
      `Checked out tag '${item.branchName}'. HEAD is now detached at that tag.`,
      { fetchRemoteState: false }
    );
  } catch (error) {
    commandContext.showCommandError(`Failed to checkout tag '${item.branchName}'`, error);
  }
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
  commandContext: CommandContext
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
    await commandContext.showSuccessAndRefresh(`Deleted tag '${item.branchName}'.`, {
      fetchRemoteState: false,
    });
  } catch (error) {
    commandContext.showCommandError(`Failed to delete tag '${item.branchName}'`, error);
  }
}

async function handlePushAllTags(
  item: BranchTreeItem | undefined,
  commandContext: CommandContext
): Promise<void> {
  if (item && (item.nodeType !== 'section' || item.containerPath !== 'section:tags')) {
    return;
  }

  const repoRoot = item?.repoRoot ?? (await commandContext.requireRepoRoot());
  if (!repoRoot) {
    return;
  }

  try {
    const remotes = await getRemotes(repoRoot);
    if (remotes.length === 0) {
      vscode.window.showErrorMessage('No git remotes were found for this repository.');
      return;
    }

    const remoteName =
      remotes.length === 1
        ? remotes[0]
        : await vscode.window.showQuickPick(remotes, {
            placeHolder: 'Select a remote to push all tags to',
          });

    if (!remoteName) {
      return;
    }

    await pushAllTags(repoRoot, remoteName);
    await commandContext.showSuccessAndRefresh(`Pushed all tags to '${remoteName}'.`, {
      fetchRemoteState: false,
    });
  } catch (error) {
    commandContext.showCommandError('Failed to push all tags', error);
  }
}

async function resolveTagSource(
  item: BranchTreeItem | undefined,
  commandContext: CommandContext
): Promise<
  | {
      branchName: string;
      repoRoot: string;
    }
  | undefined
> {
  if (
    item?.branchName &&
    item.repoRoot &&
    (item.nodeType === 'branch' || item.nodeType === 'currentBranch')
  ) {
    return {
      branchName: item.branchName,
      repoRoot: item.repoRoot,
    };
  }

  if (item && (item.nodeType !== 'section' || item.containerPath !== 'section:tags')) {
    return undefined;
  }

  const repoRoot = item?.repoRoot ?? (await commandContext.requireRepoRoot());
  if (!repoRoot) {
    return undefined;
  }

  const currentBranch = await commandContext.requireCurrentBranch(
    NO_CURRENT_BRANCH_MESSAGE,
    repoRoot
  );
  if (!currentBranch) {
    return undefined;
  }

  return {
    branchName: currentBranch.name,
    repoRoot,
  };
}
