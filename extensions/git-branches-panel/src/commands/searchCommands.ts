import * as vscode from 'vscode';

import { BranchTreeItem } from '../treeProvider';
import {
  findMatchingRefs,
  type SearchCandidate,
} from '../search/refSearch';
import type { BranchSectionKey } from '../treeDataLoader';
import { getVisibleSectionKeys } from '../sectionVisibility';
import { getAdvancedBranchActionDefinitions } from './advancedBranchCommands';
import type { CommandContext } from './shared';

const SEARCHABLE_SECTIONS: readonly BranchSectionKey[] = [
  'local',
  'remote',
  'stash',
  'worktree',
  'hooks',
  'tags',
] as const;
const FIND_REF_PLACEHOLDER =
  'feature/auth, local:feature, remote:origin/main, stash:bugfix, state:stale';

interface SearchResultQuickPickItem extends vscode.QuickPickItem {
  readonly candidate: SearchCandidate;
}

interface SearchActionQuickPickItem extends vscode.QuickPickItem {
  run(): Promise<void>;
}

interface SearchConfiguration {
  includeHooks: boolean;
  maxResults: number;
  autoLoadAllSections: boolean;
}

export function registerSearchCommands(
  context: vscode.ExtensionContext,
  commandContext: CommandContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('gitBranchesPanel.findRef', async () => {
      await handleFindRef(commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.setFilter', async () => {
      await handleSetFilter(commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.clearFilter', async () => {
      await commandContext.provider.clearFilter();
    }),
    vscode.commands.registerCommand('gitBranchesPanel.toggleShowOnlyPinned', async () => {
      await handleToggleShowOnlyPinned(commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.showNeedsAttention', async () => {
      await handleShowNeedsAttention(commandContext);
    })
  );
}

async function handleFindRef(commandContext: CommandContext): Promise<void> {
  const searchConfiguration = getSearchConfiguration();
  const searchableSections = getSearchableSections(searchConfiguration.includeHooks);

  if (searchConfiguration.autoLoadAllSections) {
    await commandContext.refresh({
      sections: searchableSections,
      repoRoots: commandContext.provider.getRepositoryDescriptors().map((repository) => repository.repoRoot),
      fetchRemoteState: false,
    });
  }

  const query = await vscode.window.showInputBox({
    prompt: 'Find a branch, tag, stash, worktree, or hook',
    placeHolder: FIND_REF_PLACEHOLDER,
  });
  if (query === undefined) {
    return;
  }

  const candidates = findMatchingRefs(commandContext.provider.getSearchTreeData(), query, {
    includeHooks: searchConfiguration.includeHooks,
    maxResults: searchConfiguration.maxResults,
  });
  if (candidates.length === 0) {
    vscode.window.showInformationMessage(
      query.trim()
        ? `No refs matched '${query.trim()}'.`
        : 'No searchable refs are currently available.'
    );
    return;
  }

  const selection = await vscode.window.showQuickPick<SearchResultQuickPickItem>(
    candidates.map((candidate) => ({
      label: candidate.node.fullName,
      description: candidate.description,
      detail: candidate.detail,
      candidate,
    })),
    {
      placeHolder: 'Choose a ref',
      matchOnDescription: true,
      matchOnDetail: true,
    }
  );
  if (!selection) {
    return;
  }

  const item = new BranchTreeItem(selection.candidate.node);
  await commandContext.provider.setActiveRepositoryFromItem(item);

  const action = await vscode.window.showQuickPick<SearchActionQuickPickItem>(
    buildSearchActionItems(item, commandContext),
    {
      placeHolder: `Choose an action for '${selection.candidate.node.fullName}'`,
    }
  );

  if (!action) {
    return;
  }

  await action.run();
}

async function handleSetFilter(commandContext: CommandContext): Promise<void> {
  const searchConfiguration = getSearchConfiguration();
  const searchableSections = getSearchableSections(true);

  if (searchConfiguration.autoLoadAllSections) {
    await commandContext.refresh({
      sections: searchableSections,
      repoRoots: commandContext.provider.getVisibleRepoRoots(),
      fetchRemoteState: false,
    });
  }

  const query = await vscode.window.showInputBox({
    prompt: 'Filter the visible tree',
    placeHolder: FIND_REF_PLACEHOLDER,
    value: commandContext.provider.getFilterQuery(),
  });
  if (query === undefined) {
    return;
  }

  await commandContext.provider.setFilterQuery(query);
}

async function handleToggleShowOnlyPinned(commandContext: CommandContext): Promise<void> {
  const pinnedOnly = await commandContext.provider.toggleShowOnlyPinned();
  vscode.window.showInformationMessage(
    pinnedOnly ? 'Showing only pinned refs.' : 'Showing pinned and unpinned refs.'
  );
}

async function handleShowNeedsAttention(commandContext: CommandContext): Promise<void> {
  const searchConfiguration = getSearchConfiguration();
  const searchableSections = getSearchableSections(true);

  if (searchConfiguration.autoLoadAllSections) {
    await commandContext.refresh({
      sections: searchableSections,
      repoRoots: commandContext.provider.getVisibleRepoRoots(),
      fetchRemoteState: false,
    });
  }

  await commandContext.provider.showNeedsAttention();
}

function buildSearchActionItems(
  item: BranchTreeItem,
  commandContext: CommandContext
): SearchActionQuickPickItem[] {
  const actionItems: SearchActionQuickPickItem[] = [
    createSearchActionItem('$(list-tree) Reveal in Tree', async () => {
      await commandContext.provider.revealItem(item, { clearFilter: true });
    }),
  ];

  if (item.nodeType === 'branch' || item.nodeType === 'currentBranch' || item.nodeType === 'missingUpstreamBranch') {
    if (item.nodeType !== 'currentBranch' && !item.branchInfo?.isCurrent) {
      actionItems.push(
        createSearchActionItem('$(arrow-right) Checkout Branch', async () => {
          await vscode.commands.executeCommand('gitBranchesPanel.checkout', item);
        })
      );
    }

    actionItems.push(
      createSearchActionItem('$(new-folder) Create Worktree...', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.createWorktreeFromRef', item);
      })
    );

    actionItems.push(
      createSearchActionItem('$(history) Show Branch Commits', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.showBranchCommits', item);
      }),
      createSearchActionItem('$(diff-multiple) Open Changed Files for Ref', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.openChangedFilesForRef', item);
      })
    );

    if (item.branchInfo?.upstreamName && !item.branchInfo.upstreamMissing) {
      actionItems.push(
        createSearchActionItem('$(diff-multiple) Compare with Upstream', async () => {
          await vscode.commands.executeCommand('gitBranchesPanel.compareWithUpstream', item);
        })
      );
    }

    if (item.nodeType !== 'currentBranch' && !item.branchInfo?.isCurrent) {
      actionItems.push(
        createSearchActionItem('$(diff-multiple) Compare with Current Branch', async () => {
          await vscode.commands.executeCommand('gitBranchesPanel.compareBranchWithCurrent', item);
        })
      );
    }
  }

  if (item.nodeType === 'remoteBranch') {
    actionItems.push(
      createSearchActionItem('$(arrow-right) Checkout Branch', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.checkout', item);
      }),
      createSearchActionItem('$(new-folder) Create Worktree...', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.createWorktreeFromRef', item);
      }),
      createSearchActionItem('$(diff-multiple) Compare with Current Branch', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.compareBranchWithCurrent', item);
      }),
      createSearchActionItem('$(history) Show Branch Commits', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.showBranchCommits', item);
      }),
      createSearchActionItem('$(diff-multiple) Open Changed Files for Ref', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.openChangedFilesForRef', item);
      })
    );
  }

  if (item.nodeType === 'staleRemoteBranch') {
    actionItems.push(
      createSearchActionItem('$(new-folder) Create Worktree...', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.createWorktreeFromRef', item);
      }),
      createSearchActionItem('$(diff-multiple) Compare with Current Branch', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.compareBranchWithCurrent', item);
      }),
      createSearchActionItem('$(history) Show Branch Commits', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.showBranchCommits', item);
      }),
      createSearchActionItem('$(trash) Remove Stale Tracking Ref', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.removeStaleRemoteTrackingRef', item);
      })
    );
  }

  for (const advancedAction of getAdvancedBranchActionDefinitions(item)) {
    actionItems.push(
      createSearchActionItem(advancedAction.label, async () => {
        await vscode.commands.executeCommand(advancedAction.commandId, item);
      })
    );
  }

  if (item.nodeType === 'tag') {
    actionItems.push(
      createSearchActionItem('$(arrow-right) Checkout Tag', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.checkoutTag', item);
      }),
      createSearchActionItem('$(cloud-upload) Push Tag', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.pushTag', item);
      }),
      createSearchActionItem('$(new-folder) Create Worktree...', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.createWorktreeFromRef', item);
      }),
      createSearchActionItem('$(diff-multiple) Compare Tag with Current Branch', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.compareTagWithCurrent', item);
      }),
      createSearchActionItem('$(history) Show Ref History', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.showRefHistory', item);
      }),
      createSearchActionItem('$(diff-multiple) Open Changed Files for Ref', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.openChangedFilesForRef', item);
      }),
      createSearchActionItem('$(note) Show Tag Details', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.showTagDetails', item);
      }),
      createSearchActionItem('$(copy) Copy Tag Target SHA', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.copyTagTargetSha', item);
      })
    );
  }

  if (item.nodeType === 'stash') {
    actionItems.push(
      createSearchActionItem('$(arrow-down) Apply Stash', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.applyStash', item);
      }),
      createSearchActionItem('$(arrow-up) Pop Stash', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.popStash', item);
      }),
      createSearchActionItem('$(diff-multiple) Compare with Current Branch', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.compareStashWithCurrent', item);
      })
    );
  }

  if (item.nodeType === 'worktree') {
    actionItems.push(
      createSearchActionItem('$(folder-opened) Open Worktree', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.openWorktree', item);
      }),
      createSearchActionItem('$(empty-window) Open Worktree in New Window', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.openWorktreeInNewWindow', item);
      }),
      createSearchActionItem('$(terminal) Open Worktree in Terminal', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.openWorktreeInTerminal', item);
      }),
      createSearchActionItem('$(copy) Copy Worktree Ref', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.copyWorktreeRef', item);
      })
    );

    if (item.branchInfo?.worktreePrunableReason) {
      actionItems.push(
        createSearchActionItem('$(clear-all) Prune Worktree Metadata', async () => {
          await vscode.commands.executeCommand('gitBranchesPanel.pruneWorktrees', item);
        })
      );
    } else if (item.branchInfo?.worktreeLockedReason) {
      actionItems.push(
        createSearchActionItem('$(unlock) Unlock Worktree', async () => {
          await vscode.commands.executeCommand('gitBranchesPanel.unlockWorktree', item);
        })
      );
    } else if (!item.branchInfo?.isCurrent) {
      actionItems.push(
        createSearchActionItem('$(lock) Lock Worktree', async () => {
          await vscode.commands.executeCommand('gitBranchesPanel.lockWorktree', item);
        })
      );
    }
  }

  if (item.nodeType === 'hook') {
    actionItems.push(
      createSearchActionItem('$(edit) Edit Hook', async () => {
        await vscode.commands.executeCommand('gitBranchesPanel.editHook', item);
      })
    );

    if (item.branchInfo?.hookEnabled) {
      actionItems.push(
        createSearchActionItem('$(close) Disable Hook', async () => {
          await vscode.commands.executeCommand('gitBranchesPanel.disableHook', item);
        })
      );
    } else {
      actionItems.push(
        createSearchActionItem('$(play) Enable Hook', async () => {
          await vscode.commands.executeCommand('gitBranchesPanel.enableHook', item);
        })
      );
    }
  }

  if (isPinnableSearchItem(item)) {
    actionItems.push(
      createSearchActionItem(
        item.branchInfo?.isPinned ? '$(pinned) Unpin' : '$(pin) Pin',
        async () => {
          await vscode.commands.executeCommand(
            item.branchInfo?.isPinned ? 'gitBranchesPanel.unpinItem' : 'gitBranchesPanel.pinItem',
            item
          );
        }
      )
    );
  }

  if (item.branchName) {
    actionItems.push(
      createSearchActionItem('$(copy) Copy Name / Path', async () => {
        if (!item.branchName) {
          return;
        }

        const value = item.branchName;
        await vscode.env.clipboard.writeText(value);
        vscode.window.showInformationMessage(`Copied '${value}' to the clipboard.`);
      })
    );
  }

  return actionItems;
}

function createSearchActionItem(
  label: string,
  run: () => Promise<void>
): SearchActionQuickPickItem {
  return {
    label,
    run,
  };
}

function isPinnableSearchItem(item: BranchTreeItem): boolean {
  return Boolean(
    item.branchInfo &&
      (item.nodeType === 'branch' ||
        item.nodeType === 'currentBranch' ||
        item.nodeType === 'missingUpstreamBranch' ||
        item.nodeType === 'remoteBranch' ||
        item.nodeType === 'staleRemoteBranch' ||
        item.nodeType === 'stash' ||
        item.nodeType === 'worktree')
  );
}

function getSearchConfiguration(): SearchConfiguration {
  const configuration = vscode.workspace.getConfiguration('gitBranchesPanel');

  return {
    includeHooks: configuration.get<boolean>('search.includeHooks', false),
    maxResults: configuration.get<number>('search.maxResults', 200),
    autoLoadAllSections: configuration.get<boolean>('search.autoLoadAllSections', true),
  };
}

function getSearchableSections(includeHooks: boolean): BranchSectionKey[] {
  const visibleSections = new Set(getVisibleSectionKeys());

  return SEARCHABLE_SECTIONS.filter((section) => {
    if (!visibleSections.has(section)) {
      return false;
    }

    if (section === 'hooks') {
      return includeHooks;
    }

    return true;
  });
}
