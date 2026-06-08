import * as vscode from 'vscode';

import { isPinnableItem, setSelectedItemPinnedContextValue } from '../pinContext';
import { BranchTreeItem } from '../treeProvider';
import type { CommandContext } from './shared';

const PIN_COMMAND_IDS = [
  'gitBranchesPanel.togglePinItem',
  'gitBranchesPanel.pinItem',
  'gitBranchesPanel.unpinItem',
] as const;

export function registerItemCommands(
  context: vscode.ExtensionContext,
  commandContext: CommandContext
): void {
  context.subscriptions.push(
    ...PIN_COMMAND_IDS.map((commandId) =>
      vscode.commands.registerCommand(commandId, async (item: BranchTreeItem) => {
        await handleTogglePinItem(item, commandContext);
      })
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

  const nextPinned = await commandContext.provider.togglePinnedItem(item);
  await setSelectedItemPinnedContextValue(nextPinned);
}
