import * as vscode from 'vscode';

import {
  applyStash,
  dropAllStashes,
  dropStash,
  getStashes,
  popStash,
  stashAllChanges,
  stashSilently,
  stashStagedChanges,
  stashStagedSilently,
} from '../git';
import { BranchTreeItem } from '../treeProvider';
import { resolveRepoRootFromScmContext, type CommandContext } from './shared';

type StashExecutor = (repoRoot: string, message?: string) => Promise<boolean>;

export function registerStashCommands(
  context: vscode.ExtensionContext,
  commandContext: CommandContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('gitBranchesPanel.stashSilently', async (target?: unknown) => {
      await handleStashSilently(commandContext, target);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitBranchesPanel.stashStagedSilently',
      async (target?: unknown) => {
        await handleStashStagedSilently(commandContext, target);
      }
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('gitBranchesPanel.stashAllChanges', async (target?: unknown) => {
      await handleStashAllChanges(commandContext, target);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitBranchesPanel.stashStagedChanges',
      async (target?: unknown) => {
        await handleStashStagedChanges(commandContext, target);
      }
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('gitBranchesPanel.applyStash', async (item: BranchTreeItem) => {
      await handleApplyStash(item, commandContext);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('gitBranchesPanel.popStash', async (item: BranchTreeItem) => {
      await handlePopStash(item, commandContext);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitBranchesPanel.popLatestStash',
      async (item?: BranchTreeItem) => {
        await handlePopLatestStash(item, commandContext);
      }
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('gitBranchesPanel.dropStash', async (item: BranchTreeItem) => {
      await handleDropStash(item, commandContext);
    })
  );
  context.subscriptions.push(
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

async function handleStashSilently(
  commandContext: CommandContext,
  target?: unknown
): Promise<void> {
  await handleCreateStash(commandContext, target, {
    createStash: (_repoRoot, _message) => stashSilently(_repoRoot),
    failureMessage: 'Failed to stash changes',
    nothingToStashMessage: 'No tracked or untracked changes to stash.',
    successMessage: 'Stashed tracked and untracked changes.',
  });
}

async function handleStashStagedSilently(
  commandContext: CommandContext,
  target?: unknown
): Promise<void> {
  await handleCreateStash(commandContext, target, {
    createStash: (_repoRoot, _message) => stashStagedSilently(_repoRoot),
    failureMessage: 'Failed to stash staged changes',
    nothingToStashMessage: 'No staged changes to stash.',
    successMessage: 'Stashed staged changes.',
  });
}

async function handleStashAllChanges(
  commandContext: CommandContext,
  target?: unknown
): Promise<void> {
  await handleCreateStash(commandContext, target, {
    createStash: stashAllChanges,
    failureMessage: 'Failed to stash changes',
    nothingToStashMessage: 'No tracked or untracked changes to stash.',
    prompt: 'Enter an optional stash message for all changes',
    successMessage: 'Stashed tracked and untracked changes.',
  });
}

async function handleStashStagedChanges(
  commandContext: CommandContext,
  target?: unknown
): Promise<void> {
  await handleCreateStash(commandContext, target, {
    createStash: stashStagedChanges,
    failureMessage: 'Failed to stash staged changes',
    nothingToStashMessage: 'No staged changes to stash.',
    prompt: 'Enter an optional stash message for staged changes',
    successMessage: 'Stashed staged changes.',
  });
}

interface CreateStashCommandOptions {
  readonly createStash: StashExecutor;
  readonly failureMessage: string;
  readonly nothingToStashMessage: string;
  readonly prompt?: string;
  readonly successMessage: string;
}

async function handleCreateStash(
  commandContext: CommandContext,
  target: unknown,
  options: CreateStashCommandOptions
): Promise<void> {
  const repoRoot =
    (await resolveRepoRootFromScmContext(target)) ?? (await commandContext.requireRepoRoot());
  if (!repoRoot) {
    return;
  }

  const message = options.prompt ? await promptForOptionalStashMessage(options.prompt) : '';
  if (options.prompt && message === undefined) {
    return;
  }

  try {
    const didStash = await options.createStash(repoRoot, message || undefined);
    if (!didStash) {
      vscode.window.showInformationMessage(options.nothingToStashMessage);
      return;
    }

    await commandContext.showSuccessAndRefresh(options.successMessage, {
      fetchRemoteState: false,
    });
  } catch (error) {
    commandContext.showCommandError(options.failureMessage, error);
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

async function promptForOptionalStashMessage(prompt: string): Promise<string | undefined> {
  return vscode.window.showInputBox({
    prompt,
    placeHolder: 'Optional stash message',
    value: '',
  });
}
