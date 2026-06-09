import * as vscode from 'vscode';

import {
  addRemote,
  buildRepositoryHomeUrl,
  fetchRemote,
  getRemotes,
  parseCustomRemoteHostingProviders,
  removeRemote,
  renameRemote,
  resolveHostedRepository,
  setRemoteFetchUrl,
  setRemotePushUrl,
  type CustomRemoteHostingProvider,
} from '../git';
import { BranchTreeItem } from '../treeProvider';
import type { RemoteConfigInfo } from '../branchModel';
import type { CommandContext } from './shared';

const REMOTE_HOSTING_CUSTOM_PROVIDERS_SETTING = 'remoteHosting.customProviders';
const REMOVE_REMOTE_ACTION = 'Remove Remote';
const REMOTE_URL_PLACEHOLDER = 'https://github.com/example/repo.git or git@example.com:team/repo.git';
const REMOTE_SECTIONS_TO_REFRESH = ['local', 'remote', 'remotes'] as const;

export function registerRemoteCommands(
  context: vscode.ExtensionContext,
  commandContext: CommandContext
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('gitBranchesPanel.addRemote', async (item?: BranchTreeItem) => {
      await handleAddRemote(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.fetchRemote', async (item: BranchTreeItem) => {
      await handleFetchRemote(item, commandContext, false);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.fetchRemotePrune', async (item: BranchTreeItem) => {
      await handleFetchRemote(item, commandContext, true);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.copyRemoteFetchUrl', async (item: BranchTreeItem) => {
      await handleCopyRemoteFetchUrl(item);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.copyRemotePushUrl', async (item: BranchTreeItem) => {
      await handleCopyRemotePushUrl(item);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.openRemoteHomepage', async (item: BranchTreeItem) => {
      await handleOpenRemoteHomepage(item);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.renameRemote', async (item: BranchTreeItem) => {
      await handleRenameRemote(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.setRemoteFetchUrl', async (item: BranchTreeItem) => {
      await handleSetRemoteFetchUrl(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.setRemotePushUrl', async (item: BranchTreeItem) => {
      await handleSetRemotePushUrl(item, commandContext);
    }),
    vscode.commands.registerCommand('gitBranchesPanel.removeRemote', async (item: BranchTreeItem) => {
      await handleRemoveRemote(item, commandContext);
    })
  );
}

async function handleAddRemote(
  item: BranchTreeItem | undefined,
  commandContext: CommandContext
): Promise<void> {
  if (item && !isRemotesSectionItem(item)) {
    return;
  }

  const repoRoot = item?.repoRoot ?? (await commandContext.requireRepoRoot());
  if (!repoRoot) {
    return;
  }

  const existingRemoteNames = new Set(await getRemotes(repoRoot));
  const remoteNameInput = await vscode.window.showInputBox({
    prompt: 'Enter a name for the new remote',
    placeHolder: 'origin or upstream',
    validateInput: (value) => validateRemoteNameInput(value, undefined, existingRemoteNames),
  });
  if (!remoteNameInput) {
    return;
  }

  const remoteName = remoteNameInput.trim();
  const fetchUrlInput = await vscode.window.showInputBox({
    prompt: `Enter the fetch URL or path for remote '${remoteName}'`,
    placeHolder: REMOTE_URL_PLACEHOLDER,
    validateInput: (value) => validateRemoteUrlInput(value),
  });
  if (fetchUrlInput === undefined) {
    return;
  }

  const fetchUrl = fetchUrlInput.trim();
  const pushUrlInput = await vscode.window.showInputBox({
    prompt: `Enter an optional separate push URL for remote '${remoteName}'`,
    placeHolder: 'Leave blank to reuse the fetch URL',
    validateInput: (value) => validateRemoteUrlInput(value, { allowBlank: true }),
  });
  if (pushUrlInput === undefined) {
    return;
  }

  const pushUrl = pushUrlInput.trim();

  try {
    await addRemote(repoRoot, remoteName, fetchUrl);
    if (pushUrl && pushUrl !== fetchUrl) {
      await setRemotePushUrl(repoRoot, remoteName, pushUrl);
    }

    await commandContext.showSuccessAndRefresh(
      pushUrl && pushUrl !== fetchUrl
        ? `Added remote '${remoteName}' with separate fetch and push URLs.`
        : `Added remote '${remoteName}'.`,
      {
        sections: [...REMOTE_SECTIONS_TO_REFRESH],
        repoRoots: [repoRoot],
        fetchRemoteState: false,
      }
    );
  } catch (error) {
    commandContext.showCommandError(`Failed to add remote '${remoteName}'`, error);
  }
}

async function handleFetchRemote(
  item: BranchTreeItem,
  commandContext: CommandContext,
  prune: boolean
): Promise<void> {
  if (!isRemoteConfigItem(item)) {
    return;
  }

  try {
    await fetchRemote(item.repoRoot, item.remoteInfo.name, { prune });
    await commandContext.showSuccessAndRefresh(
      prune
        ? `Fetched remote '${item.remoteInfo.name}' and pruned deleted refs.`
        : `Fetched remote '${item.remoteInfo.name}'.`,
      {
        sections: [...REMOTE_SECTIONS_TO_REFRESH],
        repoRoots: [item.repoRoot],
        fetchRemoteState: false,
      }
    );
  } catch (error) {
    commandContext.showCommandError(
      prune
        ? `Failed to fetch and prune remote '${item.remoteInfo.name}'`
        : `Failed to fetch remote '${item.remoteInfo.name}'`,
      error
    );
  }
}

async function handleCopyRemoteFetchUrl(item: BranchTreeItem): Promise<void> {
  if (!isRemoteConfigItem(item)) {
    return;
  }

  await vscode.env.clipboard.writeText(item.remoteInfo.fetchUrl);
  vscode.window.showInformationMessage(
    `Copied fetch URL for remote '${item.remoteInfo.name}' to the clipboard.`
  );
}

async function handleCopyRemotePushUrl(item: BranchTreeItem): Promise<void> {
  if (!isRemoteConfigItem(item)) {
    return;
  }

  await vscode.env.clipboard.writeText(item.remoteInfo.pushUrl);
  vscode.window.showInformationMessage(
    `Copied push URL for remote '${item.remoteInfo.name}' to the clipboard.`
  );
}

async function handleOpenRemoteHomepage(item: BranchTreeItem): Promise<void> {
  if (!isRemoteConfigItem(item)) {
    return;
  }

  const hostedRepository = resolveHostedRepository(
    item.remoteInfo,
    getRemoteHostingCustomProviders()
  );
  const remoteHomepageUrl = hostedRepository
    ? buildRepositoryHomeUrl(hostedRepository)
    : undefined;

  if (!remoteHomepageUrl) {
    vscode.window.showErrorMessage(
      `Remote '${item.remoteInfo.name}' does not point to a supported hosted repository URL.`
    );
    return;
  }

  await vscode.env.openExternal(vscode.Uri.parse(remoteHomepageUrl));
}

async function handleRenameRemote(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!isRemoteConfigItem(item)) {
    return;
  }

  const existingRemoteNames = new Set(
    (await getRemotes(item.repoRoot)).filter((remoteName) => remoteName !== item.remoteInfo.name)
  );
  const remoteNameInput = await vscode.window.showInputBox({
    prompt: `Rename remote '${item.remoteInfo.name}' to:`,
    value: item.remoteInfo.name,
    validateInput: (value) => validateRemoteNameInput(value, item.remoteInfo.name, existingRemoteNames),
  });
  if (!remoteNameInput) {
    return;
  }

  const newRemoteName = remoteNameInput.trim();

  try {
    await renameRemote(item.repoRoot, item.remoteInfo.name, newRemoteName);
    await commandContext.showSuccessAndRefresh(
      `Renamed remote '${item.remoteInfo.name}' to '${newRemoteName}'.`,
      {
        sections: [...REMOTE_SECTIONS_TO_REFRESH],
        repoRoots: [item.repoRoot],
        fetchRemoteState: false,
      }
    );
  } catch (error) {
    commandContext.showCommandError(`Failed to rename remote '${item.remoteInfo.name}'`, error);
  }
}

async function handleSetRemoteFetchUrl(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!isRemoteConfigItem(item)) {
    return;
  }

  const remoteUrlInput = await vscode.window.showInputBox({
    prompt: `Set fetch URL for remote '${item.remoteInfo.name}'`,
    value: item.remoteInfo.fetchUrl,
    placeHolder: REMOTE_URL_PLACEHOLDER,
    validateInput: (value) => validateRemoteUrlInput(value),
  });
  if (!remoteUrlInput) {
    return;
  }

  const remoteUrl = remoteUrlInput.trim();

  try {
    await setRemoteFetchUrl(item.repoRoot, item.remoteInfo.name, remoteUrl);
    await commandContext.showSuccessAndRefresh(
      `Updated fetch URL for remote '${item.remoteInfo.name}'.`,
      {
        sections: [...REMOTE_SECTIONS_TO_REFRESH],
        repoRoots: [item.repoRoot],
        fetchRemoteState: false,
      }
    );
  } catch (error) {
    commandContext.showCommandError(`Failed to update fetch URL for remote '${item.remoteInfo.name}'`, error);
  }
}

async function handleSetRemotePushUrl(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!isRemoteConfigItem(item)) {
    return;
  }

  const remoteUrlInput = await vscode.window.showInputBox({
    prompt: `Set push URL for remote '${item.remoteInfo.name}'`,
    value: item.remoteInfo.pushUrl,
    placeHolder: REMOTE_URL_PLACEHOLDER,
    validateInput: (value) => validateRemoteUrlInput(value),
  });
  if (!remoteUrlInput) {
    return;
  }

  const remoteUrl = remoteUrlInput.trim();

  try {
    await setRemotePushUrl(item.repoRoot, item.remoteInfo.name, remoteUrl);
    await commandContext.showSuccessAndRefresh(
      `Updated push URL for remote '${item.remoteInfo.name}'.`,
      {
        sections: [...REMOTE_SECTIONS_TO_REFRESH],
        repoRoots: [item.repoRoot],
        fetchRemoteState: false,
      }
    );
  } catch (error) {
    commandContext.showCommandError(`Failed to update push URL for remote '${item.remoteInfo.name}'`, error);
  }
}

async function handleRemoveRemote(
  item: BranchTreeItem,
  commandContext: CommandContext
): Promise<void> {
  if (!isRemoteConfigItem(item)) {
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    [
      `Remove remote '${item.remoteInfo.name}'?`,
      `Fetch URL: ${item.remoteInfo.fetchUrl}`,
      item.remoteInfo.pushUrl !== item.remoteInfo.fetchUrl
        ? `Push URL: ${item.remoteInfo.pushUrl}`
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
    { modal: true },
    REMOVE_REMOTE_ACTION
  );
  if (confirmation !== REMOVE_REMOTE_ACTION) {
    return;
  }

  try {
    await removeRemote(item.repoRoot, item.remoteInfo.name);
    await commandContext.showSuccessAndRefresh(
      `Removed remote '${item.remoteInfo.name}'.`,
      {
        sections: [...REMOTE_SECTIONS_TO_REFRESH],
        repoRoots: [item.repoRoot],
        fetchRemoteState: false,
      }
    );
  } catch (error) {
    commandContext.showCommandError(`Failed to remove remote '${item.remoteInfo.name}'`, error);
  }
}

function isRemotesSectionItem(item: BranchTreeItem | undefined): item is BranchTreeItem & { repoRoot: string } {
  return Boolean(item && item.nodeType === 'section' && item.containerScope === 'remoteConfig' && item.repoRoot);
}

function isRemoteConfigItem(
  item: BranchTreeItem | undefined
): item is BranchTreeItem & { repoRoot: string; remoteInfo: RemoteConfigInfo } {
  return Boolean(item?.repoRoot && item.remoteInfo && item.nodeType === 'remoteConfig');
}

function validateRemoteNameInput(
  value: string,
  currentName: string | undefined,
  existingRemoteNames: ReadonlySet<string>
): string | undefined {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return 'Remote name cannot be empty.';
  }

  if (/\s/u.test(normalizedValue)) {
    return 'Remote name cannot contain whitespace.';
  }

  if (currentName && normalizedValue === currentName) {
    return 'Please enter a different remote name.';
  }

  if (existingRemoteNames.has(normalizedValue)) {
    return `Remote '${normalizedValue}' already exists.`;
  }

  return undefined;
}

function validateRemoteUrlInput(
  value: string,
  options: {
    allowBlank?: boolean;
  } = {}
): string | undefined {
  const normalizedValue = value.trim();

  if (!normalizedValue) {
    return options.allowBlank ? undefined : 'Remote URL cannot be empty.';
  }

  const hasExplicitScheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(normalizedValue);
  if (hasExplicitScheme) {
    try {
      new URL(normalizedValue);
    } catch {
      return 'Remote URL must be a valid URL.';
    }
  }

  return undefined;
}

function getRemoteHostingCustomProviders(): readonly CustomRemoteHostingProvider[] {
  return parseCustomRemoteHostingProviders(
    vscode.workspace
      .getConfiguration('gitBranchesPanel')
      .get<unknown[]>(REMOTE_HOSTING_CUSTOM_PROVIDERS_SETTING, [])
  );
}
