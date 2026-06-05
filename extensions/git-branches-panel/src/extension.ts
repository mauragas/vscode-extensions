import * as vscode from 'vscode';

import { buildBranchDescription, type BranchInfo } from './branchModel';
import {
  checkoutBranch,
  checkoutRemoteBranch,
  checkoutTag,
  createBranch,
  deleteRemoteBranch,
  deleteBranch,
  deleteTag,
  fetchRemoteState,
  mergeBranchIntoCurrent,
  renameBranch,
  syncBranch,
} from './git';
import { BranchTreeItem, BranchTreeProvider } from './treeProvider';

const DOUBLE_CLICK_WINDOW_MS = 500;

interface BranchActivationState {
  branchName: string;
  repoRoot: string;
  activatedAt: number;
}

class BranchItemActivationTracker {
  private lastActivation?: BranchActivationState;

  shouldCheckout(item: BranchTreeItem): boolean {
    if (!item.branchName || !item.repoRoot) {
      return false;
    }

    const now = Date.now();
    const isDoubleClick =
      this.lastActivation?.branchName === item.branchName &&
      this.lastActivation.repoRoot === item.repoRoot &&
      now - this.lastActivation.activatedAt <= DOUBLE_CLICK_WINDOW_MS;

    this.lastActivation = {
      branchName: item.branchName,
      repoRoot: item.repoRoot,
      activatedAt: now,
    };

    return isDoubleClick;
  }

  reset(): void {
    this.lastActivation = undefined;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new BranchTreeProvider(context);
  const activationTracker = new BranchItemActivationTracker();

  const mainTreeView = vscode.window.createTreeView('gitBranchesPanel', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  const scmTreeView = vscode.window.createTreeView('gitBranchesSCM', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  const treeViews = [mainTreeView, scmTreeView] as const;

  updateTreeViewMessages(treeViews, provider);

  context.subscriptions.push(mainTreeView, scmTreeView);
  context.subscriptions.push(
    provider.onDidChangeTreeData(() => {
      updateTreeViewMessages(treeViews, provider);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitBranchesPanel.refresh', async () => {
      activationTracker.reset();
      await provider.refresh({ fetchRemoteState: true });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitBranchesPanel.fetchAll', async () => {
      const repoRoot = await resolveRepoRoot(provider);
      if (!repoRoot) {
        vscode.window.showErrorMessage('No git repository found in the current workspace.');
        return;
      }

      try {
        await fetchRemoteState(repoRoot);
        activationTracker.reset();
        await provider.refresh({ fetchRemoteState: false });
        vscode.window.showInformationMessage('Fetched all remotes and refreshed branch status.');
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to fetch remotes: ${getErrorMessage(error)}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitBranchesPanel.activateBranchItem',
      async (item: BranchTreeItem) => {
        if (item.nodeType !== 'branch') {
          return;
        }

        if (!activationTracker.shouldCheckout(item)) {
          return;
        }

        await checkoutBranchItem(item, provider, activationTracker);
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitBranchesPanel.checkout', async (item: BranchTreeItem) => {
      await checkoutBranchItem(item, provider, activationTracker, true);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitBranchesPanel.checkoutTag', async (item: BranchTreeItem) => {
      await checkoutTagItem(item, provider, activationTracker);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitBranchesPanel.syncCurrentBranch', async () => {
      const repoRoot = await resolveRepoRoot(provider);
      const currentBranch = await resolveCurrentBranch(provider);

      if (!repoRoot || !currentBranch) {
        vscode.window.showErrorMessage('No current git branch was found.');
        return;
      }

      await syncBranchByName(repoRoot, currentBranch.name, provider, activationTracker);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitBranchesPanel.syncBranch', async (item: BranchTreeItem) => {
      if (!item.branchName || !item.repoRoot) {
        return;
      }

      await syncBranchByName(item.repoRoot, item.branchName, provider, activationTracker);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'gitBranchesPanel.deleteBranch',
      async (item: BranchTreeItem) => {
        if (!item.branchName || !item.repoRoot) {
          return;
        }

        if (item.nodeType === 'remoteBranch') {
          const confirmation = await vscode.window.showWarningMessage(
            `Delete remote branch '${item.branchName}'?`,
            { modal: true },
            'Delete'
          );
          if (confirmation !== 'Delete') {
            return;
          }

          try {
            await deleteRemoteBranch(item.repoRoot, item.branchName);
            vscode.window.showInformationMessage(`Deleted remote branch '${item.branchName}'.`);
            activationTracker.reset();
            await provider.refresh({ fetchRemoteState: true, forceFetchRemoteState: true });
          } catch (error) {
            vscode.window.showErrorMessage(
              `Failed to delete remote branch '${item.branchName}': ${getErrorMessage(error)}`
            );
          }

          return;
        }

        const confirmation = await vscode.window.showWarningMessage(
          `Delete branch '${item.branchName}'?`,
          { modal: true },
          'Delete'
        );
        if (confirmation !== 'Delete') {
          return;
        }

        try {
          await deleteBranch(item.repoRoot, item.branchName, false);
          vscode.window.showInformationMessage(`Deleted branch '${item.branchName}'.`);
          activationTracker.reset();
          await provider.refresh();
        } catch (error) {
          const message = getErrorMessage(error);
          if (!looksLikeMergeSafetyError(message)) {
            vscode.window.showErrorMessage(`Failed to delete '${item.branchName}': ${message}`);
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
            vscode.window.showInformationMessage(`Force deleted branch '${item.branchName}'.`);
            activationTracker.reset();
            await provider.refresh();
          } catch (forceDeleteError) {
            vscode.window.showErrorMessage(
              `Failed to force delete '${item.branchName}': ${getErrorMessage(forceDeleteError)}`
            );
          }
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitBranchesPanel.newBranch', async () => {
      const repoRoot = await resolveRepoRoot(provider);
      if (!repoRoot) {
        vscode.window.showErrorMessage('No git repository found in the current workspace.');
        return;
      }

      const name = await vscode.window.showInputBox({
        prompt: 'Enter a name for the new branch',
        placeHolder: 'feature/my-feature or hotfix/bug-123',
        validateInput: (value) => validateBranchName(value),
      });
      if (!name) {
        return;
      }

      const branchName = name.trim();

      try {
        await createBranch(repoRoot, branchName);
        vscode.window.showInformationMessage(`Created and switched to '${branchName}'.`);
        activationTracker.reset();
        await provider.refresh();
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to create '${branchName}': ${getErrorMessage(error)}`
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitBranchesPanel.renameBranch', async (item: BranchTreeItem) => {
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
        vscode.window.showInformationMessage(`Renamed branch to '${branchName}'.`);
        activationTracker.reset();
        await provider.refresh();
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to rename '${item.branchName}': ${getErrorMessage(error)}`
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitBranchesPanel.copyBranchName', async (item: BranchTreeItem) => {
      if (!item.branchName) {
        return;
      }

      await vscode.env.clipboard.writeText(item.branchName);
      vscode.window.showInformationMessage(`Copied '${item.branchName}' to the clipboard.`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitBranchesPanel.copyTagName', async (item: BranchTreeItem) => {
      if (!item.branchName) {
        return;
      }

      await vscode.env.clipboard.writeText(item.branchName);
      vscode.window.showInformationMessage(`Copied tag '${item.branchName}' to the clipboard.`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitBranchesPanel.deleteTag', async (item: BranchTreeItem) => {
      if (!item.branchName || !item.repoRoot || item.nodeType !== 'tag') {
        return;
      }

      const confirmation = await vscode.window.showWarningMessage(
        `Delete tag '${item.branchName}'?`,
        { modal: true },
        'Delete'
      );
      if (confirmation !== 'Delete') {
        return;
      }

      try {
        await deleteTag(item.repoRoot, item.branchName);
        vscode.window.showInformationMessage(`Deleted tag '${item.branchName}'.`);
        activationTracker.reset();
        await provider.refresh({ fetchRemoteState: false });
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to delete tag '${item.branchName}': ${getErrorMessage(error)}`
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitBranchesPanel.mergeIntoCurrent', async (item: BranchTreeItem) => {
      if (!item.branchName || !item.repoRoot || item.nodeType === 'currentBranch') {
        return;
      }

      const currentBranch = await resolveCurrentBranch(provider);
      if (!currentBranch) {
        vscode.window.showErrorMessage('Could not determine the current branch for this repository.');
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
        vscode.window.showInformationMessage(
          `Merged '${item.branchName}' into '${currentBranch.name}'.`
        );
        activationTracker.reset();
        await provider.refresh({ fetchRemoteState: false });
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to merge '${item.branchName}' into '${currentBranch.name}': ${getErrorMessage(error)}`
        );
      }
    })
  );

  registerAutoRefresh(context, provider, activationTracker);

  void provider.refresh({ fetchRemoteState: true });
}

export function deactivate(): void {}

async function checkoutBranchItem(
  item: BranchTreeItem,
  provider: BranchTreeProvider,
  activationTracker: BranchItemActivationTracker,
  allowCurrentBranchMessage = false
): Promise<void> {
  if (!item.branchName || !item.repoRoot) {
    return;
  }

  if (item.nodeType === 'currentBranch') {
    if (allowCurrentBranchMessage) {
      vscode.window.showInformationMessage(`Already on '${item.branchName}'.`);
    }
    activationTracker.reset();
    return;
  }

  if (item.nodeType === 'remoteBranch') {
    try {
      const checkoutResult = await checkoutRemoteBranch(item.repoRoot, item.branchName);
      vscode.window.showInformationMessage(
        checkoutResult.createdLocalBranch
          ? `Created and switched to local branch '${checkoutResult.localBranchName}' tracking '${checkoutResult.remoteBranchName}'.`
          : `Switched to existing local branch '${checkoutResult.localBranchName}' for '${checkoutResult.remoteBranchName}'.`
      );
      activationTracker.reset();
      await provider.refresh({ fetchRemoteState: false });
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to checkout '${item.branchName}': ${getErrorMessage(error)}`
      );
    }

    return;
  }

  try {
    await checkoutBranch(item.repoRoot, item.branchName);
    vscode.window.showInformationMessage(`Switched to '${item.branchName}'.`);
    activationTracker.reset();
    await provider.refresh({ fetchRemoteState: false });
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to checkout '${item.branchName}': ${getErrorMessage(error)}`
    );
  }
}

async function checkoutTagItem(
  item: BranchTreeItem,
  provider: BranchTreeProvider,
  activationTracker: BranchItemActivationTracker
): Promise<void> {
  if (!item.branchName || !item.repoRoot || item.nodeType !== 'tag') {
    return;
  }

  try {
    await checkoutTag(item.repoRoot, item.branchName);
    vscode.window.showInformationMessage(
      `Checked out tag '${item.branchName}'. HEAD is now detached at that tag.`
    );
    activationTracker.reset();
    await provider.refresh({ fetchRemoteState: false });
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to checkout tag '${item.branchName}': ${getErrorMessage(error)}`
    );
  }
}

function registerAutoRefresh(
  context: vscode.ExtensionContext,
  provider: BranchTreeProvider,
  activationTracker: BranchItemActivationTracker
): void {
  const headWatcher = vscode.workspace.createFileSystemWatcher('**/.git/HEAD');
  const refsWatcher = vscode.workspace.createFileSystemWatcher('**/.git/refs/heads/**');
  const remoteRefsWatcher = vscode.workspace.createFileSystemWatcher('**/.git/refs/remotes/**');
  const tagRefsWatcher = vscode.workspace.createFileSystemWatcher('**/.git/refs/tags/**');
  const fetchHeadWatcher = vscode.workspace.createFileSystemWatcher('**/.git/FETCH_HEAD');
  const packedRefsWatcher = vscode.workspace.createFileSystemWatcher('**/.git/packed-refs');

  const refresh = (fetchRemoteState = false) => {
    activationTracker.reset();
    void provider.refresh({ fetchRemoteState });
  };

  const refreshFromWatcher = () => {
    refresh(false);
  };

  headWatcher.onDidChange(refreshFromWatcher);
  headWatcher.onDidCreate(refreshFromWatcher);
  refsWatcher.onDidChange(refreshFromWatcher);
  refsWatcher.onDidCreate(refreshFromWatcher);
  refsWatcher.onDidDelete(refreshFromWatcher);
  remoteRefsWatcher.onDidChange(refreshFromWatcher);
  remoteRefsWatcher.onDidCreate(refreshFromWatcher);
  remoteRefsWatcher.onDidDelete(refreshFromWatcher);
  tagRefsWatcher.onDidChange(refreshFromWatcher);
  tagRefsWatcher.onDidCreate(refreshFromWatcher);
  tagRefsWatcher.onDidDelete(refreshFromWatcher);
  fetchHeadWatcher.onDidChange(refreshFromWatcher);
  fetchHeadWatcher.onDidCreate(refreshFromWatcher);
  packedRefsWatcher.onDidChange(refreshFromWatcher);
  packedRefsWatcher.onDidCreate(refreshFromWatcher);
  packedRefsWatcher.onDidDelete(refreshFromWatcher);

  context.subscriptions.push(
    headWatcher,
    refsWatcher,
    remoteRefsWatcher,
    tagRefsWatcher,
    fetchHeadWatcher,
    packedRefsWatcher,
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('gitBranchesPanel')) {
        refresh();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      refresh();
    })
  );
}

async function resolveRepoRoot(provider: BranchTreeProvider): Promise<string | null> {
  const existingRepoRoot = provider.getRepoRoot();
  if (existingRepoRoot) {
    return existingRepoRoot;
  }

  await provider.refresh({ fetchRemoteState: true });
  return provider.getRepoRoot();
}

async function resolveCurrentBranch(provider: BranchTreeProvider) {
  const currentBranch = provider.getCurrentBranch();
  if (currentBranch) {
    return currentBranch;
  }

  await provider.refresh({ fetchRemoteState: true });
  return provider.getCurrentBranch();
}

async function syncBranchByName(
  repoRoot: string,
  branchName: string,
  provider: BranchTreeProvider,
  activationTracker: BranchItemActivationTracker
): Promise<void> {
  try {
    const syncResult = await syncBranch(repoRoot, branchName);
    vscode.window.showInformationMessage(buildSyncResultMessage(syncResult));
    activationTracker.reset();
    await provider.refresh({ fetchRemoteState: true, forceFetchRemoteState: true });
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to sync '${branchName}': ${getErrorMessage(error)}`
    );
  }
}

function buildSyncResultMessage(syncResult: {
  branchName: string;
  upstreamName: string;
  didPull: boolean;
  didPush: boolean;
  publishedUpstream: boolean;
}): string {
  if (!syncResult.didPull && !syncResult.didPush) {
    return `'${syncResult.branchName}' is already up to date with '${syncResult.upstreamName}'.`;
  }

  if (syncResult.didPull && syncResult.didPush) {
    return `Synced '${syncResult.branchName}' with '${syncResult.upstreamName}' (pulled and pushed).`;
  }

  if (syncResult.didPull) {
    return `Updated '${syncResult.branchName}' from '${syncResult.upstreamName}'.`;
  }

  if (syncResult.publishedUpstream) {
    return `Published '${syncResult.branchName}' to '${syncResult.upstreamName}'.`;
  }

  return `Pushed '${syncResult.branchName}' to '${syncResult.upstreamName}'.`;
}

function validateBranchName(value: string, currentName?: string): string | undefined {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return 'Branch name cannot be empty.';
  }

  if (/\s/.test(trimmedValue)) {
    return 'Branch name cannot contain spaces.';
  }

  if (trimmedValue.startsWith('-')) {
    return 'Branch name cannot start with a dash.';
  }

  if (trimmedValue.endsWith('/') || trimmedValue.includes('//')) {
    return 'Branch name cannot end with a slash or contain empty path segments.';
  }

  if (currentName && trimmedValue === currentName) {
    return 'Please enter a different branch name.';
  }

  return undefined;
}

function looksLikeMergeSafetyError(message: string): boolean {
  return /not fully merged/i.test(message);
}

function updateTreeViewMessages(
  treeViews: readonly vscode.TreeView<BranchTreeItem>[],
  provider: BranchTreeProvider
): void {
  const message = buildCurrentBranchMessage(provider.getCurrentBranch());

  for (const treeView of treeViews) {
    treeView.message = message;
  }
}

function buildCurrentBranchMessage(currentBranch: BranchInfo | undefined): string {
  if (!currentBranch) {
    return '';
  }

  const description = buildBranchDescription(currentBranch);

  return description
    ? `Current branch: ${currentBranch.name} • ${description}`
    : `Current branch: ${currentBranch.name}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error';
}
