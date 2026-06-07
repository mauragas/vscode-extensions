import * as vscode from 'vscode';

import {
  applyStash,
  dropAllStashes,
  dropStash,
  getStashes,
  popStash,
  stashSilently,
} from '../git';
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
    vscode.commands.registerCommand(
      'gitBranchesPanel.popLatestStash',
      async (item?: BranchTreeItem) => {
        await handlePopLatestStash(item, commandContext);
      }
    ),
    vscode.commands.registerCommand('gitBranchesPanel.dropStash', async (item: BranchTreeItem) => {
      await handleDropStash(item, commandContext);
    }),
    vscode.commands.registerCommand(
      'gitBranchesPanel.dropAllStashes',
      async (item?: BranchTreeItem) => {
        await handleDropAllStashes(item, commandContext);
      }
    )
  );
}

async function handlePopLatestStash(
  item: BranchTreeItem | undefined,
  commandContext: CommandContext
): Promise<void> {
  if (item && (item.nodeType !== 'section' || item.containerScope !== 'stash')) {
    return;
  }

  const repoRoot = item?.repoRoot ?? (await commandContext.requireRepoRoot());
  if (!repoRoot) {
    return;
  }

  try {
    const stashes = await getStashes(repoRoot);
    const latestStash = stashes[0];
    if (!latestStash?.name) {
      vscode.window.showInformationMessage('No stashes were found to pop.');
      return;
    }

    await popStash(repoRoot, latestStash.name);
    await commandContext.showSuccessAndRefresh(`Popped latest stash '${latestStash.name}'.`, {
      fetchRemoteState: false,
    });
  } catch (error) {
    commandContext.showCommandError('Failed to pop the latest stash', error);
  }
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

async function handleDropAllStashes(
  item: BranchTreeItem | undefined,
  commandContext: CommandContext
): Promise<void> {
  if (item && (item.nodeType !== 'section' || item.containerScope !== 'stash')) {
    return;
  }

  const repoRoot = item?.repoRoot ?? (await commandContext.requireRepoRoot());
  if (!repoRoot) {
    return;
  }

  try {
    const stashes = await getStashes(repoRoot);
    if (stashes.length === 0) {
      vscode.window.showInformationMessage('No stashes were found to drop.');
      return;
    }

    const confirmation = await vscode.window.showWarningMessage(
      `Drop all ${stashes.length} ${pluralizeStash(stashes.length)}?`,
      { modal: true },
      'Drop All'
    );
    if (confirmation !== 'Drop All') {
      return;
    }

    await dropAllStashes(repoRoot);
    await commandContext.showSuccessAndRefresh(
      `Dropped all ${stashes.length} ${pluralizeStash(stashes.length)}.`,
      {
        fetchRemoteState: false,
      }
    );
  } catch (error) {
    commandContext.showCommandError('Failed to drop all stashes', error);
  }
}

function pluralizeStash(count: number): string {
  return count === 1 ? 'stash' : 'stashes';
}
