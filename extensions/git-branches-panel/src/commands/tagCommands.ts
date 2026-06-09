import * as vscode from 'vscode';
import { join } from 'node:path';

import {
  type BranchInfo,
} from '../branchModel';
import {
  checkoutTag,
  createTag,
  deleteRemoteTag,
  deleteTag,
  getBranches,
  getDiffFilesBetweenRefs,
  getRemotes,
  getRemoteBranches,
  getStashes,
  getTagDetails,
  getTags,
  pushAllTags,
  pushTag,
  type TagDetails,
  type TagType,
} from '../git';
import { validateTagName } from '../extensionHelpers';
import { BranchTreeItem } from '../treeProvider';
import { getGitApi, NO_CURRENT_BRANCH_MESSAGE, type CommandContext } from './shared';

const TAG_DEFAULT_TYPE_SETTING = 'tags.defaultType';
const TAG_PUSH_AFTER_CREATE_SETTING = 'tags.pushAfterCreate';
const TAG_REQUIRE_MESSAGE_FOR_ANNOTATED_SETTING = 'tags.requireMessageForAnnotated';

interface TagSource {
  displayLabel: string;
  refName: string;
  repoRoot: string;
}

interface TagSourceQuickPickItem extends vscode.QuickPickItem {
  source: TagSource;
}

interface TagTypeQuickPickItem extends vscode.QuickPickItem {
  tagType: TagType;
}

interface TagCommandConfiguration {
  defaultType: TagType;
  pushAfterCreate: boolean;
  requireMessageForAnnotated: boolean;
}

interface GitApi {
  getRepository(uri: vscode.Uri): { rootUri: vscode.Uri } | null;
  toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
}

export function registerTagCommands(
  context: vscode.ExtensionContext,
  commandContext: CommandContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('gitBranchesPanel.createTag', async (item?: BranchTreeItem) => {
      await handleCreateTag(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.checkoutTag', async (item: BranchTreeItem) => {
      await handleCheckoutTag(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.copyTagName', async (item: BranchTreeItem) => {
      await handleCopyTagName(item);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.deleteTag', async (item: BranchTreeItem) => {
      await handleDeleteTag(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.pushAllTags', async (item?: BranchTreeItem) => {
      await handlePushAllTags(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.pushTag', async (item: BranchTreeItem) => {
      await handlePushTag(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.deleteRemoteTag', async (item: BranchTreeItem) => {
      await handleDeleteRemoteTag(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.compareTagWithCurrent', async (item: BranchTreeItem) => {
      await handleCompareTagWithCurrent(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.showTagDetails', async (item: BranchTreeItem) => {
      await handleShowTagDetails(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.copyTagTargetSha', async (item: BranchTreeItem) => {
      await handleCopyTagTargetSha(item, commandContext);
    })
  );
}

async function handleCreateTag(
  item: BranchTreeItem | undefined,
  commandContext: CommandContext
): Promise<void> {
  const source = await resolveTagSource(item, commandContext);
  if (!source) {
    return;
  }

  const configuration = getTagCommandConfiguration();
  const tagType = await promptForTagType(configuration.defaultType);
  if (!tagType) {
    return;
  }

  const name = await vscode.window.showInputBox({
    prompt: `Enter a name for the new tag on '${source.displayLabel}'`,
    placeHolder: 'v1.2.3 or release/2026-06-05',
    validateInput: (value) => validateTagName(value),
  });
  if (!name) {
    return;
  }

  const tagName = name.trim();
  const tagMessage = await promptForTagMessage(
    tagType,
    tagName,
    configuration.requireMessageForAnnotated
  );
  if (tagType !== 'lightweight' && tagMessage === undefined) {
    return;
  }

  try {
    await createTag(source.repoRoot, tagName, source.refName, {
      type: tagType,
      message: tagType === 'lightweight' ? undefined : tagMessage,
    });

    let successMessage = `Created ${describeTagType(tagType)} tag '${tagName}' on '${source.displayLabel}'.`;

    if (configuration.pushAfterCreate) {
      const remoteName = await promptForRemoteName(
        source.repoRoot,
        `Select a remote to push '${tagName}' to`
      );

      if (remoteName) {
        await pushTag(source.repoRoot, remoteName, tagName);
        successMessage = `Created ${describeTagType(tagType)} tag '${tagName}' on '${source.displayLabel}' and pushed it to '${remoteName}'.`;
      }
    }

    await commandContext.showSuccessAndRefresh(successMessage, {
      sections: ['tags'],
      repoRoots: [source.repoRoot],
      fetchRemoteState: false,
    });
  } catch (error) {
    commandContext.showCommandError(`Failed to create tag '${tagName}' on '${source.displayLabel}'`, error);
  }
}

async function handleCheckoutTag(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!item.branchName || !item.repoRoot || item.nodeType !== 'tag') {
    return;
  }

  try {
    await checkoutTag(item.repoRoot, item.branchName);
    await commandContext.showSuccessAndRefresh(
      `Checked out tag '${item.branchName}'. HEAD is now detached at that tag.`,
      { fetchRemoteState: false }
    );
  } catch (error) {
    commandContext.showCommandError(`Failed to checkout tag '${item.branchName}'`, error);
  }
}

async function handleCopyTagName(item: BranchTreeItem): Promise<void> {
  if (!item.branchName) {
    return;
  }

  await vscode.env.clipboard.writeText(item.branchName);
  vscode.window.showInformationMessage(`Copied tag '${item.branchName}' to the clipboard.`);
}

async function handleDeleteTag(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
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
    await commandContext.showSuccessAndRefresh(`Deleted tag '${item.branchName}'.`, {
      fetchRemoteState: false,
    });
  } catch (error) {
    commandContext.showCommandError(`Failed to delete tag '${item.branchName}'`, error);
  }
}

async function handlePushAllTags(
  item: BranchTreeItem | undefined,
  commandContext: CommandContext
): Promise<void> {
  if (item && (item.nodeType !== 'section' || item.containerPath !== 'section:tags')) {
    return;
  }

  const repoRoot = item?.repoRoot ?? (await commandContext.requireRepoRoot());
  if (!repoRoot) {
    return;
  }

  try {
    const remotes = await getRemotes(repoRoot);
    if (remotes.length === 0) {
      vscode.window.showErrorMessage('No git remotes were found for this repository.');
      return;
    }

    const remoteName =
      remotes.length === 1
        ? remotes[0]
        : await vscode.window.showQuickPick(remotes, {
            placeHolder: 'Select a remote to push all tags to',
          });

    if (!remoteName) {
      return;
    }

    await pushAllTags(repoRoot, remoteName);
    await commandContext.showSuccessAndRefresh(`Pushed all tags to '${remoteName}'.`, {
      fetchRemoteState: false,
    });
  } catch (error) {
    commandContext.showCommandError('Failed to push all tags', error);
  }
}

async function handlePushTag(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!isTagItem(item)) {
    return;
  }

  const remoteName = await promptForRemoteName(
    item.repoRoot,
    `Select a remote to push '${item.branchName}' to`
  );
  if (!remoteName) {
    return;
  }

  try {
    await pushTag(item.repoRoot, remoteName, item.branchName);
    await commandContext.showSuccessAndRefresh(
      `Pushed tag '${item.branchName}' to '${remoteName}'.`,
      {
        sections: ['tags'],
        repoRoots: [item.repoRoot],
        fetchRemoteState: false,
      }
    );
  } catch (error) {
    commandContext.showCommandError(
      `Failed to push tag '${item.branchName}' to '${remoteName}'`,
      error
    );
  }
}

async function handleDeleteRemoteTag(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!isTagItem(item)) {
    return;
  }

  const remoteName = await promptForRemoteName(
    item.repoRoot,
    `Select a remote to delete '${item.branchName}' from`
  );
  if (!remoteName) {
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    `Delete remote tag '${item.branchName}' from '${remoteName}'?`,
    { modal: true },
    'Delete Remote Tag'
  );
  if (confirmation !== 'Delete Remote Tag') {
    return;
  }

  try {
    await deleteRemoteTag(item.repoRoot, remoteName, item.branchName);
    vscode.window.showInformationMessage(
      `Deleted remote tag '${item.branchName}' from '${remoteName}'.`
    );
  } catch (error) {
    commandContext.showCommandError(
      `Failed to delete remote tag '${item.branchName}' from '${remoteName}'`,
      error
    );
  }
}

async function handleCompareTagWithCurrent(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!isTagItem(item)) {
    return;
  }

  const currentBranch = await commandContext.requireCurrentBranch(
    NO_CURRENT_BRANCH_MESSAGE,
    item.repoRoot
  );
  if (!currentBranch) {
    return;
  }

  try {
    const changes = await getDiffFilesBetweenRefs(item.repoRoot, currentBranch.name, item.branchName);
    if (changes.length === 0) {
      vscode.window.showInformationMessage(
        `No differences found between current branch '${currentBranch.name}' and tag '${item.branchName}'.`
      );
      return;
    }

    const gitApi = await getGitApi() as GitApi | undefined;
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
      buildCompareResource(change, item.repoRoot, currentBranch.name, item.branchName, gitApi)
    );
    const reveal = resources.find((resource) => resource.modifiedUri || resource.originalUri);

    await vscode.commands.executeCommand('_workbench.openMultiDiffEditor', {
      multiDiffSourceUri: vscode.Uri.from({
        scheme: 'scm-history-item',
        path: `${repository.rootUri.path}/${currentBranch.name}..${item.branchName}`,
      }),
      title: `Compare tag '${item.branchName}' with current '${currentBranch.name}'`,
      resources,
      reveal,
    });
  } catch (error) {
    commandContext.showCommandError(
      `Failed to compare tag '${item.branchName}' with current branch '${currentBranch.name}'`,
      error
    );
  }
}

async function handleShowTagDetails(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!isTagItem(item)) {
    return;
  }

  try {
    const details = await getTagDetails(item.repoRoot, item.branchName);
    const document = await vscode.workspace.openTextDocument({
      content: buildTagDetailsDocument(details),
      language: 'markdown',
    });

    await vscode.window.showTextDocument(document, {
      preview: true,
    });
  } catch (error) {
    commandContext.showCommandError(`Failed to load details for tag '${item.branchName}'`, error);
  }
}

async function handleCopyTagTargetSha(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!isTagItem(item)) {
    return;
  }

  try {
    const details = await getTagDetails(item.repoRoot, item.branchName);
    await vscode.env.clipboard.writeText(details.targetSha);
    vscode.window.showInformationMessage(
      `Copied target SHA for tag '${item.branchName}' to the clipboard.`
    );
  } catch (error) {
    commandContext.showCommandError(
      `Failed to copy the target SHA for tag '${item.branchName}'`,
      error
    );
  }
}

async function resolveTagSource(
  item: BranchTreeItem | undefined,
  commandContext: CommandContext
): Promise<
  | {
      displayLabel: string;
      refName: string;
      repoRoot: string;
    }
  | undefined
> {
  if (
    item?.branchName &&
    item.repoRoot &&
    (item.nodeType === 'branch' ||
      item.nodeType === 'currentBranch' ||
      item.nodeType === 'missingUpstreamBranch' ||
      item.nodeType === 'remoteBranch' ||
      item.nodeType === 'staleRemoteBranch' ||
      item.nodeType === 'tag')
  ) {
    return {
      displayLabel: item.branchName,
      refName: item.branchName,
      repoRoot: item.repoRoot,
    };
  }

  if (item && (item.nodeType !== 'section' || item.containerPath !== 'section:tags')) {
    return undefined;
  }

  const repoRoot = item?.repoRoot ?? (await commandContext.requireRepoRoot());
  if (!repoRoot) {
    return undefined;
  }

  return promptForTagSource(repoRoot, commandContext);
}

function getTagCommandConfiguration(): TagCommandConfiguration {
  const configuration = vscode.workspace.getConfiguration('gitBranchesPanel');

  return {
    defaultType: configuration.get<TagType>(TAG_DEFAULT_TYPE_SETTING, 'annotated'),
    pushAfterCreate: configuration.get<boolean>(TAG_PUSH_AFTER_CREATE_SETTING, false),
    requireMessageForAnnotated: configuration.get<boolean>(
      TAG_REQUIRE_MESSAGE_FOR_ANNOTATED_SETTING,
      true
    ),
  };
}

async function promptForTagSource(
  repoRoot: string,
  commandContext: CommandContext
): Promise<TagSource | undefined> {
  await commandContext.refresh({
    sections: ['local', 'remote', 'stash', 'tags'],
    repoRoots: [repoRoot],
    fetchRemoteState: false,
  });

  const [branches, remoteBranches, tags, stashes] = await Promise.all([
    getBranches(repoRoot),
    getRemoteBranches(repoRoot),
    getTags(repoRoot),
    getStashes(repoRoot),
  ]);

  const items: TagSourceQuickPickItem[] = [
    ...branches.map((branch) => toTagSourceQuickPickItem(branch, repoRoot)),
    ...remoteBranches.map((branch) => toTagSourceQuickPickItem(branch, repoRoot)),
    ...tags.map((tag) => toTagSourceQuickPickItem(tag, repoRoot)),
    ...stashes.map((stash) => toTagSourceQuickPickItem(stash, repoRoot)),
  ];

  if (items.length === 0) {
    vscode.window.showInformationMessage('No refs are currently available to tag in this repository.');
    return undefined;
  }

  const selection = await vscode.window.showQuickPick<TagSourceQuickPickItem>(items, {
    placeHolder: 'Choose the ref to tag',
    matchOnDescription: true,
    matchOnDetail: true,
  });

  return selection?.source;
}

function toTagSourceQuickPickItem(
  branch: BranchInfo,
  repoRoot: string
): TagSourceQuickPickItem {
  const scopeLabel =
    branch.scope === 'remote'
      ? branch.remoteTrackingState === 'stale'
        ? 'Stale remote branch'
        : 'Remote branch'
      : branch.scope === 'tag'
        ? 'Tag'
        : branch.scope === 'stash'
          ? 'Stash'
          : branch.isCurrent
            ? 'Current branch'
            : 'Local branch';
  const detailParts = [branch.lastCommitDate, branch.lastCommit].filter(Boolean);

  return {
    label: branch.name,
    description: scopeLabel,
    detail: detailParts.join(' • ') || undefined,
    source: {
      displayLabel: branch.name,
      refName: branch.scope === 'stash' ? branch.stashRevision ?? branch.name : branch.name,
      repoRoot,
    },
  };
}

async function promptForTagType(defaultType: TagType): Promise<TagType | undefined> {
  const orderedItems = [
    {
      tagType: 'lightweight' as const,
      label: 'Lightweight',
      description: 'Fast local marker without an annotation message',
    },
    {
      tagType: 'annotated' as const,
      label: 'Annotated',
      description: 'Recommended for releases with a stored annotation message',
    },
    {
      tagType: 'signedAnnotated' as const,
      label: 'Signed annotated',
      description: 'Annotated tag signed through your local Git/GPG setup',
    },
  ].sort((left, right) => Number(right.tagType === defaultType) - Number(left.tagType === defaultType));

  const selection = await vscode.window.showQuickPick<TagTypeQuickPickItem>(
    orderedItems.map((item) => ({
      ...item,
      detail: item.tagType === defaultType ? 'Default tag type from settings' : undefined,
    })),
    {
      placeHolder: 'Choose the tag type',
      matchOnDescription: true,
      matchOnDetail: true,
    }
  );

  return selection?.tagType;
}

async function promptForTagMessage(
  tagType: TagType,
  tagName: string,
  requireMessageForAnnotated: boolean
): Promise<string | undefined> {
  if (tagType === 'lightweight') {
    return undefined;
  }

  const message = await vscode.window.showInputBox({
    prompt:
      tagType === 'signedAnnotated'
        ? `Enter the signed annotation message for '${tagName}'`
        : `Enter the annotation message for '${tagName}'`,
    placeHolder: requireMessageForAnnotated
      ? 'Release notes, changelog summary, or other tag message'
      : 'Leave blank to reuse the tag name as the annotation subject',
    value: requireMessageForAnnotated ? '' : tagName,
    validateInput: requireMessageForAnnotated
      ? (value) => (value.trim() ? undefined : 'Annotated tags require a message.')
      : undefined,
  });

  if (message === undefined) {
    return undefined;
  }

  const normalizedMessage = message.trim();
  return normalizedMessage || tagName;
}

async function promptForRemoteName(
  repoRoot: string,
  placeHolder: string
): Promise<string | undefined> {
  const remotes = await getRemotes(repoRoot);
  if (remotes.length === 0) {
    vscode.window.showErrorMessage('No git remotes were found for this repository.');
    return undefined;
  }

  if (remotes.length === 1) {
    return remotes[0];
  }

  return vscode.window.showQuickPick(remotes, {
    placeHolder,
  });
}

function describeTagType(tagType: TagType): string {
  switch (tagType) {
    case 'lightweight':
      return 'lightweight';
    case 'signedAnnotated':
      return 'signed annotated';
    default:
      return 'annotated';
  }
}

function isTagItem(
  item: BranchTreeItem
): item is BranchTreeItem & { branchName: string; repoRoot: string } {
  return Boolean(item.branchName && item.repoRoot && item.nodeType === 'tag');
}

function buildTagDetailsDocument(details: TagDetails): string {
  const headerLines = [
    `# Tag ${details.name}`,
    '',
    `- Type: ${formatTagType(details.type)}`,
    `- Signed: ${details.isSigned ? 'Yes' : 'No'}`,
    `- Target: ${details.targetSha} (${details.targetType})`,
    `- Tag object: ${details.tagObjectSha}`,
  ];

  if (details.authorName || details.authorEmail) {
    headerLines.push(
      `- Author: ${[details.authorName, details.authorEmail ? `<${details.authorEmail}>` : '']
        .filter(Boolean)
        .join(' ')}`
    );
  }

  if (details.createdAt) {
    headerLines.push(`- Created: ${details.createdAt}`);
  }

  if (details.type === 'lightweight') {
    headerLines.push('- Notes: Lightweight tags do not store an annotation message.');
  }

  return [
    ...headerLines,
    '',
    '## Subject',
    '',
    details.subject ?? '_No subject available_',
    '',
    '## Message',
    '',
    details.message ?? '_No annotation message available_',
  ].join('\n');
}

function formatTagType(tagType: TagType): string {
  switch (tagType) {
    case 'lightweight':
      return 'Lightweight';
    case 'signedAnnotated':
      return 'Signed annotated';
    default:
      return 'Annotated';
  }
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
