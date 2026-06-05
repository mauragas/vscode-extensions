import * as vscode from 'vscode';
import { basename } from 'node:path';

import { getErrorMessage } from '../errorUtils';
import { removeWorktree } from '../git';
import { BranchTreeItem } from '../treeProvider';
import type { CommandContext } from './shared';

export function registerWorktreeCommands(
  context: vscode.ExtensionContext,
  commandContext: CommandContext
): void {
  context.subscriptions.push(
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
    vscode.commands.registerCommand('gitBranchesPanel.removeWorktree', async (item: BranchTreeItem) => {
      await handleRemoveWorktree(item, commandContext);
    })
  );
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

function looksLikeDirtyWorktreeError(message: string): boolean {
  return /(not clean|contains modified or untracked files|use --force)/i.test(message);
}
