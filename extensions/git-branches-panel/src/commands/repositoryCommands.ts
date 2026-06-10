import * as vscode from 'vscode';

import { cleanRepository, fetchAllRemotes, fetchRemoteState } from '../git';
import { BranchTreeItem } from '../treeProvider';
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
    vscode.commands.registerCommand('gitBranchesPanel.fetchAll', async (item?: BranchTreeItem) => {
      await handleFetchAll(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.fetchAllPrune', async (item?: BranchTreeItem) => {
      await handleFetchAllPrune(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.fetchAllRepositories', async () => {
      await handleFetchAllRepositories(commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.fetchAllRepositoriesPrune', async () => {
      await handleFetchAllRepositoriesPrune(commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.cleanRepository', async (item?: BranchTreeItem) => {
      await handleCleanRepository(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.selectRepository', async (item?: BranchTreeItem) => {
      await handleSelectRepository(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.focusActiveEditorRepository', async () => {
      await handleFocusActiveEditorRepository(commandContext);
    })
  );
}

async function handleRefresh(commandContext: CommandContext): Promise<void> {
  await commandContext.runWithLoadingIndicator(
    'Refreshing branches…',
    () => commandContext.refresh({ fetchRemoteState: true })
  );
}

async function handleOpenSettings(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.openSettings', EXTENSION_SETTINGS_QUERY);
}

async function handleFetchAll(
  item: BranchTreeItem | undefined,
  commandContext: CommandContext
): Promise<void> {
  const repoRoot = await commandContext.requireRepoRoot(item?.repoRoot);
  if (!repoRoot) {
    return;
  }

  try {
    await commandContext.runWithLoadingIndicator(
      'Fetching all remotes…',
      async () => {
        await fetchAllRemotes(repoRoot);
        await commandContext.showSuccessAndRefresh(
          'Fetched all remotes and refreshed branch status.',
          { fetchRemoteState: false }
        );
      }
    );
  } catch (error) {
    commandContext.showCommandError('Failed to fetch remotes', error);
  }
}

async function handleFetchAllPrune(
  item: BranchTreeItem | undefined,
  commandContext: CommandContext
): Promise<void> {
  const repoRoot = await commandContext.requireRepoRoot(item?.repoRoot);
  if (!repoRoot) {
    return;
  }

  try {
    await commandContext.runWithLoadingIndicator(
      'Fetching and pruning remotes…',
      async () => {
        await fetchRemoteState(repoRoot);
        await commandContext.showSuccessAndRefresh(
          'Fetched all remotes, pruned deleted refs, and refreshed branch status.',
          { fetchRemoteState: false }
        );
      }
    );
  } catch (error) {
    commandContext.showCommandError('Failed to fetch and prune remotes', error);
  }
}

async function handleCleanRepository(
  item: BranchTreeItem | undefined,
  commandContext: CommandContext
): Promise<void> {
  const repoRoot = await commandContext.requireRepoRoot(item?.repoRoot);
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
    await commandContext.runWithLoadingIndicator(
      'Cleaning repository…',
      async () => {
        await cleanRepository(repoRoot);
        await commandContext.showSuccessAndRefresh(
          'Removed untracked and ignored files from the repository.',
          { fetchRemoteState: false }
        );
      }
    );
  } catch (error) {
    commandContext.showCommandError('Failed to clean the repository', error);
  }
}

async function handleFetchAllRepositories(commandContext: CommandContext): Promise<void> {
  await runForAllRepositories(
    commandContext,
    async (repoRoot) => {
      await fetchAllRemotes(repoRoot);
    },
    {
      progressTitle: 'Fetching all repositories…',
      successMessage: 'Fetched all remotes in every repository.',
      partialSuccessPrefix: 'Fetched remotes for',
      errorPrefix: 'Failed to fetch all remotes across repositories',
      noRepositoriesMessage: 'No Git repositories are currently available.',
    }
  );
}

async function handleFetchAllRepositoriesPrune(commandContext: CommandContext): Promise<void> {
  await runForAllRepositories(
    commandContext,
    async (repoRoot) => {
      await fetchRemoteState(repoRoot);
    },
    {
      progressTitle: 'Fetching and pruning all repositories…',
      successMessage: 'Fetched all remotes with pruning in every repository.',
      partialSuccessPrefix: 'Fetched and pruned remotes for',
      errorPrefix: 'Failed to fetch and prune remotes across repositories',
      noRepositoriesMessage: 'No Git repositories are currently available.',
    }
  );
}

async function handleSelectRepository(
  item: BranchTreeItem | undefined,
  commandContext: CommandContext
): Promise<void> {
  if (item?.repoRoot) {
    const activated = await commandContext.provider.setActiveRepository(item.repoRoot);
    if (activated) {
      const repositoryLabel =
        commandContext.provider
          .getRepositoryDescriptors()
          .find((repository) => repository.repoRoot === item.repoRoot)?.label ?? item.label?.toString();

      if (repositoryLabel) {
        vscode.window.showInformationMessage(`Selected repository '${repositoryLabel}'.`);
      }
    }

    return;
  }

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

async function runForAllRepositories(
  commandContext: CommandContext,
  operation: (repoRoot: string) => Promise<void>,
  options: {
    progressTitle: string;
    successMessage: string;
    partialSuccessPrefix: string;
    errorPrefix: string;
    noRepositoriesMessage: string;
  }
): Promise<void> {
  const repositories = commandContext.provider.getRepositoryDescriptors();
  if (repositories.length === 0) {
    vscode.window.showInformationMessage(options.noRepositoriesMessage);
    return;
  }

  await commandContext.runWithLoadingIndicator(options.progressTitle, async () => {
    const failures: Array<{ label: string; reason: string }> = [];

    for (const repository of repositories) {
      try {
        await operation(repository.repoRoot);
      } catch (error) {
        failures.push({
          label: repository.label,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (failures.length === repositories.length) {
      commandContext.showCommandError(
        options.errorPrefix,
        new Error(failures.map((failure) => `${failure.label} (${failure.reason})`).join('; '))
      );
      return;
    }

    await commandContext.refresh({ fetchRemoteState: false });

    if (failures.length > 0) {
      const successCount = repositories.length - failures.length;

      vscode.window.showWarningMessage(
        `${options.partialSuccessPrefix} ${successCount} of ${repositories.length} repositories. Failed: ${failures
          .map((failure) => `${failure.label} (${failure.reason})`)
          .join('; ')}.`
      );
      return;
    }

    vscode.window.showInformationMessage(options.successMessage);
  });
}
