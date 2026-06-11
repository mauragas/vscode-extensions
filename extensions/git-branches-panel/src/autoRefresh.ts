import * as vscode from 'vscode';

import { type BranchItemActivationTracker } from './extensionHelpers';
import { resetTrackerAndRefresh } from './providerRefresh';
import { type BranchLoadOptions } from './treeDataLoader';
import { BranchTreeProvider } from './treeProvider';

const CHECK_INTERVAL_MS = 30_000;

export function registerAutoRefresh(
  context: vscode.ExtensionContext,
  provider: BranchTreeProvider,
  activationTracker: BranchItemActivationTracker
): void {
  const headWatcher = vscode.workspace.createFileSystemWatcher('**/.git/HEAD');
  const refsWatcher = vscode.workspace.createFileSystemWatcher('**/.git/refs/heads/**');
  const remoteRefsWatcher = vscode.workspace.createFileSystemWatcher('**/.git/refs/remotes/**');
  const tagRefsWatcher = vscode.workspace.createFileSystemWatcher('**/.git/refs/tags/**');
  const stashRefWatcher = vscode.workspace.createFileSystemWatcher('**/.git/refs/stash');
  const stashLogWatcher = vscode.workspace.createFileSystemWatcher('**/.git/logs/refs/stash');
  const worktreesWatcher = vscode.workspace.createFileSystemWatcher('**/.git/worktrees/**');
  const gitConfigWatcher = vscode.workspace.createFileSystemWatcher('**/.git/config');
  const localHooksWatcher = vscode.workspace.createFileSystemWatcher('**/.git/hooks/**');
  const fetchHeadWatcher = vscode.workspace.createFileSystemWatcher('**/.git/FETCH_HEAD');
  const packedRefsWatcher = vscode.workspace.createFileSystemWatcher('**/.git/packed-refs');
  const indexWatcher = vscode.workspace.createFileSystemWatcher('**/.git/index');

  let lastRefreshTime = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const refresh = (options?: BranchLoadOptions): void => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      lastRefreshTime = Date.now();
      void resetTrackerAndRefresh(provider, activationTracker, options);
    }, 200);
  };

  const periodicRefresh = async (): Promise<void> => {
    const now = Date.now();
    if (now - lastRefreshTime < CHECK_INTERVAL_MS) {
      return;
    }

    lastRefreshTime = now;
    await resetTrackerAndRefresh(provider, activationTracker);
  };

  const periodicTimer = setInterval(() => {
    void periodicRefresh();
  }, CHECK_INTERVAL_MS);

  context.subscriptions.push(
    headWatcher,
    refsWatcher,
    remoteRefsWatcher,
    tagRefsWatcher,
    stashRefWatcher,
    stashLogWatcher,
    worktreesWatcher,
    gitConfigWatcher,
    localHooksWatcher,
    fetchHeadWatcher,
    packedRefsWatcher,
    indexWatcher,
    new vscode.Disposable(() => clearInterval(periodicTimer)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('gitBranchesPanel')) {
        void resetTrackerAndRefresh(provider, activationTracker);
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void resetTrackerAndRefresh(provider, activationTracker);
    })
  );

  const refreshLocal = () => refresh({ sections: ['local'] });
  const refreshLocalRemote = () => refresh({ sections: ['local', 'remote'] });
  const refreshTags = () => refresh({ sections: ['tags'] });
  const refreshStash = () => refresh({ sections: ['stash'] });
  const refreshWorktree = () => refresh({ sections: ['worktree'] });
  const refreshHooks = () => refresh({ sections: ['hooks'] });

  headWatcher.onDidChange(refreshLocal);
  headWatcher.onDidCreate(refreshLocal);
  refsWatcher.onDidChange(refreshLocal);
  refsWatcher.onDidCreate(refreshLocal);
  refsWatcher.onDidDelete(refreshLocal);
  remoteRefsWatcher.onDidChange(refreshLocalRemote);
  remoteRefsWatcher.onDidCreate(refreshLocalRemote);
  remoteRefsWatcher.onDidDelete(refreshLocalRemote);
  tagRefsWatcher.onDidChange(refreshTags);
  tagRefsWatcher.onDidCreate(refreshTags);
  tagRefsWatcher.onDidDelete(refreshTags);
  stashRefWatcher.onDidChange(refreshStash);
  stashRefWatcher.onDidCreate(refreshStash);
  stashRefWatcher.onDidDelete(refreshStash);
  stashLogWatcher.onDidChange(refreshStash);
  stashLogWatcher.onDidCreate(refreshStash);
  stashLogWatcher.onDidDelete(refreshStash);
  worktreesWatcher.onDidChange(refreshWorktree);
  worktreesWatcher.onDidCreate(refreshWorktree);
  worktreesWatcher.onDidDelete(refreshWorktree);
  gitConfigWatcher.onDidChange(refreshHooks);
  gitConfigWatcher.onDidCreate(refreshHooks);
  gitConfigWatcher.onDidDelete(refreshHooks);
  localHooksWatcher.onDidChange(refreshHooks);
  localHooksWatcher.onDidCreate(refreshHooks);
  localHooksWatcher.onDidDelete(refreshHooks);
  fetchHeadWatcher.onDidChange(refreshLocalRemote);
  fetchHeadWatcher.onDidCreate(refreshLocalRemote);
  packedRefsWatcher.onDidChange(refreshLocalRemote);
  packedRefsWatcher.onDidCreate(refreshLocalRemote);
  packedRefsWatcher.onDidDelete(refreshLocalRemote);
  indexWatcher.onDidChange(refreshLocal);
  indexWatcher.onDidCreate(refreshLocal);
  indexWatcher.onDidDelete(refreshLocal);
}
