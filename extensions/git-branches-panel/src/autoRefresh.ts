import * as vscode from 'vscode';

import { type BranchItemActivationTracker } from './extensionHelpers';
import { resetTrackerAndRefresh } from './providerRefresh';
import { BranchTreeProvider } from './treeProvider';

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
  const fetchHeadWatcher = vscode.workspace.createFileSystemWatcher('**/.git/FETCH_HEAD');
  const packedRefsWatcher = vscode.workspace.createFileSystemWatcher('**/.git/packed-refs');

  const refresh = (fetchRemoteState = false): void => {
    void resetTrackerAndRefresh(provider, activationTracker, { fetchRemoteState });
  };

  const refreshFromWatcher = (): void => {
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
  stashRefWatcher.onDidChange(refreshFromWatcher);
  stashRefWatcher.onDidCreate(refreshFromWatcher);
  stashRefWatcher.onDidDelete(refreshFromWatcher);
  stashLogWatcher.onDidChange(refreshFromWatcher);
  stashLogWatcher.onDidCreate(refreshFromWatcher);
  stashLogWatcher.onDidDelete(refreshFromWatcher);
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
    stashRefWatcher,
    stashLogWatcher,
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
