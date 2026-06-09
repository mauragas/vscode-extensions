import * as vscode from 'vscode';

import { cleanRepository, fetchAllRemotes, fetchRemoteState } from '../git';
import type { CommandContext } from './shared';

const EXTENSION_SETTINGS_QUERY = '@ext:karolis-mauragas.git-branches-panel';

export function registerRepositoryCommands(
  context: vscode.ExtensionContext,
  commandContext: CommandContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('gitBranchesPanel.refresh', async () => {
      await handleRefresh(commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.openSettings', async () => {
      await handleOpenSettings();
    }),
    vscode.commands.registerCommand('gitBranchesPanel.fetchAll', async () => {
      await handleFetchAll(commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.fetchAllPrune', async () => {
      await handleFetchAllPrune(commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.cleanRepository', async () => {
      await handleCleanRepository(commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.selectRepository', async () => {
      await handleSelectRepository(commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.focusActiveEditorRepository', async () => {
      await handleFocusActiveEditorRepository(commandContext);
    })
  );
}

async function handleRefresh(commandContext: CommandContext): Promise<void> {
  await commandContext.refresh({ fetchRemoteState: true });
}

async function handleOpenSettings(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.openSettings', EXTENSION_SETTINGS_QUERY);
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

async function handleCleanRepository(commandContext: CommandContext): Promise<void> {
  const repoRoot = await commandContext.requireRepoRoot();
  if (!repoRoot) {
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    'Permanently remove all untracked and ignored files and directories from this repository? This is equivalent to running git clean -fdx.',
    { modal: true },
    'Clean Repository'
  );
  if (confirmation !== 'Clean Repository') {
    return;
  }

  try {
    await cleanRepository(repoRoot);
    await commandContext.showSuccessAndRefresh(
      'Removed untracked and ignored files from the repository.',
      { fetchRemoteState: false }
    );
  } catch (error) {
    commandContext.showCommandError('Failed to clean the repository', error);
  }
}

async function handleSelectRepository(commandContext: CommandContext): Promise<void> {
  const repositories = commandContext.provider.getRepositoryDescriptors();
  if (repositories.length === 0) {
    vscode.window.showInformationMessage('No Git repositories are currently available.');
    return;
  }

  if (repositories.length === 1) {
    await commandContext.provider.setActiveRepository(repositories[0].repoRoot);
    vscode.window.showInformationMessage(`Selected repository '${repositories[0].label}'.`);
    return;
  }

  const selection = await vscode.window.showQuickPick(
    repositories.map((repository) => ({
      label: repository.label,
      description: repository.description,
      repoRoot: repository.repoRoot,
    })),
    {
      placeHolder: 'Select the active Git repository',
    }
  );

  if (!selection) {
    return;
  }

  await commandContext.provider.setActiveRepository(selection.repoRoot);
  vscode.window.showInformationMessage(`Selected repository '${selection.label}'.`);
}

async function handleFocusActiveEditorRepository(commandContext: CommandContext): Promise<void> {
  const focused = await commandContext.provider.focusRepositoryForUri(
    vscode.window.activeTextEditor?.document.uri
  );

  if (!focused) {
    vscode.window.showInformationMessage(
      'Could not resolve a Git repository from the active editor.'
    );
    return;
  }

  const activeRepositoryLabel = commandContext.provider.getActiveRepositoryLabel();
  if (activeRepositoryLabel) {
    vscode.window.showInformationMessage(`Focused repository '${activeRepositoryLabel}'.`);
  }
}
