import * as vscode from 'vscode';

import { fetchAllRemotes, fetchRemoteState } from '../git';
import type { CommandContext } from './shared';

export function registerRepositoryCommands(
  context: vscode.ExtensionContext,
  commandContext: CommandContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('gitBranchesPanel.refresh', async () => {
      await handleRefresh(commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.fetchAll', async () => {
      await handleFetchAll(commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.fetchAllPrune', async () => {
      await handleFetchAllPrune(commandContext);
    })
  );
}

async function handleRefresh(commandContext: CommandContext): Promise<void> {
  await commandContext.refresh({ fetchRemoteState: true });
}

async function handleFetchAll(commandContext: CommandContext): Promise<void> {
  const repoRoot = await commandContext.requireRepoRoot();
  if (!repoRoot) {
    return;
  }

  try {
    await fetchAllRemotes(repoRoot);
    await commandContext.showSuccessAndRefresh(
      'Fetched all remotes and refreshed branch status.',
      { fetchRemoteState: false }
    );
  } catch (error) {
    commandContext.showCommandError('Failed to fetch remotes', error);
  }
}

async function handleFetchAllPrune(commandContext: CommandContext): Promise<void> {
  const repoRoot = await commandContext.requireRepoRoot();
  if (!repoRoot) {
    return;
  }

  try {
    await fetchRemoteState(repoRoot);
    await commandContext.showSuccessAndRefresh(
      'Fetched all remotes, pruned deleted refs, and refreshed branch status.',
      { fetchRemoteState: false }
    );
  } catch (error) {
    commandContext.showCommandError('Failed to fetch and prune remotes', error);
  }
}
