import * as vscode from 'vscode';

import { setHookEnabled } from '../git';
import { BranchTreeItem } from '../treeProvider';
import type { CommandContext } from './shared';

export function registerHookCommands(
  context: vscode.ExtensionContext,
  commandContext: CommandContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('gitBranchesPanel.editHook', async (item: BranchTreeItem) => {
      await handleEditHook(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.enableHook', async (item: BranchTreeItem) => {
      await handleSetHookEnabled(item, true, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.disableHook', async (item: BranchTreeItem) => {
      await handleSetHookEnabled(item, false, commandContext);
    })
  );
}

async function handleEditHook(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!isHookItem(item)) {
    return;
  }

  try {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(item.branchInfo.hookPath));
    await vscode.window.showTextDocument(document, {
      preview: false,
    });
  } catch (error) {
    commandContext.showCommandError(`Failed to open hook '${item.branchInfo.hookName}'`, error);
  }
}

async function handleSetHookEnabled(
  item: BranchTreeItem,
  enabled: boolean,
  commandContext: CommandContext
): Promise<void> {
  if (!isHookItem(item)) {
    return;
  }

  if (Boolean(item.branchInfo.hookEnabled) === enabled) {
    return;
  }

  try {
    await setHookEnabled(
      {
        hookEnabled: item.branchInfo.hookEnabled,
        hookPath: item.branchInfo.hookPath,
      },
      enabled
    );
    await commandContext.showSuccessAndRefresh(
      `${enabled ? 'Enabled' : 'Disabled'} hook '${item.branchInfo.hookName}'.`,
      {
        sections: ['hooks'],
        fetchRemoteState: false,
        onlyIfLoaded: true,
      }
    );
  } catch (error) {
    commandContext.showCommandError(
      `Failed to ${enabled ? 'enable' : 'disable'} hook '${item.branchInfo.hookName}'`,
      error
    );
  }
}

function isHookItem(
  item: BranchTreeItem
): item is BranchTreeItem & {
  branchInfo: NonNullable<BranchTreeItem['branchInfo']> & {
    hookName: string;
    hookPath: string;
  };
} {
  return Boolean(
    item.nodeType === 'hook' &&
      item.branchInfo?.scope === 'hook' &&
      item.branchInfo.hookName &&
      item.branchInfo.hookPath
  );
}
