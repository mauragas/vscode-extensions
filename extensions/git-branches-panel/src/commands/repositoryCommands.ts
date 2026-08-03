import * as vscode from 'vscode';

import {
  cleanRepository,
  deleteBranch,
  fetchAllRemotes,
  fetchRemoteState,
  getBranches,
} from '../git';
import {
  DEFAULT_PROTECTED_BRANCH_NAMES,
  isBranchProtectedFromDeletion,
  normalizeConfiguredBranchNames,
} from '../branchRules';
import type { BranchInfo } from '../branchModel';
import { BranchTreeItem } from '../treeProvider';
import type { CommandContext } from './shared';

const EXTENSION_SETTINGS_QUERY = '@ext:karolis-mauragas.git-branches-panel';

interface MissingUpstreamPrunePlan {
  deletableBranchNames: string[];
  skippedCurrentBranchNames: string[];
  skippedProtectedBranchNames: string[];
}

interface MissingUpstreamPruneResult {
  deletedBranchNames: string[];
  failedBranches: Array<{
    label: string;
    reason: string;
  }>;
}

interface RepositoryPrunePlan {
  repoRoot: string;
  label: string;
  plan: MissingUpstreamPrunePlan;
}

interface RepositoryFailure {
  label: string;
  reason: string;
}

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
    vscode.commands.registerCommand(
      'gitBranchesPanel.fetchAllPruneAndPruneMissingUpstreamBranches',
      async (item?: BranchTreeItem) => {
        await handleFetchAllPruneAndPruneMissingUpstreamBranches(item, commandContext);
      }
    ),
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

async function handleFetchAllPruneAndPruneMissingUpstreamBranches(
  item: BranchTreeItem | undefined,
  commandContext: CommandContext
): Promise<void> {
  if (shouldRunAcrossVisibleRepositories(item, commandContext)) {
    await handleFetchAllPruneAndPruneMissingUpstreamBranchesAcrossRepositories(commandContext);
    return;
  }

  const repoRoot = await commandContext.requireRepoRoot(item?.repoRoot);
  if (!repoRoot) {
    return;
  }

  try {
    await commandContext.runWithLoadingIndicator(
      'Fetching, pruning, and pruning missing upstreams…',
      async () => {
        await fetchRemoteState(repoRoot);
        const prunePlan = buildMissingUpstreamPrunePlan(await getBranches(repoRoot));

        if (prunePlan.deletableBranchNames.length === 0) {
          await commandContext.refresh({ fetchRemoteState: false });
          vscode.window.showInformationMessage(
            buildSingleRepositoryNoBranchesMessage(prunePlan)
          );
          return;
        }

        const confirmation = await vscode.window.showWarningMessage(
          buildSingleRepositoryConfirmationMessage(prunePlan),
          { modal: true },
          'Prune'
        );
        if (confirmation !== 'Prune') {
          await commandContext.refresh({ fetchRemoteState: false });
          vscode.window.showInformationMessage(
            'Fetched all remotes, pruned deleted refs, and cancelled pruning local branches with missing upstreams.'
          );
          return;
        }

        const pruneResult = await pruneMissingUpstreamBranchesForRepository(
          repoRoot,
          prunePlan.deletableBranchNames
        );

        await commandContext.refresh({ fetchRemoteState: false });
        showResultNotification(
          pruneResult.failedBranches.length > 0 ? 'warning' : 'info',
          buildSingleRepositoryResultMessage(prunePlan, pruneResult)
        );
      }
    );
  } catch (error) {
    commandContext.showCommandError(
      'Failed to fetch, prune, and prune local branches with missing upstreams',
      error
    );
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

async function handleFetchAllPruneAndPruneMissingUpstreamBranchesAcrossRepositories(
  commandContext: CommandContext
): Promise<void> {
  const repositories = getVisibleRepositoryTargets(commandContext);
  if (repositories.length === 0) {
    vscode.window.showInformationMessage('No Git repositories are currently available.');
    return;
  }

  try {
    await commandContext.runWithLoadingIndicator(
      'Fetching, pruning, and pruning missing upstreams across repositories…',
      async () => {
        const repositoryPrunePlans: RepositoryPrunePlan[] = [];
        const fetchFailures: RepositoryFailure[] = [];

        for (const repository of repositories) {
          try {
            await fetchRemoteState(repository.repoRoot);
            repositoryPrunePlans.push({
              ...repository,
              plan: buildMissingUpstreamPrunePlan(await getBranches(repository.repoRoot)),
            });
          } catch (error) {
            fetchFailures.push({
              label: repository.label,
              reason: error instanceof Error ? error.message : String(error),
            });
          }
        }

        if (repositoryPrunePlans.length === 0) {
          commandContext.showCommandError(
            'Failed to fetch, prune, and prune local branches with missing upstreams across repositories',
            new Error(fetchFailures.map((failure) => `${failure.label} (${failure.reason})`).join('; '))
          );
          return;
        }

        const totalPrunableBranchCount = repositoryPrunePlans.reduce(
          (count, repository) => count + repository.plan.deletableBranchNames.length,
          0
        );

        if (totalPrunableBranchCount === 0) {
          await commandContext.refresh({ fetchRemoteState: false });
          showResultNotification(
            fetchFailures.length > 0 ? 'warning' : 'info',
            buildAllRepositoriesNoBranchesMessage(repositoryPrunePlans, fetchFailures)
          );
          return;
        }

        const confirmation = await vscode.window.showWarningMessage(
          buildAllRepositoriesConfirmationMessage(repositoryPrunePlans),
          { modal: true },
          'Prune'
        );
        if (confirmation !== 'Prune') {
          await commandContext.refresh({ fetchRemoteState: false });
          showResultNotification(
            fetchFailures.length > 0 ? 'warning' : 'info',
            buildAllRepositoriesCancelledMessage(fetchFailures)
          );
          return;
        }

        const pruneResults = await Promise.all(
          repositoryPrunePlans.map(async (repository) => ({
            label: repository.label,
            result: await pruneMissingUpstreamBranchesForRepository(
              repository.repoRoot,
              repository.plan.deletableBranchNames
            ),
          }))
        );

        await commandContext.refresh({ fetchRemoteState: false });

        const failedPrunes = pruneResults.flatMap((repository) =>
          repository.result.failedBranches.map((failure) => ({
            label: `${repository.label}:${failure.label}`,
            reason: failure.reason,
          }))
        );

        showResultNotification(
          fetchFailures.length > 0 || failedPrunes.length > 0 ? 'warning' : 'info',
          buildAllRepositoriesResultMessage(repositoryPrunePlans, pruneResults, fetchFailures)
        );
      }
    );
  } catch (error) {
    commandContext.showCommandError(
      'Failed to fetch, prune, and prune local branches with missing upstreams across repositories',
      error
    );
  }
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

function shouldRunAcrossVisibleRepositories(
  item: BranchTreeItem | undefined,
  commandContext: CommandContext
): boolean {
  if (item?.repoRoot) {
    return false;
  }

  const repositories = commandContext.provider.getRepositoryDescriptors();
  if (repositories.length <= 1) {
    return false;
  }

  const multiRepositoryMode = vscode.workspace
    .getConfiguration('gitBranchesPanel')
    .get<'auto' | 'alwaysGroupByRepository' | 'singleActiveRepository'>(
      'multiRepository.mode',
      'auto'
    );

  return multiRepositoryMode === 'alwaysGroupByRepository' || multiRepositoryMode === 'auto';
}

function getVisibleRepositoryTargets(
  commandContext: CommandContext
): Array<{ repoRoot: string; label: string }> {
  const repositoryDescriptors = commandContext.provider.getRepositoryDescriptors();
  const visibleRepoRoots =
    typeof commandContext.provider.getVisibleRepoRoots === 'function'
      ? commandContext.provider.getVisibleRepoRoots()
      : repositoryDescriptors.map((repository) => repository.repoRoot);
  const visibleRepoRootSet = new Set(visibleRepoRoots);

  return repositoryDescriptors.filter((repository) => visibleRepoRootSet.has(repository.repoRoot));
}

function buildMissingUpstreamPrunePlan(
  branches: readonly BranchInfo[]
): MissingUpstreamPrunePlan {
  const protectedBranchNames = getProtectedBranchNames();
  const deletableBranchNames: string[] = [];
  const skippedCurrentBranchNames: string[] = [];
  const skippedProtectedBranchNames: string[] = [];

  for (const branch of branches) {
    if ((branch.scope ?? 'local') !== 'local' || !branch.upstreamMissing) {
      continue;
    }

    if (isBranchProtectedFromDeletion(branch, protectedBranchNames)) {
      skippedProtectedBranchNames.push(branch.name);
      continue;
    }

    if (branch.isCurrent) {
      skippedCurrentBranchNames.push(branch.name);
      continue;
    }

    deletableBranchNames.push(branch.name);
  }

  return {
    deletableBranchNames,
    skippedCurrentBranchNames,
    skippedProtectedBranchNames,
  };
}

async function pruneMissingUpstreamBranchesForRepository(
  repoRoot: string,
  branchNames: readonly string[]
): Promise<MissingUpstreamPruneResult> {
  const deletedBranchNames: string[] = [];
  const failedBranches: MissingUpstreamPruneResult['failedBranches'] = [];

  for (const branchName of branchNames) {
    try {
      await deleteBranch(repoRoot, branchName, true);
      deletedBranchNames.push(branchName);
    } catch (error) {
      failedBranches.push({
        label: branchName,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    deletedBranchNames,
    failedBranches,
  };
}

function buildSingleRepositoryConfirmationMessage(
  prunePlan: MissingUpstreamPrunePlan
): string {
  const parts = [
    `Prune ${prunePlan.deletableBranchNames.length} local ${pluralize('branch', prunePlan.deletableBranchNames.length)} with missing upstreams after fetching and pruning remotes?`,
    buildNamePreview(prunePlan.deletableBranchNames),
  ];

  if (prunePlan.skippedProtectedBranchNames.length > 0) {
    parts.push(
      `Protected ${pluralize('branch', prunePlan.skippedProtectedBranchNames.length)} will be skipped: ${formatNameList(prunePlan.skippedProtectedBranchNames)}.`
    );
  }

  if (prunePlan.skippedCurrentBranchNames.length > 0) {
    parts.push(
      `Current ${pluralize('branch', prunePlan.skippedCurrentBranchNames.length)} will be skipped: ${formatNameList(prunePlan.skippedCurrentBranchNames)}.`
    );
  }

  return parts.filter(Boolean).join(' ');
}

function buildSingleRepositoryNoBranchesMessage(
  prunePlan: MissingUpstreamPrunePlan
): string {
  const parts = [
    'Fetched all remotes, pruned deleted refs, and no deletable local branches with missing upstreams were found.',
  ];

  if (prunePlan.skippedProtectedBranchNames.length > 0) {
    parts.push(
      `Skipped protected ${pluralize('branch', prunePlan.skippedProtectedBranchNames.length)}: ${formatNameList(prunePlan.skippedProtectedBranchNames)}.`
    );
  }

  if (prunePlan.skippedCurrentBranchNames.length > 0) {
    parts.push(
      `Skipped current ${pluralize('branch', prunePlan.skippedCurrentBranchNames.length)}: ${formatNameList(prunePlan.skippedCurrentBranchNames)}.`
    );
  }

  return parts.join(' ');
}

function buildSingleRepositoryResultMessage(
  prunePlan: MissingUpstreamPrunePlan,
  pruneResult: MissingUpstreamPruneResult
): string {
  const parts = [
    `Fetched all remotes, pruned deleted refs, and pruned ${pruneResult.deletedBranchNames.length} local ${pluralize('branch', pruneResult.deletedBranchNames.length)} with missing upstreams.`,
  ];

  if (prunePlan.skippedProtectedBranchNames.length > 0) {
    parts.push(
      `Skipped protected ${pluralize('branch', prunePlan.skippedProtectedBranchNames.length)}: ${formatNameList(prunePlan.skippedProtectedBranchNames)}.`
    );
  }

  if (prunePlan.skippedCurrentBranchNames.length > 0) {
    parts.push(
      `Skipped current ${pluralize('branch', prunePlan.skippedCurrentBranchNames.length)}: ${formatNameList(prunePlan.skippedCurrentBranchNames)}.`
    );
  }

  if (pruneResult.failedBranches.length > 0) {
    parts.push(`Failures: ${formatFailureList(pruneResult.failedBranches)}.`);
  }

  return parts.join(' ');
}

function buildAllRepositoriesConfirmationMessage(
  repositoryPrunePlans: readonly RepositoryPrunePlan[]
): string {
  const totalPrunableBranchNames = repositoryPrunePlans.flatMap((repository) =>
    repository.plan.deletableBranchNames.map((branchName) => `${repository.label}:${branchName}`)
  );
  const skippedProtectedBranchNames = repositoryPrunePlans.flatMap((repository) =>
    repository.plan.skippedProtectedBranchNames.map((branchName) => `${repository.label}:${branchName}`)
  );
  const skippedCurrentBranchNames = repositoryPrunePlans.flatMap((repository) =>
    repository.plan.skippedCurrentBranchNames.map((branchName) => `${repository.label}:${branchName}`)
  );

  const parts = [
    `Prune ${totalPrunableBranchNames.length} local ${pluralize('branch', totalPrunableBranchNames.length)} with missing upstreams across ${repositoryPrunePlans.length} ${pluralize('repository', repositoryPrunePlans.length)} after fetching and pruning remotes?`,
    buildNamePreview(totalPrunableBranchNames),
  ];

  if (skippedProtectedBranchNames.length > 0) {
    parts.push(
      `Protected ${pluralize('branch', skippedProtectedBranchNames.length)} will be skipped: ${formatNameList(skippedProtectedBranchNames)}.`
    );
  }

  if (skippedCurrentBranchNames.length > 0) {
    parts.push(
      `Current ${pluralize('branch', skippedCurrentBranchNames.length)} will be skipped: ${formatNameList(skippedCurrentBranchNames)}.`
    );
  }

  return parts.filter(Boolean).join(' ');
}

function buildAllRepositoriesNoBranchesMessage(
  repositoryPrunePlans: readonly RepositoryPrunePlan[],
  fetchFailures: readonly RepositoryFailure[]
): string {
  const skippedProtectedBranchNames = repositoryPrunePlans.flatMap((repository) =>
    repository.plan.skippedProtectedBranchNames.map((branchName) => `${repository.label}:${branchName}`)
  );
  const skippedCurrentBranchNames = repositoryPrunePlans.flatMap((repository) =>
    repository.plan.skippedCurrentBranchNames.map((branchName) => `${repository.label}:${branchName}`)
  );

  const parts = [
    `Fetched all remotes with pruning in ${repositoryPrunePlans.length} ${pluralize('repository', repositoryPrunePlans.length)} and no deletable local branches with missing upstreams were found.`,
  ];

  if (skippedProtectedBranchNames.length > 0) {
    parts.push(
      `Skipped protected ${pluralize('branch', skippedProtectedBranchNames.length)}: ${formatNameList(skippedProtectedBranchNames)}.`
    );
  }

  if (skippedCurrentBranchNames.length > 0) {
    parts.push(
      `Skipped current ${pluralize('branch', skippedCurrentBranchNames.length)}: ${formatNameList(skippedCurrentBranchNames)}.`
    );
  }

  if (fetchFailures.length > 0) {
    parts.push(`Failed repositories: ${formatFailureList(fetchFailures)}.`);
  }

  return parts.join(' ');
}

function buildAllRepositoriesCancelledMessage(
  fetchFailures: readonly RepositoryFailure[]
): string {
  const parts = [
    'Fetched all remotes with pruning and cancelled pruning local branches with missing upstreams.',
  ];

  if (fetchFailures.length > 0) {
    parts.push(`Failed repositories: ${formatFailureList(fetchFailures)}.`);
  }

  return parts.join(' ');
}

function buildAllRepositoriesResultMessage(
  repositoryPrunePlans: readonly RepositoryPrunePlan[],
  pruneResults: ReadonlyArray<{ label: string; result: MissingUpstreamPruneResult }>,
  fetchFailures: readonly RepositoryFailure[]
): string {
  const deletedBranchCount = pruneResults.reduce(
    (count, repository) => count + repository.result.deletedBranchNames.length,
    0
  );
  const skippedProtectedBranchNames = repositoryPrunePlans.flatMap((repository) =>
    repository.plan.skippedProtectedBranchNames.map((branchName) => `${repository.label}:${branchName}`)
  );
  const skippedCurrentBranchNames = repositoryPrunePlans.flatMap((repository) =>
    repository.plan.skippedCurrentBranchNames.map((branchName) => `${repository.label}:${branchName}`)
  );
  const failedBranches = pruneResults.flatMap((repository) =>
    repository.result.failedBranches.map((failure) => ({
      label: `${repository.label}:${failure.label}`,
      reason: failure.reason,
    }))
  );

  const parts = [
    `Fetched all remotes with pruning in ${repositoryPrunePlans.length} ${pluralize('repository', repositoryPrunePlans.length)} and pruned ${deletedBranchCount} local ${pluralize('branch', deletedBranchCount)} with missing upstreams.`,
  ];

  if (skippedProtectedBranchNames.length > 0) {
    parts.push(
      `Skipped protected ${pluralize('branch', skippedProtectedBranchNames.length)}: ${formatNameList(skippedProtectedBranchNames)}.`
    );
  }

  if (skippedCurrentBranchNames.length > 0) {
    parts.push(
      `Skipped current ${pluralize('branch', skippedCurrentBranchNames.length)}: ${formatNameList(skippedCurrentBranchNames)}.`
    );
  }

  if (failedBranches.length > 0) {
    parts.push(`Failures: ${formatFailureList(failedBranches)}.`);
  }

  if (fetchFailures.length > 0) {
    parts.push(`Failed repositories: ${formatFailureList(fetchFailures)}.`);
  }

  return parts.join(' ');
}

function getProtectedBranchNames(): string[] {
  return normalizeConfiguredBranchNames(
    vscode.workspace
      .getConfiguration('gitBranchesPanel')
      .get<string[]>('protectedBranchNames', [...DEFAULT_PROTECTED_BRANCH_NAMES])
  );
}

function buildNamePreview(names: readonly string[]): string {
  if (names.length === 0) {
    return '';
  }

  return `Targets: ${formatNameList(names, 5)}.`;
}

function formatNameList(names: readonly string[], limit = 3): string {
  if (names.length <= limit) {
    return names.join(', ');
  }

  const remaining = names.length - limit;
  return `${names.slice(0, limit).join(', ')}, and ${remaining} more`;
}

function formatFailureList(
  failures: ReadonlyArray<{ label: string; reason: string }>
): string {
  return failures.map((failure) => `${failure.label} (${failure.reason})`).join('; ');
}

function pluralize(noun: string, count: number): string {
  if (count === 1) {
    return noun;
  }

  if (/[^aeiou]y$/iu.test(noun)) {
    return `${noun.slice(0, -1)}ies`;
  }

  return /(s|x|z|ch|sh)$/u.test(noun) ? `${noun}es` : `${noun}s`;
}

function showResultNotification(
  kind: 'info' | 'warning',
  message: string
): void {
  if (kind === 'warning') {
    vscode.window.showWarningMessage(message);
    return;
  }

  vscode.window.showInformationMessage(message);
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
