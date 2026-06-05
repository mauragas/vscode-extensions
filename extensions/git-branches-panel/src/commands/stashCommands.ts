import * as vscode from 'vscode';

import { applyStash, dropStash, popStash, stashSilently } from '../git';
import { BranchTreeItem } from '../treeProvider';
import type { CommandContext } from './shared';

export function registerStashCommands(
  context: vscode.ExtensionContext,
  commandContext: CommandContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('gitBranchesPanel.stashSilently', async () => {
      await handleStashSilently(commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.applyStash', async (item: BranchTreeItem) => {
      await handleApplyStash(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.popStash', async (item: BranchTreeItem) => {
      await handlePopStash(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.dropStash', async (item: BranchTreeItem) => {
      await handleDropStash(item, commandContext);
    })
  );
}

async function handleStashSilently(commandContext: CommandContext): Promise<void> {
  const repoRoot = await commandContext.requireRepoRoot();
  if (!repoRoot) {
    return;
  }

  try {
    const didStash = await stashSilently(repoRoot);
    if (!didStash) {
      vscode.window.showInformationMessage('No tracked or untracked changes to stash.');
      return;
    }

    await commandContext.showSuccessAndRefresh('Stashed tracked and untracked changes.', {
      fetchRemoteState: false,
    });
  } catch (error) {
    commandContext.showCommandError('Failed to stash changes', error);
  }
}

async function handleApplyStash(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!item.branchName || !item.repoRoot || item.nodeType !== 'stash') {
    return;
  }

  try {
    await applyStash(item.repoRoot, item.branchName);
    await commandContext.showSuccessAndRefresh(`Applied stash '${item.branchName}'.`, {
      fetchRemoteState: false,
    });
  } catch (error) {
    commandContext.showCommandError(`Failed to apply stash '${item.branchName}'`, error);
  }
}

async function handlePopStash(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!item.branchName || !item.repoRoot || item.nodeType !== 'stash') {
    return;
  }

  try {
    await popStash(item.repoRoot, item.branchName);
    await commandContext.showSuccessAndRefresh(`Popped stash '${item.branchName}'.`, {
      fetchRemoteState: false,
    });
  } catch (error) {
    commandContext.showCommandError(`Failed to pop stash '${item.branchName}'`, error);
  }
}

async function handleDropStash(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!item.branchName || !item.repoRoot || item.nodeType !== 'stash') {
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    `Drop stash '${item.branchName}'?`,
    { modal: true },
    'Drop'
  );
  if (confirmation !== 'Drop') {
    return;
  }

  try {
    await dropStash(item.repoRoot, item.branchName);
    await commandContext.showSuccessAndRefresh(`Dropped stash '${item.branchName}'.`, {
      fetchRemoteState: false,
    });
  } catch (error) {
    commandContext.showCommandError(`Failed to drop stash '${item.branchName}'`, error);
  }
}
