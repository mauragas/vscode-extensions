import * as vscode from 'vscode';

import { BranchTreeItem } from '../treeProvider';
import type { CommandContext } from './shared';

export function registerItemCommands(
  context: vscode.ExtensionContext,
  commandContext: CommandContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitBranchesPanel.togglePinItem',
      async (item: BranchTreeItem) => {
        await handleTogglePinItem(item, commandContext);
      }
    ),
    vscode.commands.registerCommand('gitBranchesPanel.branchActionInProgress', async () => {
      // Intentionally empty: the inline spinning icon is only a visual busy indicator.
    })
  );
}

async function handleTogglePinItem(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!isPinnableItem(item)) {
    return;
  }

  await commandContext.provider.togglePinnedItem(item);
}

function isPinnableItem(item: BranchTreeItem | undefined): item is BranchTreeItem {
  return Boolean(
    item?.repoRoot &&
      item.branchInfo &&
      (item.nodeType === 'branch' ||
        item.nodeType === 'currentBranch' ||
        item.nodeType === 'missingUpstreamBranch' ||
        item.nodeType === 'remoteBranch' ||
        item.nodeType === 'staleRemoteBranch' ||
        item.nodeType === 'stash' ||
        item.nodeType === 'worktree')
  );
}
