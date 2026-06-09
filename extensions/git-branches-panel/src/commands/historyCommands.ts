import * as vscode from 'vscode';
import { join } from 'node:path';

import {
  getChangedFilesForCommit,
  getDiffFilesBetweenRefs,
  getRefHistory,
  type RefComparisonChange,
  type RefHistoryEntry,
} from '../git';
import { findMatchingRefs, type SearchCandidate } from '../search/refSearch';
import { BranchTreeItem } from '../treeProvider';
import { getGitApi, NO_CURRENT_BRANCH_MESSAGE, type CommandContext } from './shared';
import type { BranchInfo } from '../branchModel';

const HISTORY_MAX_COMMITS_SETTING = 'history.maxCommits';
const HISTORY_INCLUDE_MERGES_SETTING = 'history.includeMerges';

type HistoryNodeType =
  | 'branch'
  | 'currentBranch'
  | 'missingUpstreamBranch'
  | 'remoteBranch'
  | 'staleRemoteBranch'
  | 'tag';

interface RefQuickPickItem extends vscode.QuickPickItem {
  candidate: SearchCandidate;
}

interface CommitQuickPickItem extends vscode.QuickPickItem {
  commit: RefHistoryEntry;
}

interface CommitActionQuickPickItem extends vscode.QuickPickItem {
  run(): Promise<void>;
}

interface GitExtensionApi {
  getRepository(uri: vscode.Uri): { rootUri: vscode.Uri } | null;
  toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
}

interface ResolvedHistoryRef {
  label: string;
  refName: string;
  repoRoot: string;
}

export function registerHistoryCommands(
  context: vscode.ExtensionContext,
  commandContext: CommandContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('gitBranchesPanel.compareWithUpstream', async (item?: BranchTreeItem) => {
      await handleCompareWithUpstream(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.compareTwoRefs', async () => {
      await handleCompareTwoRefs(commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.showBranchCommits', async (item?: BranchTreeItem) => {
      await handleShowBranchCommits(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.showRefHistory', async (item?: BranchTreeItem) => {
      await handleShowRefHistory(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.openChangedFilesForRef', async (item?: BranchTreeItem) => {
      await handleOpenChangedFilesForRef(item, commandContext);
    })
  );
}

async function handleCompareWithUpstream(
  item: BranchTreeItem | undefined,
  commandContext: CommandContext
): Promise<void> {
  const resolved = await resolveUpstreamComparisonTarget(item, commandContext);
  if (!resolved) {
    return;
  }

  await openRefComparison({
    repoRoot: resolved.repoRoot,
    leftRef: resolved.upstreamName,
    rightRef: resolved.branchName,
    title: `Compare '${resolved.branchName}' with upstream '${resolved.upstreamName}'`,
    noChangesMessage: `No differences found between '${resolved.branchName}' and upstream '${resolved.upstreamName}'.`,
    commandContext,
    errorPrefix: `Failed to compare '${resolved.branchName}' with upstream '${resolved.upstreamName}'`,
  });
}

async function handleCompareTwoRefs(commandContext: CommandContext): Promise<void> {
  const repoRoot = await commandContext.requireRepoRoot();
  if (!repoRoot) {
    return;
  }

  await commandContext.refresh({
    sections: ['local', 'remote', 'stash', 'tags'],
    repoRoots: [repoRoot],
    fetchRemoteState: false,
  });

  const leftRef = await promptForComparableRef(commandContext, repoRoot, 'Select the first ref to compare');
  if (!leftRef) {
    return;
  }

  const rightRef = await promptForComparableRef(
    commandContext,
    repoRoot,
    `Select the ref to compare against '${leftRef.label}'`,
    leftRef.label
  );
  if (!rightRef) {
    return;
  }

  await openRefComparison({
    repoRoot,
    leftRef: leftRef.refName,
    rightRef: rightRef.refName,
    title: `Compare '${rightRef.label}' with '${leftRef.label}'`,
    noChangesMessage: `No differences found between '${leftRef.label}' and '${rightRef.label}'.`,
    commandContext,
    errorPrefix: `Failed to compare '${leftRef.label}' with '${rightRef.label}'`,
  });
}

async function handleShowBranchCommits(
  item: BranchTreeItem | undefined,
  commandContext: CommandContext
): Promise<void> {
  if (item && !isBranchHistoryItem(item)) {
    return;
  }

  await showHistoryForRef(item, commandContext, {
    prompt: item?.branchName ? `Choose a commit from '${item.branchName}'` : 'Choose a branch to inspect',
    allowPromptSelection: !item,
    defaultNodeTypes: ['branch', 'currentBranch', 'missingUpstreamBranch', 'remoteBranch', 'staleRemoteBranch'],
  });
}

async function handleShowRefHistory(
  item: BranchTreeItem | undefined,
  commandContext: CommandContext
): Promise<void> {
  if (item && !isHistoryRefItem(item)) {
    return;
  }

  await showHistoryForRef(item, commandContext, {
    prompt: item?.branchName ? `Choose a commit from '${item.branchName}'` : 'Choose a ref to inspect',
    allowPromptSelection: !item,
    defaultNodeTypes: ['branch', 'currentBranch', 'missingUpstreamBranch', 'remoteBranch', 'staleRemoteBranch', 'tag'],
  });
}

async function handleOpenChangedFilesForRef(
  item: BranchTreeItem | undefined,
  commandContext: CommandContext
): Promise<void> {
  if (item && !isHistoryRefItem(item)) {
    return;
  }

  const resolvedRef = item
    ? resolveHistoryRef(item)
    : await promptForHistoryRef(commandContext, {
        prompt: 'Choose a ref to open changed files for',
        nodeTypes: ['branch', 'currentBranch', 'missingUpstreamBranch', 'remoteBranch', 'staleRemoteBranch', 'tag'],
      });
  if (!resolvedRef) {
    return;
  }

  const latestCommit = (await getRefHistory(resolvedRef.repoRoot, resolvedRef.refName, {
    limit: 1,
    includeMerges: shouldIncludeMergesInHistory(),
  }))[0];
  if (!latestCommit) {
    vscode.window.showInformationMessage(`No commits were found for '${resolvedRef.label}'.`);
    return;
  }

  await openChangedFilesForCommit({
    repoRoot: resolvedRef.repoRoot,
    refLabel: resolvedRef.label,
    commit: latestCommit,
    commandContext,
  });
}

async function showHistoryForRef(
  item: BranchTreeItem | undefined,
  commandContext: CommandContext,
  options: {
    prompt: string;
    allowPromptSelection: boolean;
    defaultNodeTypes: readonly HistoryNodeType[];
  }
): Promise<void> {
  const resolvedRef = item
    ? resolveHistoryRef(item)
    : options.allowPromptSelection
      ? await promptForHistoryRef(commandContext, {
          prompt: options.prompt,
          nodeTypes: options.defaultNodeTypes,
        })
      : undefined;

  if (!resolvedRef) {
    return;
  }

  try {
    const commits = await getRefHistory(resolvedRef.repoRoot, resolvedRef.refName, {
      limit: getHistoryMaxCommits(),
      includeMerges: shouldIncludeMergesInHistory(),
    });

    if (commits.length === 0) {
      vscode.window.showInformationMessage(`No commits were found for '${resolvedRef.label}'.`);
      return;
    }

    const selectedCommit = await vscode.window.showQuickPick<CommitQuickPickItem>(
      commits.map((commit) => ({
        label: commit.subject || commit.shortSha,
        description: `${commit.shortSha} • ${commit.authorName} • ${commit.authorRelativeDate}`,
        detail: resolvedRef.label,
        commit,
      })),
      {
        placeHolder: `Choose a commit from '${resolvedRef.label}'`,
        matchOnDescription: true,
        matchOnDetail: true,
      }
    );

    if (!selectedCommit) {
      return;
    }

    const action = await vscode.window.showQuickPick<CommitActionQuickPickItem>(
      buildCommitActionItems(selectedCommit.commit, resolvedRef, commandContext),
      {
        placeHolder: `Choose an action for commit ${selectedCommit.commit.shortSha}`,
      }
    );

    if (!action) {
      return;
    }

    await action.run();
  } catch (error) {
    commandContext.showCommandError(`Failed to load history for '${resolvedRef.label}'`, error);
  }
}

function buildCommitActionItems(
  commit: RefHistoryEntry,
  resolvedRef: ResolvedHistoryRef,
  commandContext: CommandContext
): CommitActionQuickPickItem[] {
  const actionItems: CommitActionQuickPickItem[] = [
    createCommitActionItem('$(diff-multiple) Open Changed Files', async () => {
      await openChangedFilesForCommit({
        repoRoot: resolvedRef.repoRoot,
        refLabel: resolvedRef.label,
        commit,
        commandContext,
      });
    }),
    createCommitActionItem('$(copy) Copy Commit SHA', async () => {
      await vscode.env.clipboard.writeText(commit.sha);
      vscode.window.showInformationMessage(`Copied commit '${commit.shortSha}' to the clipboard.`);
    }),
    createCommitActionItem('$(note) Open Commit Details', async () => {
      await openCommitDetailsDocument(commit, resolvedRef.label);
    }),
  ];

  const currentBranch = commandContext.provider.getCurrentBranch(resolvedRef.repoRoot);
  if (currentBranch && currentBranch.name !== commit.sha) {
    actionItems.push(
      createCommitActionItem('$(diff-multiple) Compare Commit with Current Branch', async () => {
        await openRefComparison({
          repoRoot: resolvedRef.repoRoot,
          leftRef: currentBranch.name,
          rightRef: commit.sha,
          title: `Compare commit '${commit.shortSha}' with current '${currentBranch.name}'`,
          noChangesMessage: `No differences found between commit '${commit.shortSha}' and current branch '${currentBranch.name}'.`,
          commandContext,
          errorPrefix: `Failed to compare commit '${commit.shortSha}' with current branch '${currentBranch.name}'`,
        });
      })
    );
  }

  return actionItems;
}

function createCommitActionItem(
  label: string,
  run: () => Promise<void>
): CommitActionQuickPickItem {
  return {
    label,
    run,
  };
}

async function openChangedFilesForCommit(options: {
  repoRoot: string;
  refLabel: string;
  commit: RefHistoryEntry;
  commandContext: CommandContext;
}): Promise<void> {
  const { repoRoot, refLabel, commit, commandContext } = options;

  try {
    const changes = await getChangedFilesForCommit(repoRoot, commit.sha);
    if (changes.length === 0) {
      vscode.window.showInformationMessage(`Commit '${commit.shortSha}' has no changed files to show.`);
      return;
    }

    const gitApi = await getGitApi() as GitExtensionApi | undefined;
    if (!gitApi) {
      vscode.window.showErrorMessage('The built-in Git extension API is not available.');
      return;
    }

    const repository = gitApi.getRepository(vscode.Uri.file(repoRoot));
    if (!repository) {
      vscode.window.showErrorMessage('Could not resolve the Git repository for this workspace.');
      return;
    }

    const baseRef = commit.parentShas[0];
    const resources = changes.map((change) =>
      buildCompareResource(change, repoRoot, baseRef, commit.sha, gitApi)
    );
    const reveal = resources.find((resource) => resource.modifiedUri || resource.originalUri);

    await vscode.commands.executeCommand('_workbench.openMultiDiffEditor', {
      multiDiffSourceUri: vscode.Uri.from({
        scheme: 'scm-history-item',
        path: `${repository.rootUri.path}/${baseRef ?? 'EMPTY'}..${commit.sha}`,
      }),
      title: `Changed files for commit '${commit.shortSha}' on '${refLabel}'`,
      resources,
      reveal,
    });
  } catch (error) {
    commandContext.showCommandError(`Failed to open changed files for commit '${commit.shortSha}'`, error);
  }
}

async function openCommitDetailsDocument(commit: RefHistoryEntry, refLabel: string): Promise<void> {
  const body = commit.body || commit.subject;
  const document = await vscode.workspace.openTextDocument({
    content: [
      `# Commit ${commit.shortSha}`,
      '',
      `- Full SHA: ${commit.sha}`,
      `- Ref: ${refLabel}`,
      `- Author: ${commit.authorName} <${commit.authorEmail}>`,
      `- When: ${commit.authorRelativeDate}`,
      `- Parents: ${commit.parentShas.join(', ') || 'none'}`,
      '',
      '## Subject',
      '',
      commit.subject,
      '',
      '## Message',
      '',
      body,
    ].join('\n'),
    language: 'markdown',
  });

  await vscode.window.showTextDocument(document, {
    preview: true,
  });
}

async function openRefComparison(options: {
  repoRoot: string;
  leftRef: string;
  rightRef: string;
  title: string;
  noChangesMessage: string;
  commandContext: CommandContext;
  errorPrefix: string;
}): Promise<void> {
  const { repoRoot, leftRef, rightRef, title, noChangesMessage, commandContext, errorPrefix } = options;

  try {
    const changes = await getDiffFilesBetweenRefs(repoRoot, leftRef, rightRef);
    if (changes.length === 0) {
      vscode.window.showInformationMessage(noChangesMessage);
      return;
    }

    const gitApi = await getGitApi() as GitExtensionApi | undefined;
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
      buildCompareResource(change, repoRoot, leftRef, rightRef, gitApi)
    );
    const reveal = resources.find((resource) => resource.modifiedUri || resource.originalUri);

    await vscode.commands.executeCommand('_workbench.openMultiDiffEditor', {
      multiDiffSourceUri: vscode.Uri.from({
        scheme: 'scm-history-item',
        path: `${repository.rootUri.path}/${leftRef}..${rightRef}`,
      }),
      title,
      resources,
      reveal,
    });
  } catch (error) {
    commandContext.showCommandError(errorPrefix, error);
  }
}

async function promptForComparableRef(
  commandContext: CommandContext,
  repoRoot: string,
  placeHolder: string,
  excludedLabel?: string
): Promise<ResolvedHistoryRef | undefined> {
  const candidates = listHistoryCandidates(commandContext)
    .filter((candidate) => candidate.node.repoRoot === repoRoot)
    .filter((candidate) => isComparableCandidate(candidate.node.info))
    .filter((candidate) => candidate.node.fullName !== excludedLabel);

  if (candidates.length === 0) {
    vscode.window.showInformationMessage('No comparable refs are currently available.');
    return undefined;
  }

  const selection = await vscode.window.showQuickPick<RefQuickPickItem>(
    candidates.map((candidate) => ({
      label: candidate.node.fullName,
      description: candidate.description,
      detail: candidate.detail,
      candidate,
    })),
    {
      placeHolder,
      matchOnDescription: true,
      matchOnDetail: true,
    }
  );

  return selection ? resolveHistoryRefFromCandidate(selection.candidate) : undefined;
}

async function promptForHistoryRef(
  commandContext: CommandContext,
  options: {
    prompt: string;
    nodeTypes: readonly HistoryNodeType[];
  }
): Promise<ResolvedHistoryRef | undefined> {
  const repoRoot = await commandContext.requireRepoRoot();
  if (!repoRoot) {
    return undefined;
  }

  await commandContext.refresh({
    sections: ['local', 'remote', 'tags'],
    repoRoots: [repoRoot],
    fetchRemoteState: false,
  });

  const candidates = listHistoryCandidates(commandContext)
    .filter((candidate) => candidate.node.repoRoot === repoRoot)
    .filter((candidate) => options.nodeTypes.includes(resolveHistoryNodeType(candidate.node.info)));

  if (candidates.length === 0) {
    vscode.window.showInformationMessage('No refs are currently available for history inspection.');
    return undefined;
  }

  const selection = await vscode.window.showQuickPick<RefQuickPickItem>(
    candidates.map((candidate) => ({
      label: candidate.node.fullName,
      description: candidate.description,
      detail: candidate.detail,
      candidate,
    })),
    {
      placeHolder: options.prompt,
      matchOnDescription: true,
      matchOnDetail: true,
    }
  );

  return selection ? resolveHistoryRefFromCandidate(selection.candidate) : undefined;
}

function listHistoryCandidates(commandContext: CommandContext): SearchCandidate[] {
  return findMatchingRefs(commandContext.provider.getSearchTreeData(), '', {
    includeHooks: false,
    maxResults: 500,
  });
}

async function resolveUpstreamComparisonTarget(
  item: BranchTreeItem | undefined,
  commandContext: CommandContext
): Promise<{ repoRoot: string; branchName: string; upstreamName: string } | undefined> {
  if (item) {
    if (!supportsUpstreamComparison(item)) {
      return undefined;
    }

    if (!item.branchInfo?.upstreamName || item.branchInfo.upstreamMissing) {
      vscode.window.showInformationMessage(
        `Branch '${item.branchName}' does not have a live upstream to compare against.`
      );
      return undefined;
    }

    return {
      repoRoot: item.repoRoot,
      branchName: item.branchName,
      upstreamName: item.branchInfo.upstreamName,
    };
  }

  const repoRoot = await commandContext.requireRepoRoot();
  if (!repoRoot) {
    return undefined;
  }

  const currentBranch = await commandContext.requireCurrentBranch(NO_CURRENT_BRANCH_MESSAGE, repoRoot);
  if (!currentBranch?.upstreamName || currentBranch.upstreamMissing) {
    if (currentBranch) {
      vscode.window.showInformationMessage(
        `Branch '${currentBranch.name}' does not have a live upstream to compare against.`
      );
    }
    return undefined;
  }

  return {
    repoRoot,
    branchName: currentBranch.name,
    upstreamName: currentBranch.upstreamName,
  };
}

function resolveHistoryRef(item: BranchTreeItem): ResolvedHistoryRef | undefined {
  if (!item.branchName || !item.repoRoot) {
    return undefined;
  }

  if (item.nodeType === 'stash') {
    const stashRef = item.branchInfo?.stashRevision ?? item.branchName;
    return {
      label: item.branchName,
      refName: stashRef,
      repoRoot: item.repoRoot,
    };
  }

  return {
    label: item.branchName,
    refName: item.branchName,
    repoRoot: item.repoRoot,
  };
}

function resolveHistoryRefFromCandidate(candidate: SearchCandidate): ResolvedHistoryRef {
  const stashRef = candidate.node.info.scope === 'stash'
    ? candidate.node.info.stashRevision ?? candidate.node.fullName
    : candidate.node.fullName;

  return {
    label: candidate.node.fullName,
    refName: stashRef,
    repoRoot: candidate.node.repoRoot,
  };
}

function supportsUpstreamComparison(item: BranchTreeItem): item is BranchTreeItem & {
  branchName: string;
  repoRoot: string;
  branchInfo: BranchInfo & { upstreamName?: string; upstreamMissing?: boolean };
} {
  return Boolean(
    item.branchName &&
      item.repoRoot &&
      (item.nodeType === 'branch' || item.nodeType === 'currentBranch')
  );
}

function isBranchHistoryItem(item: BranchTreeItem): boolean {
  return Boolean(
    item.branchName &&
      item.repoRoot &&
      (item.nodeType === 'branch' ||
        item.nodeType === 'currentBranch' ||
        item.nodeType === 'missingUpstreamBranch' ||
        item.nodeType === 'remoteBranch' ||
        item.nodeType === 'staleRemoteBranch')
  );
}

function isHistoryRefItem(item: BranchTreeItem): boolean {
  return Boolean(
    item.branchName &&
      item.repoRoot &&
      (item.nodeType === 'branch' ||
        item.nodeType === 'currentBranch' ||
        item.nodeType === 'missingUpstreamBranch' ||
        item.nodeType === 'remoteBranch' ||
        item.nodeType === 'staleRemoteBranch' ||
        item.nodeType === 'tag')
  );
}

function isComparableCandidate(branch: BranchInfo): boolean {
  return branch.scope !== 'hook' && branch.scope !== 'worktree';
}

function resolveHistoryNodeType(branch: BranchInfo): HistoryNodeType {
  switch (branch.scope) {
    case 'remote':
      return branch.remoteTrackingState === 'stale' ? 'staleRemoteBranch' : 'remoteBranch';
    case 'tag':
      return 'tag';
    default:
      return branch.upstreamMissing
        ? 'missingUpstreamBranch'
        : branch.isCurrent
          ? 'currentBranch'
          : 'branch';
  }
}

function getHistoryMaxCommits(): number {
  return vscode.workspace
    .getConfiguration('gitBranchesPanel')
    .get<number>(HISTORY_MAX_COMMITS_SETTING, 50);
}

function shouldIncludeMergesInHistory(): boolean {
  return vscode.workspace
    .getConfiguration('gitBranchesPanel')
    .get<boolean>(HISTORY_INCLUDE_MERGES_SETTING, true);
}

function buildCompareResource(
  change: RefComparisonChange,
  repoRoot: string,
  leftRef: string | undefined,
  rightRef: string,
  gitApi: GitExtensionApi
): { originalUri?: vscode.Uri; modifiedUri?: vscode.Uri } {
  switch (change.status) {
    case 'A':
      return {
        modifiedUri: gitApi.toGitUri(vscode.Uri.file(join(repoRoot, change.path)), rightRef),
      };
    case 'D':
      return {
        originalUri: leftRef
          ? gitApi.toGitUri(vscode.Uri.file(join(repoRoot, change.path)), leftRef)
          : undefined,
      };
    case 'R':
      return {
        originalUri:
          leftRef && change.originalPath
            ? gitApi.toGitUri(vscode.Uri.file(join(repoRoot, change.originalPath)), leftRef)
            : undefined,
        modifiedUri: gitApi.toGitUri(vscode.Uri.file(join(repoRoot, change.path)), rightRef),
      };
    default:
      return {
        originalUri: leftRef
          ? gitApi.toGitUri(vscode.Uri.file(join(repoRoot, change.path)), leftRef)
          : undefined,
        modifiedUri: gitApi.toGitUri(vscode.Uri.file(join(repoRoot, change.path)), rightRef),
      };
  }
}
