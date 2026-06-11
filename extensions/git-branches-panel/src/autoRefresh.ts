import * as vscode from 'vscode';

import { type BranchItemActivationTracker } from './extensionHelpers';
import { resetTrackerAndRefresh } from './providerRefresh';
import { type BranchLoadOptions, type BranchSectionKey } from './treeDataLoader';
import { BranchTreeProvider } from './treeProvider';

const DEBOUNCE_DELAY_MS = 500;

export function registerAutoRefresh(
  context: vscode.ExtensionContext,
  provider: BranchTreeProvider,
  activationTracker: BranchItemActivationTracker
): void {
  let pendingRefresh: vscode.CancellationTokenSource | undefined;
  let pendingDisposeTimer: ReturnType<typeof setTimeout> | undefined;

  const refresh = (options?: BranchLoadOptions): void => {
    if (pendingRefresh) {
      pendingRefresh.cancel();
      if (pendingDisposeTimer) {
        clearTimeout(pendingDisposeTimer);
        pendingDisposeTimer = undefined;
      }
      pendingRefresh = undefined;
    }

    pendingRefresh = new vscode.CancellationTokenSource();
    const token = pendingRefresh.token;

    pendingDisposeTimer = setTimeout(() => {
      pendingRefresh = undefined;
      pendingDisposeTimer = undefined;
      if (!token.isCancellationRequested) {
        void resetTrackerAndRefresh(provider, activationTracker, options);
      }
    }, DEBOUNCE_DELAY_MS);
  };

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
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('gitBranchesPanel')) {
        refresh();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      refresh();
    })
  );

  headWatcher.onDidChange(() => refresh({ sections: ['local'], fetchRemoteState: false, onlyIfLoaded: true }));
  headWatcher.onDidCreate(() => refresh({ sections: ['local'], fetchRemoteState: false, onlyIfLoaded: true }));
  refsWatcher.onDidChange(() => refresh({ sections: ['local'], fetchRemoteState: false, onlyIfLoaded: true }));
  refsWatcher.onDidCreate(() => refresh({ sections: ['local'], fetchRemoteState: false, onlyIfLoaded: true }));
  refsWatcher.onDidDelete(() => refresh({ sections: ['local'], fetchRemoteState: false, onlyIfLoaded: true }));
  remoteRefsWatcher.onDidChange(() => refresh({ sections: ['local', 'remote'], fetchRemoteState: false, onlyIfLoaded: true }));
  remoteRefsWatcher.onDidCreate(() => refresh({ sections: ['local', 'remote'], fetchRemoteState: false, onlyIfLoaded: true }));
  remoteRefsWatcher.onDidDelete(() => refresh({ sections: ['local', 'remote'], fetchRemoteState: false, onlyIfLoaded: true }));
  tagRefsWatcher.onDidChange(() => refresh({ sections: ['tags'], fetchRemoteState: false, onlyIfLoaded: true }));
  tagRefsWatcher.onDidCreate(() => refresh({ sections: ['tags'], fetchRemoteState: false, onlyIfLoaded: true }));
  tagRefsWatcher.onDidDelete(() => refresh({ sections: ['tags'], fetchRemoteState: false, onlyIfLoaded: true }));
  stashRefWatcher.onDidChange(() => refresh({ sections: ['stash'], fetchRemoteState: false, onlyIfLoaded: true }));
  stashRefWatcher.onDidCreate(() => refresh({ sections: ['stash'], fetchRemoteState: false, onlyIfLoaded: true }));
  stashRefWatcher.onDidDelete(() => refresh({ sections: ['stash'], fetchRemoteState: false, onlyIfLoaded: true }));
  stashLogWatcher.onDidChange(() => refresh({ sections: ['stash'], fetchRemoteState: false, onlyIfLoaded: true }));
  stashLogWatcher.onDidCreate(() => refresh({ sections: ['stash'], fetchRemoteState: false, onlyIfLoaded: true }));
  stashLogWatcher.onDidDelete(() => refresh({ sections: ['stash'], fetchRemoteState: false, onlyIfLoaded: true }));
  worktreesWatcher.onDidChange(() => refresh({ sections: ['worktree'], fetchRemoteState: false, onlyIfLoaded: true }));
  worktreesWatcher.onDidCreate(() => refresh({ sections: ['worktree'], fetchRemoteState: false, onlyIfLoaded: true }));
  worktreesWatcher.onDidDelete(() => refresh({ sections: ['worktree'], fetchRemoteState: false, onlyIfLoaded: true }));
  gitConfigWatcher.onDidChange(() => refresh({ sections: ['hooks'], fetchRemoteState: false, onlyIfLoaded: true }));
  gitConfigWatcher.onDidCreate(() => refresh({ sections: ['hooks'], fetchRemoteState: false, onlyIfLoaded: true }));
  gitConfigWatcher.onDidDelete(() => refresh({ sections: ['hooks'], fetchRemoteState: false, onlyIfLoaded: true }));
  localHooksWatcher.onDidChange(() => refresh({ sections: ['hooks'], fetchRemoteState: false, onlyIfLoaded: true }));
  localHooksWatcher.onDidCreate(() => refresh({ sections: ['hooks'], fetchRemoteState: false, onlyIfLoaded: true }));
  localHooksWatcher.onDidDelete(() => refresh({ sections: ['hooks'], fetchRemoteState: false, onlyIfLoaded: true }));
  fetchHeadWatcher.onDidChange(() => refresh({ sections: ['local', 'remote'], fetchRemoteState: false, onlyIfLoaded: true }));
  fetchHeadWatcher.onDidCreate(() => refresh({ sections: ['local', 'remote'], fetchRemoteState: false, onlyIfLoaded: true }));
  packedRefsWatcher.onDidChange(() => refresh({ sections: ['local', 'remote', 'tags'], fetchRemoteState: false, onlyIfLoaded: true }));
  packedRefsWatcher.onDidCreate(() => refresh({ sections: ['local', 'remote', 'tags'], fetchRemoteState: false, onlyIfLoaded: true }));
  packedRefsWatcher.onDidDelete(() => refresh({ sections: ['local', 'remote', 'tags'], fetchRemoteState: false, onlyIfLoaded: true }));
  indexWatcher.onDidChange(() => refresh({ sections: ['local'], fetchRemoteState: false, onlyIfLoaded: true }));
  indexWatcher.onDidCreate(() => refresh({ sections: ['local'], fetchRemoteState: false, onlyIfLoaded: true }));
  indexWatcher.onDidDelete(() => refresh({ sections: ['local'], fetchRemoteState: false, onlyIfLoaded: true }));
}
