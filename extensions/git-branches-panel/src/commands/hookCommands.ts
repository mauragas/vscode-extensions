import * as vscode from 'vscode';

import { getHooks, setHookEnabled } from '../git';
import { BranchTreeItem } from '../treeProvider';
import type { CommandContext } from './shared';

export function registerHookCommands(
  context: vscode.ExtensionContext,
  commandContext: CommandContext
): void {
  const subscriptions = [
    vscode.commands.registerCommand(
      'gitBranchesPanel.activateHookItem',
      async (item: BranchTreeItem) => {
        await handleHookItemActivation(item, commandContext);
      }
    ),
    vscode.commands.registerCommand('gitBranchesPanel.editHook', async (item: BranchTreeItem) => {
      await handleEditHook(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.enableHook', async (item: BranchTreeItem) => {
      await handleSetHookEnabled(item, true, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.disableHook', async (item: BranchTreeItem) => {
      await handleSetHookEnabled(item, false, commandContext);
    }),
    vscode.commands.registerCommand(
      'gitBranchesPanel.enableAllHooks',
      async (item?: BranchTreeItem) => {
        await handleSetAllHooksEnabled(item, true, commandContext);
      }
    ),
    vscode.commands.registerCommand(
      'gitBranchesPanel.disableAllHooks',
      async (item?: BranchTreeItem) => {
        await handleSetAllHooksEnabled(item, false, commandContext);
      }
    ),
  ];

  context.subscriptions.push(...subscriptions);
}

async function handleHookItemActivation(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!isActivatableHookItem(item)) {
    return;
  }

  if (!commandContext.activationTracker.shouldCheckout(item)) {
    return;
  }

  await handleEditHook(item, commandContext);
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

async function handleSetAllHooksEnabled(
  item: BranchTreeItem | undefined,
  enabled: boolean,
  commandContext: CommandContext
): Promise<void> {
  if (item && !isHooksSectionItem(item)) {
    return;
  }

  const repoRoot = item?.repoRoot ?? (await commandContext.requireRepoRoot());
  if (!repoRoot) {
    return;
  }

  try {
    const hooksToUpdate = (await getHooks(repoRoot)).filter(
      (hook) => hook.scope === 'hook' && hook.hookPath && Boolean(hook.hookEnabled) !== enabled
    );
    if (hooksToUpdate.length === 0) {
      return;
    }

    await Promise.all(
      hooksToUpdate.map((hook) =>
        setHookEnabled(
          {
            hookEnabled: hook.hookEnabled,
            hookPath: hook.hookPath ?? '',
          },
          enabled
        )
      )
    );

    await commandContext.showSuccessAndRefresh(
      `${enabled ? 'Enabled' : 'Disabled'} ${hooksToUpdate.length} ${pluralizeHook(hooksToUpdate.length)}.`,
      {
        sections: ['hooks'],
        fetchRemoteState: false,
        onlyIfLoaded: true,
      }
    );
  } catch (error) {
    commandContext.showCommandError(`Failed to ${enabled ? 'enable' : 'disable'} all hooks`, error);
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

function isActivatableHookItem(
  item: BranchTreeItem
): item is BranchTreeItem & {
  branchName: string;
  repoRoot: string;
  branchInfo: NonNullable<BranchTreeItem['branchInfo']> & {
    hookName: string;
    hookPath: string;
  };
} {
  return Boolean(isHookItem(item) && item.branchName && item.repoRoot);
}

function isHooksSectionItem(item: BranchTreeItem): boolean {
  return item.nodeType === 'section' && item.containerScope === 'hook';
}

function pluralizeHook(count: number): string {
  return count === 1 ? 'hook' : 'hooks';
}
