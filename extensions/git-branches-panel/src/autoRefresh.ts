import * as vscode from 'vscode';

import { type BranchItemActivationTracker } from './extensionHelpers';
import { resetTrackerAndRefresh } from './providerRefresh';
import { type BranchSectionKey } from './treeDataLoader';
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
  const worktreesWatcher = vscode.workspace.createFileSystemWatcher('**/.git/worktrees/**');
  const fetchHeadWatcher = vscode.workspace.createFileSystemWatcher('**/.git/FETCH_HEAD');
  const packedRefsWatcher = vscode.workspace.createFileSystemWatcher('**/.git/packed-refs');

  const refresh = (
    sections?: readonly BranchSectionKey[],
    fetchRemoteState = false,
    onlyIfLoaded = false
  ): void => {
    void resetTrackerAndRefresh(provider, activationTracker, {
      sections,
      fetchRemoteState,
      onlyIfLoaded,
    });
  };

  const refreshLoadedSections = (sections: readonly BranchSectionKey[]): void => {
    refresh(sections, false, true);
  };

  headWatcher.onDidChange(() => {
    refreshLoadedSections(['local']);
  });
  headWatcher.onDidCreate(() => {
    refreshLoadedSections(['local']);
  });
  refsWatcher.onDidChange(() => {
    refreshLoadedSections(['local']);
  });
  refsWatcher.onDidCreate(() => {
    refreshLoadedSections(['local']);
  });
  refsWatcher.onDidDelete(() => {
    refreshLoadedSections(['local']);
  });
  remoteRefsWatcher.onDidChange(() => {
    refreshLoadedSections(['local', 'remote']);
  });
  remoteRefsWatcher.onDidCreate(() => {
    refreshLoadedSections(['local', 'remote']);
  });
  remoteRefsWatcher.onDidDelete(() => {
    refreshLoadedSections(['local', 'remote']);
  });
  tagRefsWatcher.onDidChange(() => {
    refreshLoadedSections(['tags']);
  });
  tagRefsWatcher.onDidCreate(() => {
    refreshLoadedSections(['tags']);
  });
  tagRefsWatcher.onDidDelete(() => {
    refreshLoadedSections(['tags']);
  });
  stashRefWatcher.onDidChange(() => {
    refreshLoadedSections(['stash']);
  });
  stashRefWatcher.onDidCreate(() => {
    refreshLoadedSections(['stash']);
  });
  stashRefWatcher.onDidDelete(() => {
    refreshLoadedSections(['stash']);
  });
  stashLogWatcher.onDidChange(() => {
    refreshLoadedSections(['stash']);
  });
  stashLogWatcher.onDidCreate(() => {
    refreshLoadedSections(['stash']);
  });
  stashLogWatcher.onDidDelete(() => {
    refreshLoadedSections(['stash']);
  });
  worktreesWatcher.onDidChange(() => {
    refreshLoadedSections(['worktree']);
  });
  worktreesWatcher.onDidCreate(() => {
    refreshLoadedSections(['worktree']);
  });
  worktreesWatcher.onDidDelete(() => {
    refreshLoadedSections(['worktree']);
  });
  fetchHeadWatcher.onDidChange(() => {
    refreshLoadedSections(['local', 'remote']);
  });
  fetchHeadWatcher.onDidCreate(() => {
    refreshLoadedSections(['local', 'remote']);
  });
  packedRefsWatcher.onDidChange(() => {
    refreshLoadedSections(['local', 'remote', 'tags']);
  });
  packedRefsWatcher.onDidCreate(() => {
    refreshLoadedSections(['local', 'remote', 'tags']);
  });
  packedRefsWatcher.onDidDelete(() => {
    refreshLoadedSections(['local', 'remote', 'tags']);
  });

  context.subscriptions.push(
    headWatcher,
    refsWatcher,
    remoteRefsWatcher,
    tagRefsWatcher,
    stashRefWatcher,
    stashLogWatcher,
    worktreesWatcher,
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
