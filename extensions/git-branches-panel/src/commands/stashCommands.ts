import * as vscode from 'vscode';
import { join } from 'node:path';

import {
  applyStash,
  dropAllStashes,
  dropStash,
  getDiffFilesBetweenRefs,
  getStashes,
  popStash,
  renameStash,
  stashAllChanges,
  stashSilently,
  stashStagedChanges,
  stashStagedSilently,
} from '../git';
import { BranchTreeItem } from '../treeProvider';
import {
  getGitApi,
  NO_CURRENT_BRANCH_MESSAGE,
  resolveRepoRootFromScmContext,
  type CommandContext,
} from './shared';

type StashExecutor = (repoRoot: string, message?: string) => Promise<boolean>;
type GitExtensionApi = NonNullable<Awaited<ReturnType<typeof getGitApi>>>;

export function registerStashCommands(
  context: vscode.ExtensionContext,
  commandContext: CommandContext
): void {
  const subscriptions = [
    vscode.commands.registerCommand('gitBranchesPanel.stashSilently', async (target?: unknown) => {
      await handleStashSilently(commandContext, target);
    }),
    vscode.commands.registerCommand(
      'gitBranchesPanel.stashStagedSilently',
      async (target?: unknown) => {
        await handleStashStagedSilently(commandContext, target);
      }
    ),
    vscode.commands.registerCommand('gitBranchesPanel.stashAllChanges', async (target?: unknown) => {
      await handleStashAllChanges(commandContext, target);
    }),
    vscode.commands.registerCommand(
      'gitBranchesPanel.stashStagedChanges',
      async (target?: unknown) => {
        await handleStashStagedChanges(commandContext, target);
      }
    ),
    vscode.commands.registerCommand('gitBranchesPanel.applyStash', async (item: BranchTreeItem) => {
      await handleApplyStash(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.popStash', async (item: BranchTreeItem) => {
      await handlePopStash(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.renameStash', async (item: BranchTreeItem) => {
      await handleRenameStash(item, commandContext);
    }),
    vscode.commands.registerCommand(
      'gitBranchesPanel.compareStashWithCurrent',
      async (item: BranchTreeItem) => {
        await handleCompareStashWithCurrent(item, commandContext);
      }
    ),
    vscode.commands.registerCommand(
      'gitBranchesPanel.applyLatestStash',
      async (item?: BranchTreeItem) => {
        await handleApplyLatestStash(item, commandContext);
      }
    ),
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
    ),
  ];

  context.subscriptions.push(...subscriptions);
}

async function handlePopLatestStash(
  item: BranchTreeItem | undefined,
  commandContext: CommandContext
): Promise<void> {
  await handleLatestStashAction(item, commandContext, {
    emptyMessage: 'No stashes were found to pop.',
    failureMessage: 'Failed to pop the latest stash',
    run: async (repoRoot, stashName) => {
      await popStash(repoRoot, stashName);
    },
    successMessage: (stashName) => `Popped latest stash '${stashName}'.`,
  });
}

async function handleApplyLatestStash(
  item: BranchTreeItem | undefined,
  commandContext: CommandContext
): Promise<void> {
  await handleLatestStashAction(item, commandContext, {
    emptyMessage: 'No stashes were found to apply.',
    failureMessage: 'Failed to apply the latest stash',
    run: async (repoRoot, stashName) => {
      await applyStash(repoRoot, stashName);
    },
    successMessage: (stashName) => `Applied latest stash '${stashName}'.`,
  });
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
  const repoRootFromScm = target == null ? undefined : await resolveRepoRootFromScmContext(target);
  const repoRoot = repoRootFromScm ?? (await commandContext.requireRepoRoot());
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

async function handleRenameStash(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!isStashItem(item)) {
    return;
  }

  const currentMessage = getEditableStashMessage(item.branchInfo?.lastCommit);
  const renamedMessageInput = await vscode.window.showInputBox({
    prompt: `Rename stash '${item.branchName}'`,
    placeHolder: 'Stash message',
    value: currentMessage,
    validateInput: (value) => validateStashRenameMessage(value, currentMessage),
  });
  if (!renamedMessageInput) {
    return;
  }

  const renamedMessage = renamedMessageInput.trim();
  const stashIdentifier = item.branchInfo?.stashRevision ?? item.branchName;

  try {
    await renameStash(item.repoRoot, stashIdentifier, renamedMessage);
    await commandContext.showSuccessAndRefresh(
      `Renamed stash '${item.branchName}' to '${renamedMessage}'.`,
      {
        fetchRemoteState: false,
      }
    );
  } catch (error) {
    commandContext.showCommandError(`Failed to rename stash '${item.branchName}'`, error);
  }
}

async function handleCompareStashWithCurrent(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!isStashItem(item)) {
    return;
  }

  const currentBranch = await commandContext.requireCurrentBranch(NO_CURRENT_BRANCH_MESSAGE);
  if (!currentBranch) {
    return;
  }

  const stashReference = item.branchInfo?.stashRevision ?? item.branchName;

  try {
    const changes = await getDiffFilesBetweenRefs(item.repoRoot, currentBranch.name, stashReference);
    if (changes.length === 0) {
      vscode.window.showInformationMessage(
        `No differences found between current branch '${currentBranch.name}' and stash '${item.branchName}'.`
      );
      return;
    }

    const gitApi = await getGitApi();
    if (!gitApi) {
      vscode.window.showErrorMessage('The built-in Git extension API is not available.');
      return;
    }

    const repository = gitApi.getRepository(vscode.Uri.file(item.repoRoot));
    if (!repository) {
      vscode.window.showErrorMessage('Could not resolve the Git repository for this workspace.');
      return;
    }

    const resources = changes.map((change) =>
      buildCompareResource(change, item.repoRoot, currentBranch.name, stashReference, gitApi)
    );
    const reveal = resources.find((resource) => resource.modifiedUri || resource.originalUri);

    await vscode.commands.executeCommand('_workbench.openMultiDiffEditor', {
      multiDiffSourceUri: vscode.Uri.from({
        scheme: 'scm-history-item',
        path: `${repository.rootUri.path}/${currentBranch.name}..${item.branchName}`,
      }),
      title: `Compare stash '${item.branchName}' with current '${currentBranch.name}'`,
      resources,
      reveal,
    });
  } catch (error) {
    commandContext.showCommandError(
      `Failed to compare stash '${item.branchName}' with current branch '${currentBranch.name}'`,
      error
    );
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

interface LatestStashActionOptions {
  readonly emptyMessage: string;
  readonly failureMessage: string;
  run(repoRoot: string, stashName: string): Promise<void>;
  successMessage(stashName: string): string;
}

async function handleLatestStashAction(
  item: BranchTreeItem | undefined,
  commandContext: CommandContext,
  options: LatestStashActionOptions
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
      vscode.window.showInformationMessage(options.emptyMessage);
      return;
    }

    await options.run(repoRoot, latestStash.name);
    await commandContext.showSuccessAndRefresh(options.successMessage(latestStash.name), {
      fetchRemoteState: false,
    });
  } catch (error) {
    commandContext.showCommandError(options.failureMessage, error);
  }
}

function isStashItem(
  item: BranchTreeItem
): item is BranchTreeItem & { branchName: string; repoRoot: string } {
  return Boolean(item.branchName && item.repoRoot && item.nodeType === 'stash');
}

function getEditableStashMessage(stashMessage: string | undefined): string {
  const match = stashMessage?.match(/^(?:WIP on|On) [^:]+:\s*(.*)$/u);
  return match?.[1] ?? stashMessage ?? '';
}

function validateStashRenameMessage(value: string, currentMessage: string): string | undefined {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return 'Stash message cannot be empty.';
  }

  if (normalizedValue === currentMessage.trim()) {
    return 'Please enter a different stash message.';
  }

  return undefined;
}

function buildCompareResource(
  change: {
    status: 'A' | 'D' | 'M' | 'R';
    path: string;
    originalPath?: string;
  },
  repoRoot: string,
  currentRef: string,
  compareRef: string,
  gitApi: GitExtensionApi
): { originalUri?: vscode.Uri; modifiedUri?: vscode.Uri } {
  switch (change.status) {
    case 'A':
      return {
        modifiedUri: gitApi.toGitUri(vscode.Uri.file(join(repoRoot, change.path)), compareRef),
      };
    case 'D':
      return {
        originalUri: gitApi.toGitUri(vscode.Uri.file(join(repoRoot, change.path)), currentRef),
      };
    case 'R':
      return {
        originalUri: change.originalPath
          ? gitApi.toGitUri(vscode.Uri.file(join(repoRoot, change.originalPath)), currentRef)
          : undefined,
        modifiedUri: gitApi.toGitUri(vscode.Uri.file(join(repoRoot, change.path)), compareRef),
      };
    default:
      return {
        originalUri: gitApi.toGitUri(vscode.Uri.file(join(repoRoot, change.path)), currentRef),
        modifiedUri: gitApi.toGitUri(vscode.Uri.file(join(repoRoot, change.path)), compareRef),
      };
  }
}
