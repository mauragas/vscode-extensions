import * as vscode from 'vscode';
import { join } from 'node:path';

import {
  isPublishableBranch,
  type RemoteTrackingState,
} from '../branchModel';
import {
  DEFAULT_NEW_BRANCH_PREFIXES,
  DEFAULT_PROTECTED_BRANCH_NAMES,
  isBranchProtectedFromDeletion,
  normalizeConfiguredBranchNames,
  normalizeConfiguredBranchPrefixes,
} from '../branchRules';
import { getErrorMessage } from '../errorUtils';
import {
  buildBranchWebUrl,
  buildCompareWebUrl,
  buildPullRequestWebUrl,
  cherryPickRef,
  checkoutBranch,
  checkoutRemoteBranch,
  createBranch,
  createBranchFromRef,
  deleteBranch,
  deleteRemoteBranch,
  getRemoteDefaultBranch,
  getRemoteDetails,
  getRemoteBranchTrackingState,
  getDiffFilesBetweenRefs,
  mergeBranchIntoCurrent,
  parseCustomRemoteHostingProviders,
  pushBranch as pushBranchToRemote,
  removeRemoteTrackingRef,
  resolveCompareBaseBranch,
  resolveHostedRepository,
  resolveRemoteBranchName,
  resolveRemoteNameForBranch,
  getUpstreamBranchName,
  renameBranch,
  syncBranch,
  type CompareBaseStrategy,
  type CustomRemoteHostingProvider,
  type HostedRepository,
  type RemoteInfo,
} from '../git';
import {
  buildCurrentBranchAlreadyCheckedOutMessage,
  buildRemoteBranchCheckoutMessage,
  buildSyncResultMessage,
  looksLikeMergeSafetyError,
  normalizeBranchName,
  sanitizeNewBranchName,
  validateBranchName,
  validateNewBranchNameInput,
} from '../extensionHelpers';
import { BranchTreeItem } from '../treeProvider';
import { getGitApi, NO_CURRENT_BRANCH_MESSAGE, type CommandContext } from './shared';
import { getAdvancedBranchActionDefinitions } from './advancedBranchCommands';

const NORMALIZE_NEW_BRANCH_NAMES_SETTING = 'normalizeNewBranchNames';
const PROTECTED_BRANCH_NAMES_SETTING = 'protectedBranchNames';
const NEW_BRANCH_PREFIXES_SETTING = 'newBranchPrefixes';
const NEW_BRANCH_PLACEHOLDER = 'feature/my-feature or hotfix/bug-123';
const DELETE_ACTION = 'Delete';
const REFRESH_BRANCHES_ACTION = 'Refresh Branches';
const REMOVE_STALE_TRACKING_REF_ACTION = 'Remove Stale Tracking Ref';
const RETRY_WITHOUT_HOOK_ACTION = 'Retry Without Hook…';
const RETRY_WITHOUT_HOOK_CONFIRM_ACTION = 'Retry Without Hook';
const SHOW_DETAILS_ACTION = 'Show Details';
const OPEN_GIT_OUTPUT_ACTION = 'Open Git Output';
const REMOTE_HOSTING_PREFERRED_REMOTE_SETTING = 'remoteHosting.preferredRemote';
const REMOTE_HOSTING_COMPARE_BASE_SETTING = 'remoteHosting.compareBase';
const REMOTE_HOSTING_CUSTOM_PROVIDERS_SETTING = 'remoteHosting.customProviders';

type RemoteBranchTrackingState = RemoteTrackingState;
type RemoteBranchDeleteFailureKind =
  | 'LocalPrePushHookBlocked'
  | 'RemoteRejected'
  | 'MissingRemote'
  | 'AuthOrNetworkFailure'
  | 'Unknown';

interface RemoteBranchDeleteFailure {
  kind: RemoteBranchDeleteFailureKind;
  message: string;
  remoteName?: string;
}

interface BranchActionItem extends vscode.QuickPickItem {
  readonly actionId: string;
  run(): Promise<void>;
}

interface BranchPrefixQuickPickItem extends vscode.QuickPickItem {
  readonly prefix?: string;
}

interface NewBranchPromptOptions {
  prompt: string;
  currentName?: string;
  normalize: boolean;
}

interface RemoteHostingConfiguration {
  preferredRemote?: string;
  compareBase: CompareBaseStrategy;
  customProviders: readonly CustomRemoteHostingProvider[];
}

interface RemoteInfoQuickPickItem extends vscode.QuickPickItem {
  remoteInfo: RemoteInfo;
}

interface ResolvedRemoteHostingContext {
  branchName: string;
  repoRoot: string;
  remoteInfo: RemoteInfo;
  hostedRepository: HostedRepository;
  compareBaseBranchName?: string;
}

export function registerBranchDomainCommands(
  context: vscode.ExtensionContext,
  commandContext: CommandContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitBranchesPanel.activateBranchItem',
      async (item: BranchTreeItem) => {
        await handleBranchItemActivation(item, commandContext);
      }
    ),
    vscode.commands.registerCommand('gitBranchesPanel.checkout', async (item: BranchTreeItem) => {
      await handleCheckout(item, commandContext, true);
    }),
    vscode.commands.registerCommand(
      'gitBranchesPanel.showBranchActions',
      async (item: BranchTreeItem) => {
        await handleShowBranchActions(item);
      }
    ),
    vscode.commands.registerCommand('gitBranchesPanel.syncCurrentBranch', async (item?: BranchTreeItem) => {
      await handleSyncCurrentBranch(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.publishCurrentBranch', async (item?: BranchTreeItem) => {
      await handlePublishCurrentBranch(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.syncBranch', async (item: BranchTreeItem) => {
      await handleSyncBranch(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.publishBranch', async (item: BranchTreeItem) => {
      await handlePublishBranch(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.deleteBranch', async (item: BranchTreeItem) => {
      await handleDeleteBranch(item, commandContext);
    }),
    vscode.commands.registerCommand(
      'gitBranchesPanel.removeStaleRemoteTrackingRef',
      async (item: BranchTreeItem) => {
        await handleRemoveStaleRemoteTrackingRef(item, commandContext);
      }
    ),
    vscode.commands.registerCommand('gitBranchesPanel.newBranch', async (item?: BranchTreeItem) => {
      await handleNewBranch(item, commandContext);
    }),
    vscode.commands.registerCommand(
      'gitBranchesPanel.newBranchFromSelected',
      async (item: BranchTreeItem) => {
        await handleCreateBranchFromSelected(item, commandContext, false);
      }
    ),
    vscode.commands.registerCommand(
      'gitBranchesPanel.newBranchFromSelectedAndCheckout',
      async (item: BranchTreeItem) => {
        await handleCreateBranchFromSelected(item, commandContext, true);
      }
    ),
    vscode.commands.registerCommand('gitBranchesPanel.renameBranch', async (item: BranchTreeItem) => {
      await handleRenameBranch(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.copyBranchName', async (item: BranchTreeItem) => {
      await handleCopyBranchName(item);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.openBranchOnRemote', async (item: BranchTreeItem) => {
      await handleOpenBranchOnRemote(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.openComparePage', async (item: BranchTreeItem) => {
      await handleOpenComparePage(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.createPullRequest', async (item: BranchTreeItem) => {
      await handleCreatePullRequest(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.copyBranchUrl', async (item: BranchTreeItem) => {
      await handleCopyBranchUrl(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.copyCompareUrl', async (item: BranchTreeItem) => {
      await handleCopyCompareUrl(item, commandContext);
    }),
    vscode.commands.registerCommand(
      'gitBranchesPanel.compareBranchWithCurrent',
      async (item: BranchTreeItem) => {
        await handleCompareBranchWithCurrent(item, commandContext);
      }
    ),
    vscode.commands.registerCommand(
      'gitBranchesPanel.mergeIntoCurrent',
      async (item: BranchTreeItem) => {
        await handleMergeIntoCurrent(item, commandContext);
      }
    ),
    vscode.commands.registerCommand(
      'gitBranchesPanel.cherryPickIntoCurrent',
      async (item: BranchTreeItem) => {
        await handleCherryPickIntoCurrent(item, commandContext);
      }
    )
  );
}

async function handleBranchItemActivation(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (item.nodeType !== 'branch' && item.nodeType !== 'missingUpstreamBranch') {
    return;
  }

  if (!commandContext.activationTracker.shouldCheckout(item)) {
    return;
  }

  await handleCheckout(item, commandContext, false);
}

async function handleCheckout(
  item: BranchTreeItem,
  commandContext: CommandContext,
  allowCurrentBranchMessage = true
): Promise<void> {
  if (!item.branchName || !item.repoRoot) {
    return;
  }

  if (item.nodeType === 'currentBranch' || item.branchInfo?.isCurrent) {
    if (allowCurrentBranchMessage) {
      vscode.window.showInformationMessage(
        buildCurrentBranchAlreadyCheckedOutMessage(item.branchName)
      );
    }

    commandContext.activationTracker.reset();
    return;
  }

  if (item.nodeType === 'staleRemoteBranch') {
    vscode.window.showWarningMessage(
      `Remote-tracking ref '${item.branchName}' is stale. Create a new local branch from it instead of checking it out directly.`
    );
    return;
  }

  if (item.nodeType === 'remoteBranch') {
    try {
      const checkoutResult = await checkoutRemoteBranch(item.repoRoot, item.branchName);
      await commandContext.showSuccessAndRefresh(
        buildRemoteBranchCheckoutMessage(checkoutResult),
        { fetchRemoteState: false }
      );
    } catch (error) {
      commandContext.showCommandError(`Failed to checkout '${item.branchName}'`, error);
    }

    return;
  }

  try {
    await checkoutBranch(item.repoRoot, item.branchName);
    await commandContext.showSuccessAndRefresh(`Switched to '${item.branchName}'.`, {
      fetchRemoteState: false,
    });
  } catch (error) {
    commandContext.showCommandError(`Failed to checkout '${item.branchName}'`, error);
  }
}

async function handleShowBranchActions(item: BranchTreeItem | undefined): Promise<void> {
  if (!isBranchActionItem(item)) {
    return;
  }

  const selection = await vscode.window.showQuickPick(buildBranchActionItems(item), {
    placeHolder: `Choose an action for '${item.branchName}'`,
  });

  if (!selection) {
    return;
  }

  await selection.run();
}

async function handleSyncCurrentBranch(
  item: BranchTreeItem | undefined,
  commandContext: CommandContext
): Promise<void> {
  const repoRoot = await commandContext.requireRepoRoot(item?.repoRoot);
  if (!repoRoot) {
    return;
  }

  const currentBranch = await commandContext.requireCurrentBranch(NO_CURRENT_BRANCH_MESSAGE, repoRoot);
  if (!currentBranch) {
    return;
  }

  await syncBranchByName(repoRoot, currentBranch.name, commandContext);
}

async function handlePublishCurrentBranch(
  item: BranchTreeItem | undefined,
  commandContext: CommandContext
): Promise<void> {
  const repoRoot = await commandContext.requireRepoRoot(item?.repoRoot);
  if (!repoRoot) {
    return;
  }

  const currentBranch = await commandContext.requireCurrentBranch(NO_CURRENT_BRANCH_MESSAGE, repoRoot);
  if (!currentBranch) {
    return;
  }

  await pushBranchByName(repoRoot, currentBranch.name, commandContext);
}

async function handleSyncBranch(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!item.branchName || !item.repoRoot) {
    return;
  }

  await syncBranchByName(item.repoRoot, item.branchName, commandContext);
}

async function handlePublishBranch(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!item.branchName || !item.repoRoot) {
    return;
  }

  await pushBranchByName(item.repoRoot, item.branchName, commandContext);
}

async function handleDeleteBranch(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!item.branchName || !item.repoRoot) {
    return;
  }

  if (item.nodeType === 'currentBranch' || item.branchInfo?.isCurrent) {
    vscode.window.showInformationMessage('Cannot delete the current branch.');
    return;
  }

  if (isDeletionProtectedItem(item)) {
    showProtectedBranchDeleteMessage(item.branchName);
    return;
  }

  if (item.nodeType === 'staleRemoteBranch') {
    await showMissingRemoteNotification(item, commandContext, {
      kind: 'MissingRemote',
      message: `Remote branch '${item.branchName}' belongs to a remote that is no longer configured.`,
      remoteName: item.branchInfo?.remoteName,
    });
    return;
  }

  if (item.nodeType === 'remoteBranch') {
    const trackingState = await resolveRemoteBranchTrackingState(item);
    if (trackingState === 'stale') {
      await showMissingRemoteNotification(item, commandContext, {
        kind: 'MissingRemote',
        message: `Remote branch '${item.branchName}' belongs to a remote that is no longer configured.`,
        remoteName: item.branchInfo?.remoteName,
      });
      return;
    }

    const confirmation = await vscode.window.showWarningMessage(
      `Delete remote branch '${item.branchName}'?`,
      { modal: true },
      DELETE_ACTION
    );
    if (confirmation !== DELETE_ACTION) {
      return;
    }

    await performRemoteBranchDelete(item, commandContext);

    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    `Delete branch '${item.branchName}'?`,
    { modal: true },
    DELETE_ACTION
  );
  if (confirmation !== DELETE_ACTION) {
    return;
  }

  try {
    await deleteBranch(item.repoRoot, item.branchName, false);
    await commandContext.showSuccessAndRefresh(`Deleted branch '${item.branchName}'.`);
  } catch (error) {
    const message = getErrorMessage(error);
    if (!looksLikeMergeSafetyError(message)) {
      commandContext.showCommandError(`Failed to delete '${item.branchName}'`, error);
      return;
    }

    const forceDelete = await vscode.window.showWarningMessage(
      `Branch '${item.branchName}' is not fully merged. Force delete it?`,
      { modal: true },
      'Force Delete'
    );
    if (forceDelete !== 'Force Delete') {
      return;
    }

    try {
      await deleteBranch(item.repoRoot, item.branchName, true);
      await commandContext.showSuccessAndRefresh(`Force deleted branch '${item.branchName}'.`);
    } catch (forceDeleteError) {
      commandContext.showCommandError(
        `Failed to force delete '${item.branchName}'`,
        forceDeleteError
      );
    }
  }
}

async function handleNewBranch(
  item: BranchTreeItem | undefined,
  commandContext: CommandContext
): Promise<void> {
  const repoRoot = await commandContext.requireRepoRoot(item?.repoRoot);
  if (!repoRoot) {
    return;
  }

  const branchName = await promptForNewBranchName({
    prompt: 'Enter a name for the new branch',
    normalize: shouldNormalizeNewBranchNames(),
  });
  if (!branchName) {
    return;
  }

  try {
    await createBranch(repoRoot, branchName);
    await commandContext.showSuccessAndRefresh(`Created and switched to '${branchName}'.`);
  } catch (error) {
    commandContext.showCommandError(`Failed to create '${branchName}'`, error);
  }
}

async function handleCreateBranchFromSelected(
  item: BranchTreeItem,
  commandContext: CommandContext,
  checkoutNewBranch: boolean
): Promise<void> {
  if (!item.branchName || !item.repoRoot) {
    return;
  }

  if (
    item.nodeType !== 'branch' &&
    item.nodeType !== 'currentBranch' &&
    item.nodeType !== 'remoteBranch' &&
    item.nodeType !== 'staleRemoteBranch' &&
    item.nodeType !== 'missingUpstreamBranch'
  ) {
    return;
  }

  const sourceBranchName = item.branchName;
  const sourceBranchDisplayName = sourceBranchName;
  const branchName = await promptForNewBranchName({
    prompt: checkoutNewBranch
      ? `Enter a name for the new branch to create from '${sourceBranchDisplayName}' and switch to`
      : `Enter a name for the new branch to create from '${sourceBranchDisplayName}'`,
    currentName:
      item.nodeType === 'remoteBranch' || item.nodeType === 'staleRemoteBranch'
        ? undefined
        : sourceBranchName,
    normalize: shouldNormalizeNewBranchNames(),
  });
  if (!branchName) {
    return;
  }

  try {
    await createBranchFromRef(item.repoRoot, branchName, sourceBranchName, {
      checkout: checkoutNewBranch,
    });
    await commandContext.showSuccessAndRefresh(
      checkoutNewBranch
        ? `Created and switched to '${branchName}' from '${sourceBranchDisplayName}'.`
        : `Created branch '${branchName}' from '${sourceBranchDisplayName}'.`,
      { fetchRemoteState: false }
    );
  } catch (error) {
    commandContext.showCommandError(
      `Failed to create '${branchName}' from '${sourceBranchDisplayName}'`,
      error
    );
  }
}

async function handleRenameBranch(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!item.branchName || !item.repoRoot) {
    return;
  }

  const newName = await vscode.window.showInputBox({
    prompt: `Rename '${item.branchName}' to:`,
    value: item.branchName,
    validateInput: (value) => validateBranchName(value, item.branchName),
  });
  if (!newName) {
    return;
  }

  const branchName = newName.trim();

  try {
    await renameBranch(item.repoRoot, item.branchName, branchName);
    await commandContext.showSuccessAndRefresh(`Renamed branch to '${branchName}'.`);
  } catch (error) {
    commandContext.showCommandError(`Failed to rename '${item.branchName}'`, error);
  }
}

async function handleCopyBranchName(item: BranchTreeItem): Promise<void> {
  if (!item.branchName) {
    return;
  }

  await vscode.env.clipboard.writeText(item.branchName);
  vscode.window.showInformationMessage(`Copied '${item.branchName}' to the clipboard.`);
}

async function handleOpenBranchOnRemote(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  const hostedContext = await resolveRemoteHostingContext(item, commandContext, false);
  if (!hostedContext) {
    return;
  }

  const branchUrl = buildBranchWebUrl(hostedContext.hostedRepository, hostedContext.branchName);
  if (!branchUrl) {
    vscode.window.showErrorMessage(
      `Remote '${hostedContext.remoteInfo.name}' does not expose a branch page URL template.`
    );
    return;
  }

  await openExternalUrl(branchUrl);
}

async function handleOpenComparePage(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  const hostedContext = await resolveRemoteHostingContext(item, commandContext, true);
  if (!hostedContext?.compareBaseBranchName) {
    return;
  }

  const compareUrl = buildCompareWebUrl(
    hostedContext.hostedRepository,
    hostedContext.compareBaseBranchName,
    hostedContext.branchName
  );
  if (!compareUrl) {
    vscode.window.showErrorMessage(
      `Remote '${hostedContext.remoteInfo.name}' does not expose a compare page URL template.`
    );
    return;
  }

  await openExternalUrl(compareUrl);
}

async function handleCreatePullRequest(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  const hostedContext = await resolveRemoteHostingContext(item, commandContext, true);
  if (!hostedContext?.compareBaseBranchName) {
    return;
  }

  const pullRequestUrl = buildPullRequestWebUrl(
    hostedContext.hostedRepository,
    hostedContext.compareBaseBranchName,
    hostedContext.branchName
  );
  if (!pullRequestUrl) {
    vscode.window.showErrorMessage(
      `Remote '${hostedContext.remoteInfo.name}' does not expose a pull request creation URL template.`
    );
    return;
  }

  await openExternalUrl(pullRequestUrl);
}

async function handleCopyBranchUrl(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  const hostedContext = await resolveRemoteHostingContext(item, commandContext, false);
  if (!hostedContext) {
    return;
  }

  const branchUrl = buildBranchWebUrl(hostedContext.hostedRepository, hostedContext.branchName);
  if (!branchUrl) {
    vscode.window.showErrorMessage(
      `Remote '${hostedContext.remoteInfo.name}' does not expose a branch page URL template.`
    );
    return;
  }

  await vscode.env.clipboard.writeText(branchUrl);
  vscode.window.showInformationMessage(`Copied branch URL for '${item.branchName}' to the clipboard.`);
}

async function handleCopyCompareUrl(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  const hostedContext = await resolveRemoteHostingContext(item, commandContext, true);
  if (!hostedContext?.compareBaseBranchName) {
    return;
  }

  const compareUrl = buildCompareWebUrl(
    hostedContext.hostedRepository,
    hostedContext.compareBaseBranchName,
    hostedContext.branchName
  );
  if (!compareUrl) {
    vscode.window.showErrorMessage(
      `Remote '${hostedContext.remoteInfo.name}' does not expose a compare page URL template.`
    );
    return;
  }

  await vscode.env.clipboard.writeText(compareUrl);
  vscode.window.showInformationMessage(`Copied compare URL for '${item.branchName}' to the clipboard.`);
}

async function handleCompareBranchWithCurrent(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!item.branchName || !item.repoRoot) {
    return;
  }

  if (
    item.nodeType !== 'branch' &&
    item.nodeType !== 'missingUpstreamBranch' &&
    item.nodeType !== 'remoteBranch' &&
    item.nodeType !== 'staleRemoteBranch'
  ) {
    return;
  }

  const compareBranchName = item.branchName;
  const repoRoot = item.repoRoot;

  const currentBranch = await commandContext.requireCurrentBranch(
    NO_CURRENT_BRANCH_MESSAGE,
    repoRoot
  );
  if (!currentBranch) {
    return;
  }

  if (compareBranchName === currentBranch.name) {
    vscode.window.showInformationMessage(`'${compareBranchName}' is already the current branch.`);
    return;
  }

  try {
    const changes = await getDiffFilesBetweenRefs(repoRoot, currentBranch.name, compareBranchName);
    if (changes.length === 0) {
      vscode.window.showInformationMessage(
        `No differences found between current branch '${currentBranch.name}' and '${compareBranchName}'.`
      );
      return;
    }

    const gitApi = await getGitApi();
    if (!gitApi) {
      vscode.window.showErrorMessage('The built-in Git extension API is not available.');
      return;
    }

    const repository = gitApi.getRepository(vscode.Uri.file(repoRoot));
    if (!repository) {
      vscode.window.showErrorMessage('Could not resolve the Git repository for this workspace.');
      return;
    }

    const resources = changes.map((change) =>
      buildCompareResource(change, repoRoot, currentBranch.name, compareBranchName, gitApi)
    );
    const reveal = resources.find((resource) => resource.modifiedUri || resource.originalUri);

    await vscode.commands.executeCommand('_workbench.openMultiDiffEditor', {
      multiDiffSourceUri: vscode.Uri.from({
        scheme: 'scm-history-item',
        path: `${repository.rootUri.path}/${currentBranch.name}..${compareBranchName}`,
      }),
      title: `Compare '${compareBranchName}' with current '${currentBranch.name}'`,
      resources,
      reveal,
    });
  } catch (error) {
    commandContext.showCommandError(
      `Failed to compare '${compareBranchName}' with current branch '${currentBranch.name}'`,
      error
    );
  }
}

async function handleMergeIntoCurrent(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!item.branchName || !item.repoRoot || item.nodeType === 'currentBranch' || item.branchInfo?.isCurrent) {
    return;
  }

  const currentBranch = await commandContext.requireCurrentBranch(
    'Could not determine the current branch for this repository.',
    item.repoRoot
  );
  if (!currentBranch) {
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    `Merge '${item.branchName}' into current branch '${currentBranch.name}'?`,
    { modal: true },
    'Merge'
  );
  if (confirmation !== 'Merge') {
    return;
  }

  try {
    await mergeBranchIntoCurrent(item.repoRoot, item.branchName);
    await commandContext.showSuccessAndRefresh(
      `Merged '${item.branchName}' into '${currentBranch.name}'.`,
      { fetchRemoteState: false }
    );
  } catch (error) {
    commandContext.showCommandError(
      `Failed to merge '${item.branchName}' into '${currentBranch.name}'`,
      error
    );
  }
}

async function handleCherryPickIntoCurrent(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!item.branchName || !item.repoRoot || item.nodeType === 'currentBranch' || item.branchInfo?.isCurrent) {
    return;
  }

  if (
    item.nodeType !== 'branch' &&
    item.nodeType !== 'missingUpstreamBranch' &&
    item.nodeType !== 'remoteBranch' &&
    item.nodeType !== 'staleRemoteBranch'
  ) {
    return;
  }

  const currentBranch = await commandContext.requireCurrentBranch(
    'Could not determine the current branch for this repository.',
    item.repoRoot
  );
  if (!currentBranch) {
    return;
  }

  if (item.branchName === currentBranch.name) {
    vscode.window.showInformationMessage(`'${item.branchName}' is already the current branch.`);
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    `Cherry-pick '${item.branchName}' into current branch '${currentBranch.name}'?`,
    { modal: true },
    'Cherry-pick'
  );
  if (confirmation !== 'Cherry-pick') {
    return;
  }

  try {
    await cherryPickRef(item.repoRoot, item.branchName);
    await commandContext.showSuccessAndRefresh(
      `Cherry-picked '${item.branchName}' into '${currentBranch.name}'.`,
      { fetchRemoteState: false }
    );
  } catch (error) {
    commandContext.showCommandError(
      `Failed to cherry-pick '${item.branchName}' into '${currentBranch.name}'`,
      error
    );
  }
}

async function syncBranchByName(
  repoRoot: string,
  branchName: string,
  commandContext: CommandContext
): Promise<void> {
  try {
    const syncResult = await commandContext.provider.withBusyBranch(repoRoot, branchName, () =>
      syncBranch(repoRoot, branchName)
    );
    await commandContext.showSuccessAndRefresh(buildSyncResultMessage(syncResult), {
      fetchRemoteState: true,
      forceFetchRemoteState: true,
    });
  } catch (error) {
    commandContext.showCommandError(`Failed to sync '${branchName}'`, error);
  }
}

async function pushBranchByName(
  repoRoot: string,
  branchName: string,
  commandContext: CommandContext
): Promise<void> {
  try {
    const pushResult = await commandContext.provider.withBusyBranch(repoRoot, branchName, () =>
      pushBranchToRemote(repoRoot, branchName)
    );
    await commandContext.showSuccessAndRefresh(buildSyncResultMessage(pushResult), {
      fetchRemoteState: true,
      forceFetchRemoteState: true,
    });
  } catch (error) {
    commandContext.showCommandError(`Failed to publish '${branchName}'`, error);
  }
}

function shouldNormalizeNewBranchNames(): boolean {
  return vscode.workspace
    .getConfiguration('gitBranchesPanel')
    .get<boolean>(NORMALIZE_NEW_BRANCH_NAMES_SETTING, false);
}

function getProtectedBranchNames(): string[] {
  return normalizeConfiguredBranchNames(
    vscode.workspace
      .getConfiguration('gitBranchesPanel')
      .get<string[]>(PROTECTED_BRANCH_NAMES_SETTING, [...DEFAULT_PROTECTED_BRANCH_NAMES])
  );
}

function getConfiguredNewBranchPrefixes(): string[] {
  return normalizeConfiguredBranchPrefixes(
    vscode.workspace
      .getConfiguration('gitBranchesPanel')
      .get<string[]>(NEW_BRANCH_PREFIXES_SETTING, [...DEFAULT_NEW_BRANCH_PREFIXES])
  );
}

async function promptForNewBranchPrefix(): Promise<string | undefined> {
  const prefixes = getConfiguredNewBranchPrefixes();
  if (prefixes.length === 0) {
    return undefined;
  }

  const selection = await vscode.window.showQuickPick<BranchPrefixQuickPickItem>(
    [
      {
        label: 'No prefix',
        description: 'Start from a plain branch name',
      },
      ...prefixes.map((prefix) => ({
        label: `${prefix}/`,
        description: `Prefill the new branch name with '${prefix}/'`,
        prefix,
      })),
    ],
    {
      placeHolder: 'Choose a default branch folder for the new branch (optional)',
    }
  );

  return selection?.prefix;
}

async function promptForNewBranchName(
  options: NewBranchPromptOptions
): Promise<string | undefined> {
  const prefix = await promptForNewBranchPrefix();
  const prefixedBranchName = prefix ? `${prefix}/` : undefined;
  const name = await vscode.window.showInputBox({
    prompt: options.prompt,
    placeHolder: NEW_BRANCH_PLACEHOLDER,
    value: prefixedBranchName,
    valueSelection: prefixedBranchName
      ? [prefixedBranchName.length, prefixedBranchName.length]
      : undefined,
    validateInput: (value) =>
      validateNewBranchNameInput(value, options.currentName, {
        normalize: options.normalize,
      }),
  });
  if (!name) {
    return undefined;
  }

  return resolveNewBranchName(name, options.normalize) || undefined;
}

function resolveNewBranchName(name: string, normalize: boolean): string {
  return normalize ? normalizeBranchName(name) : sanitizeNewBranchName(name);
}

function buildBranchActionItems(item: BranchTreeItem): BranchActionItem[] {
  const items: BranchActionItem[] = [];
  const isStaleRemoteBranch = item.nodeType === 'staleRemoteBranch';
  const isCurrentBranch = item.nodeType === 'currentBranch' || Boolean(item.branchInfo?.isCurrent);

  if (item.nodeType !== 'remoteBranch' && item.nodeType !== 'staleRemoteBranch') {
    items.push(
      createBranchActionItem(
        isPublishableBranchItem(item) ? 'publishBranch' : 'syncBranch',
        isPublishableBranchItem(item)
          ? isCurrentBranch
            ? '$(cloud-upload) Publish Current Branch'
            : '$(cloud-upload) Publish Branch'
          : isCurrentBranch
            ? '$(sync) Sync Current Branch'
            : '$(sync) Sync Branch',
        async () => {
          await vscode.commands.executeCommand(
            isPublishableBranchItem(item)
              ? 'gitBranchesPanel.publishBranch'
              : 'gitBranchesPanel.syncBranch',
            item
          );
        }
      )
    );
  }

  if (canCreateWorktreeFromItem(item)) {
    items.push(
      createBranchActionItem('createWorktreeFromRef', '$(new-folder) Create Worktree...', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.createWorktreeFromRef', item);
      })
    );
  }

  if (!isStaleRemoteBranch) {
    items.push(
      createBranchActionItem('checkout', '$(arrow-right) Checkout Branch', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.checkout', item);
      })
    );
  }

  items.push(
    createBranchActionItem(
      'newBranchFromSelected',
      '$(add) New Branch from Selected Branch...',
      async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.newBranchFromSelected', item);
      }
    ),
    createBranchActionItem(
      'newBranchFromSelectedAndCheckout',
      '$(add) New Branch from Selected Branch and Checkout...',
      async () => {
        await vscode.commands.executeCommand(
          'gitBranchesPanel.newBranchFromSelectedAndCheckout',
          item
        );
      }
    )
  );

  if (item.nodeType !== 'remoteBranch' && item.nodeType !== 'staleRemoteBranch') {
    items.push(
      createBranchActionItem('renameBranch', '$(edit) Rename Branch', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.renameBranch', item);
      }),
      createBranchActionItem('createTag', '$(tag) Create Tag...', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.createTag', item);
      })
    );
  }

  items.push(
    createBranchActionItem('copyBranchName', '$(copy) Copy Branch Name', async () => {
      await vscode.commands.executeCommand('gitBranchesPanel.copyBranchName', item);
    })
  );

  if (supportsRemoteHostingActions(item)) {
    items.push(
      createBranchActionItem('openBranchOnRemote', '$(globe) Open Branch on Remote', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.openBranchOnRemote', item);
      }),
      createBranchActionItem('openComparePage', '$(link-external) Open Compare Page', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.openComparePage', item);
      }),
      createBranchActionItem('createPullRequest', '$(git-pull-request) Create Pull Request', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.createPullRequest', item);
      }),
      createBranchActionItem('copyBranchUrl', '$(copy) Copy Branch URL', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.copyBranchUrl', item);
      }),
      createBranchActionItem('copyCompareUrl', '$(copy) Copy Compare URL', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.copyCompareUrl', item);
      })
    );
  }

  if (canCompareWithUpstream(item)) {
    items.push(
      createBranchActionItem('compareWithUpstream', '$(diff-multiple) Compare with Upstream', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.compareWithUpstream', item);
      })
    );
  }

  if (supportsBranchHistoryActions(item)) {
    items.push(
      createBranchActionItem('showBranchCommits', '$(history) Show Branch Commits', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.showBranchCommits', item);
      }),
      createBranchActionItem('openChangedFilesForRef', '$(diff-multiple) Open Changed Files for Ref', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.openChangedFilesForRef', item);
      })
    );
  }

  for (const advancedAction of getAdvancedBranchActionDefinitions(item)) {
    items.push(
      createBranchActionItem(advancedAction.actionId, advancedAction.label, async () => {
        await vscode.commands.executeCommand(advancedAction.commandId, item);
      })
    );
  }

  if (!isCurrentBranch) {
    items.push(
      createBranchActionItem(
        'compareBranchWithCurrent',
        '$(diff-multiple) Compare with Current Branch',
        async () => {
          await vscode.commands.executeCommand('gitBranchesPanel.compareBranchWithCurrent', item);
        }
      ),
      createBranchActionItem('mergeIntoCurrent', '$(git-merge) Merge into Current Branch', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.mergeIntoCurrent', item);
      }),
      createBranchActionItem(
        'cherryPickIntoCurrent',
        '$(git-commit) Cherry-pick into Current Branch',
        async () => {
          await vscode.commands.executeCommand('gitBranchesPanel.cherryPickIntoCurrent', item);
        }
      )
    );

    if (!isDeletionProtectedItem(item)) {
      items.push(
        createBranchActionItem(
          isStaleRemoteBranch ? 'removeStaleRemoteTrackingRef' : 'deleteBranch',
          isStaleRemoteBranch ? '$(trash) Remove Stale Tracking Ref' : '$(trash) Delete Branch',
          async () => {
            await vscode.commands.executeCommand(
              isStaleRemoteBranch
                ? 'gitBranchesPanel.removeStaleRemoteTrackingRef'
                : 'gitBranchesPanel.deleteBranch',
              item
            );
          }
        )
      );
    }
  }

  return items;
}

function createBranchActionItem(
  actionId: string,
  label: string,
  run: () => Promise<void>
): BranchActionItem {
  return {
    actionId,
    label,
    run,
  };
}

function isBranchActionItem(item: BranchTreeItem | undefined): item is BranchTreeItem {
  return Boolean(item?.branchName && item.repoRoot && isSupportedBranchActionNodeType(item.nodeType));
}

function isSupportedBranchActionNodeType(
  nodeType: BranchTreeItem['nodeType']
): nodeType is 'branch' | 'currentBranch' | 'remoteBranch' | 'staleRemoteBranch' | 'missingUpstreamBranch' {
  return (
    nodeType === 'branch' ||
    nodeType === 'currentBranch' ||
    nodeType === 'remoteBranch' ||
    nodeType === 'staleRemoteBranch' ||
    nodeType === 'missingUpstreamBranch'
  );
}

function isPublishableBranchItem(item: BranchTreeItem): boolean {
  if (item.branchInfo) {
    return isPublishableBranch(item.branchInfo);
  }

  return (
    item.contextValue === 'publishableBranch' ||
    item.contextValue === 'publishableCurrentBranch' ||
    item.contextValue === 'missingUpstreamBranch' ||
    item.contextValue === 'busyPublishableBranch' ||
    item.contextValue === 'busyPublishableCurrentBranch' ||
    item.contextValue === 'busyMissingUpstreamBranch'
  );
}

function canCreateWorktreeFromItem(item: BranchTreeItem): boolean {
  return (
    item.nodeType === 'branch' ||
    item.nodeType === 'currentBranch' ||
    item.nodeType === 'missingUpstreamBranch' ||
    item.nodeType === 'remoteBranch' ||
    item.nodeType === 'staleRemoteBranch'
  );
}

function supportsRemoteHostingActions(item: BranchTreeItem): boolean {
  return (
    item.nodeType === 'branch' ||
    item.nodeType === 'currentBranch' ||
    item.nodeType === 'remoteBranch'
  );
}

function canCompareWithUpstream(item: BranchTreeItem): boolean {
  return Boolean(
    (item.nodeType === 'branch' || item.nodeType === 'currentBranch') &&
      item.branchInfo?.upstreamName &&
      !item.branchInfo.upstreamMissing
  );
}

function supportsBranchHistoryActions(item: BranchTreeItem): boolean {
  return (
    item.nodeType === 'branch' ||
    item.nodeType === 'currentBranch' ||
    item.nodeType === 'missingUpstreamBranch' ||
    item.nodeType === 'remoteBranch' ||
    item.nodeType === 'staleRemoteBranch'
  );
}

function isDeletionProtectedItem(item: Pick<BranchTreeItem, 'branchName' | 'branchInfo' | 'nodeType'>): boolean {
  if (!item.branchName) {
    return false;
  }

  const scope =
    item.branchInfo?.scope ??
    (item.nodeType === 'remoteBranch' || item.nodeType === 'staleRemoteBranch'
      ? 'remote'
      : 'local');

  return isBranchProtectedFromDeletion(
    {
      name: item.branchName,
      scope,
    },
    getProtectedBranchNames()
  );
}

function showProtectedBranchDeleteMessage(branchName: string): void {
  vscode.window.showWarningMessage(
    `Branch '${branchName}' is protected from deletion by 'gitBranchesPanel.protectedBranchNames'.`
  );
}

async function resolveRemoteHostingContext(
  item: BranchTreeItem,
  commandContext: CommandContext,
  needsCompareBase: boolean
): Promise<ResolvedRemoteHostingContext | undefined> {
  if (!item.branchName || !item.repoRoot || !supportsRemoteHostingActions(item)) {
    return undefined;
  }

  const remoteHostingConfiguration = getRemoteHostingConfiguration();
  const remoteDetails = await getRemoteDetails(item.repoRoot);
  if (remoteDetails.length === 0) {
    vscode.window.showErrorMessage('No git remotes were found for this repository.');
    return undefined;
  }

  const remoteInfo = await resolveRemoteInfoForBranch(item, remoteDetails, remoteHostingConfiguration);
  if (!remoteInfo) {
    return undefined;
  }

  const hostedRepository = resolveHostedRepository(remoteInfo, remoteHostingConfiguration.customProviders);
  if (!hostedRepository) {
    vscode.window.showErrorMessage(
      `Remote '${remoteInfo.name}' uses an unsupported hosting URL format: ${remoteInfo.fetchUrl}`
    );
    return undefined;
  }

  const branchName = resolveRemoteBranchName(item.branchName, item.branchInfo);
  const compareBaseBranchName = needsCompareBase
    ? await resolveRemoteHostingCompareBaseBranchName(
        item,
        commandContext,
        remoteInfo,
        remoteHostingConfiguration,
        branchName
      )
    : undefined;

  if (needsCompareBase && !compareBaseBranchName) {
    vscode.window.showErrorMessage(
      `Could not determine a compare base for '${item.branchName}'. Check your remote-host integration settings or choose a tracked branch.`
    );
    return undefined;
  }

  return {
    branchName,
    repoRoot: item.repoRoot,
    remoteInfo,
    hostedRepository,
    compareBaseBranchName,
  };
}

async function resolveRemoteInfoForBranch(
  item: BranchTreeItem,
  remoteDetails: readonly RemoteInfo[],
  remoteHostingConfiguration: RemoteHostingConfiguration
): Promise<RemoteInfo | undefined> {
  const branchIdentity = item.branchInfo ?? {
    scope: item.nodeType === 'remoteBranch' ? 'remote' : 'local',
  };

  const preferredRemoteName = resolveRemoteNameForBranch(
    branchIdentity,
    remoteDetails.map((remote) => remote.name),
    remoteHostingConfiguration.preferredRemote
  );

  if (preferredRemoteName) {
    return remoteDetails.find((remote) => remote.name === preferredRemoteName);
  }

  const selection = await vscode.window.showQuickPick<RemoteInfoQuickPickItem>(
    remoteDetails.map((remoteInfo) => ({
      label: remoteInfo.name,
      description: remoteInfo.fetchUrl,
      detail:
        remoteInfo.pushUrl && remoteInfo.pushUrl !== remoteInfo.fetchUrl
          ? `Push: ${remoteInfo.pushUrl}`
          : undefined,
      remoteInfo,
    })),
    {
      placeHolder: `Select a remote to open hosted URLs for '${item.branchName}'`,
      matchOnDescription: true,
      matchOnDetail: true,
    }
  );

  return selection?.remoteInfo;
}

async function resolveRemoteHostingCompareBaseBranchName(
  item: BranchTreeItem,
  commandContext: CommandContext,
  remoteInfo: RemoteInfo,
  remoteHostingConfiguration: RemoteHostingConfiguration,
  branchName: string
): Promise<string | undefined> {
  const repoRoot = item.repoRoot;
  if (!repoRoot) {
    return undefined;
  }

  const currentBranchName = commandContext.provider.getCurrentBranch(item.repoRoot)?.name;
  const upstreamBranchName = getUpstreamBranchName(item.branchInfo?.upstreamName);
  const defaultBranchName = await getRemoteDefaultBranch(repoRoot, remoteInfo.name);

  return resolveCompareBaseBranch({
    compareBaseStrategy: remoteHostingConfiguration.compareBase,
    headBranchName: branchName,
    currentBranchName,
    upstreamBranchName,
    defaultBranchName,
  });
}

function getRemoteHostingConfiguration(): RemoteHostingConfiguration {
  const configuration = vscode.workspace.getConfiguration('gitBranchesPanel');
  const preferredRemote = configuration.get<string>(REMOTE_HOSTING_PREFERRED_REMOTE_SETTING, '').trim();

  return {
    preferredRemote: preferredRemote || undefined,
    compareBase: configuration.get<CompareBaseStrategy>(
      REMOTE_HOSTING_COMPARE_BASE_SETTING,
      'defaultBranch'
    ),
    customProviders: parseCustomRemoteHostingProviders(
      configuration.get<unknown[]>(REMOTE_HOSTING_CUSTOM_PROVIDERS_SETTING, [])
    ),
  };
}

async function openExternalUrl(url: string): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(url));
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
  gitApi: GitApi
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

interface GitApi {
  getRepository(uri: vscode.Uri): { rootUri: vscode.Uri } | null;
  toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
}

async function performRemoteBranchDelete(
  item: BranchTreeItem,
  commandContext: CommandContext,
  options: {
    skipPushHooks?: boolean;
  } = {}
): Promise<void> {
  if (!item.branchName || !item.repoRoot) {
    return;
  }

  try {
    await deleteRemoteBranch(item.repoRoot, item.branchName, {
      skipPushHooks: options.skipPushHooks,
    });
    await commandContext.showSuccessAndRefresh(`Deleted remote branch '${item.branchName}'.`, {
      fetchRemoteState: true,
      forceFetchRemoteState: true,
    });
  } catch (error) {
    await handleRemoteBranchDeleteFailure(item, commandContext, error, options);
  }
}

async function handleRemoteBranchDeleteFailure(
  item: BranchTreeItem,
  commandContext: CommandContext,
  error: unknown,
  options: {
    skipPushHooks?: boolean;
  }
): Promise<void> {
  const failure = classifyRemoteBranchDeleteFailure(item.branchName ?? '', error);

  switch (failure.kind) {
    case 'LocalPrePushHookBlocked': {
      if (options.skipPushHooks ?? false) {
        await showGenericRemoteDeleteFailureNotification(item, error);
        return;
      }

      const selection = await vscode.window.showErrorMessage(
        'Remote branch deletion was blocked by a local Git pre-push hook.',
        RETRY_WITHOUT_HOOK_ACTION,
        SHOW_DETAILS_ACTION,
        OPEN_GIT_OUTPUT_ACTION
      );

      if (selection === RETRY_WITHOUT_HOOK_ACTION) {
        const confirmation = await vscode.window.showWarningMessage(
          `Retry deleting remote branch '${item.branchName}' without running local pre-push hooks? This bypasses local repository policy checks for this push only.`,
          { modal: true },
          RETRY_WITHOUT_HOOK_CONFIRM_ACTION
        );
        if (confirmation === RETRY_WITHOUT_HOOK_CONFIRM_ACTION) {
          await performRemoteBranchDelete(item, commandContext, { skipPushHooks: true });
        }
        return;
      }

      await handleRemoteDeleteFailureAuxiliaryAction(item, error, selection);
      return;
    }
    case 'MissingRemote': {
      await showMissingRemoteNotification(item, commandContext, failure, error);
      return;
    }
    case 'RemoteRejected': {
      const selection = await vscode.window.showErrorMessage(
        'Remote rejected branch deletion.',
        SHOW_DETAILS_ACTION,
        OPEN_GIT_OUTPUT_ACTION
      );
      await handleRemoteDeleteFailureAuxiliaryAction(item, error, selection);
      return;
    }
    case 'AuthOrNetworkFailure': {
      const selection = await vscode.window.showErrorMessage(
        `Could not delete remote branch '${item.branchName}'.`,
        SHOW_DETAILS_ACTION,
        OPEN_GIT_OUTPUT_ACTION
      );
      await handleRemoteDeleteFailureAuxiliaryAction(item, error, selection);
      return;
    }
    default:
      await showGenericRemoteDeleteFailureNotification(item, error);
  }
}

async function showMissingRemoteNotification(
  item: BranchTreeItem,
  commandContext: CommandContext,
  failure: RemoteBranchDeleteFailure,
  error?: unknown
): Promise<void> {
  const remoteName =
    failure.remoteName ?? item.branchInfo?.remoteName ?? parseRemoteBranchName(item.branchName);
  const selection = await vscode.window.showErrorMessage(
    remoteName
      ? `This branch belongs to remote '${remoteName}', but that remote is no longer configured.`
      : `This remote-tracking branch is stale because its remote is no longer configured.`,
    REMOVE_STALE_TRACKING_REF_ACTION,
    REFRESH_BRANCHES_ACTION,
    SHOW_DETAILS_ACTION
  );

  if (selection === REMOVE_STALE_TRACKING_REF_ACTION) {
    await handleRemoveStaleRemoteTrackingRef(item, commandContext);
    return;
  }

  if (selection === REFRESH_BRANCHES_ACTION) {
    await commandContext.refresh({ fetchRemoteState: false });
    return;
  }

  if (selection === SHOW_DETAILS_ACTION && error !== undefined) {
    showRemoteDeleteDetails(item, error);
  }
}

async function handleRemoveStaleRemoteTrackingRef(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!item.branchName || !item.repoRoot) {
    return;
  }

  if (isDeletionProtectedItem(item)) {
    showProtectedBranchDeleteMessage(item.branchName);
    return;
  }

  const trackingState = await resolveRemoteBranchTrackingState(item);
  if (trackingState !== 'stale') {
    vscode.window.showInformationMessage(
      `Remote branch '${item.branchName}' still belongs to a configured remote.`
    );
    return;
  }

  try {
    await removeRemoteTrackingRef(item.repoRoot, item.branchName);
    await commandContext.showSuccessAndRefresh(
      `Removed stale tracking ref '${item.branchName}'.`,
      { fetchRemoteState: false }
    );
  } catch (error) {
    commandContext.showCommandError(
      `Failed to remove stale tracking ref '${item.branchName}'`,
      error
    );
  }
}

async function resolveRemoteBranchTrackingState(
  item: BranchTreeItem
): Promise<RemoteBranchTrackingState> {
  if (item.branchInfo?.remoteTrackingState) {
    return item.branchInfo.remoteTrackingState;
  }

  if (!item.repoRoot || !item.branchName) {
    return 'live';
  }

  return getRemoteBranchTrackingState(item.repoRoot, item.branchName);
}

function classifyRemoteBranchDeleteFailure(
  branchName: string,
  error: unknown
): RemoteBranchDeleteFailure {
  const message = getErrorMessage(error);
  const remoteName = parseRemoteBranchName(branchName);

  if (/remote ['"][^'"]+['"] was not found\./i.test(message) || /no such remote/i.test(message)) {
    return {
      kind: 'MissingRemote',
      message,
      remoteName,
    };
  }

  if (/(^|\n)pre-push:/iu.test(message) || /hook declined/iu.test(message)) {
    return {
      kind: 'LocalPrePushHookBlocked',
      message,
      remoteName,
    };
  }

  if (
    /authentication failed/iu.test(message) ||
    /could not read username/iu.test(message) ||
    /permission denied/iu.test(message) ||
    /repository not found/iu.test(message) ||
    /could not resolve host/iu.test(message) ||
    /failed to connect/iu.test(message) ||
    /timed out/iu.test(message) ||
    /network is unreachable/iu.test(message) ||
    /ssl/i.test(message)
  ) {
    return {
      kind: 'AuthOrNetworkFailure',
      message,
      remoteName,
    };
  }

  if (
    /remote rejected/iu.test(message) ||
    /protected branch/iu.test(message) ||
    /gh006/iu.test(message) ||
    /deletion prohibited/iu.test(message) ||
    /denied/iu.test(message) ||
    (/(^|\n)remote:/iu.test(message) && /failed to push some refs/iu.test(message))
  ) {
    return {
      kind: 'RemoteRejected',
      message,
      remoteName,
    };
  }

  return {
    kind: 'Unknown',
    message,
    remoteName,
  };
}

async function showGenericRemoteDeleteFailureNotification(
  item: BranchTreeItem,
  error: unknown
): Promise<void> {
  const selection = await vscode.window.showErrorMessage(
    `Failed to delete remote branch '${item.branchName}'.`,
    SHOW_DETAILS_ACTION,
    OPEN_GIT_OUTPUT_ACTION
  );
  await handleRemoteDeleteFailureAuxiliaryAction(item, error, selection);
}

async function handleRemoteDeleteFailureAuxiliaryAction(
  item: BranchTreeItem,
  error: unknown,
  selection: string | undefined
): Promise<void> {
  if (selection === SHOW_DETAILS_ACTION) {
    showRemoteDeleteDetails(item, error);
    return;
  }

  if (selection === OPEN_GIT_OUTPUT_ACTION) {
    await openGitOutput();
  }
}

function showRemoteDeleteDetails(item: BranchTreeItem, error: unknown): void {
  vscode.window.showErrorMessage(
    `Failed to delete remote branch '${item.branchName}': ${getErrorMessage(error)}`
  );
}

async function openGitOutput(): Promise<void> {
  try {
    await vscode.commands.executeCommand('git.showOutput');
  } catch {
    // Ignore missing Git output command; the existing notification already carries the failure.
  }
}

function parseRemoteBranchName(branchName: string | undefined): string | undefined {
  if (!branchName) {
    return undefined;
  }

  const [remoteName] = branchName.split('/');
  return remoteName || undefined;
}
