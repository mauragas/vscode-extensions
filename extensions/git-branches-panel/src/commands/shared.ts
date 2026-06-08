import * as vscode from 'vscode';

import { type BranchInfo } from '../branchModel';
import { formatErrorMessage } from '../errorUtils';
import type { BranchItemActivationTracker } from '../extensionHelpers';
import { resetTrackerAndRefresh } from '../providerRefresh';
import { BranchTreeProvider, type BranchLoadOptions } from '../treeProvider';

const NO_REPOSITORY_MESSAGE = 'No git repository found in the current workspace.';
export const NO_CURRENT_BRANCH_MESSAGE = 'No current git branch was found.';

interface GitApiRepository {
  readonly rootUri: vscode.Uri;
}

interface GitApi {
  readonly repositories: readonly GitApiRepository[];
  getRepository(uri: vscode.Uri): GitApiRepository | null;
}

interface GitExtensionExports {
  getAPI(version: number): GitApi;
}

export interface CommandContext {
  readonly provider: BranchTreeProvider;
  readonly activationTracker: BranchItemActivationTracker;
  refresh(options?: BranchLoadOptions): Promise<void>;
  requireRepoRoot(): Promise<string | undefined>;
  requireCurrentBranch(missingBranchMessage: string): Promise<BranchInfo | undefined>;
  showSuccessAndRefresh(message: string, refreshOptions?: BranchLoadOptions): Promise<void>;
  showCommandError(prefix: string, error: unknown): void;
}

export function createCommandContext(
  provider: BranchTreeProvider,
  activationTracker: BranchItemActivationTracker
): CommandContext {
  return {
    provider,
    activationTracker,
    refresh: async (options: BranchLoadOptions = {}): Promise<void> => {
      await resetTrackerAndRefresh(provider, activationTracker, options);
    },
    requireRepoRoot: async () => {
      const repoRoot = await resolveRepoRoot(provider);
      if (repoRoot) {
        return repoRoot;
      }

      vscode.window.showErrorMessage(NO_REPOSITORY_MESSAGE);
      return undefined;
    },
    requireCurrentBranch: async (missingBranchMessage: string) => {
      const currentBranch = await resolveCurrentBranch(provider);
      if (currentBranch) {
        return currentBranch;
      }

      vscode.window.showErrorMessage(missingBranchMessage);
      return undefined;
    },
    showSuccessAndRefresh: async (
      message: string,
      refreshOptions: BranchLoadOptions = {}
    ): Promise<void> => {
      vscode.window.showInformationMessage(message);
      await resetTrackerAndRefresh(provider, activationTracker, refreshOptions);
    },
    showCommandError: (prefix: string, error: unknown): void => {
      vscode.window.showErrorMessage(formatErrorMessage(prefix, error));
    },
  };
}

export async function getGitApi(): Promise<GitApi | undefined> {
  const extension = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
  if (!extension) {
    return undefined;
  }

  const exports = extension.isActive ? extension.exports : await extension.activate();
  if (!exports || typeof exports.getAPI !== 'function') {
    return undefined;
  }

  return exports.getAPI(1);
}

export async function resolveRepoRootFromScmContext(
  invocationContext: unknown
): Promise<string | undefined> {
  const gitApi = await getGitApi();
  if (!gitApi) {
    return undefined;
  }

  const candidateUris = collectCandidateUris(invocationContext);
  const activeEditorUri = vscode.window.activeTextEditor?.document.uri;
  if (activeEditorUri) {
    appendCandidateUri(candidateUris, activeEditorUri);
  }

  for (const candidateUri of candidateUris.values()) {
    const repository = gitApi.getRepository(candidateUri);
    if (repository?.rootUri.fsPath) {
      return repository.rootUri.fsPath;
    }
  }

  if (gitApi.repositories.length === 1) {
    return gitApi.repositories[0].rootUri.fsPath;
  }

  return undefined;
}

async function resolveRepoRoot(provider: BranchTreeProvider): Promise<string | null> {
  const existingRepoRoot = provider.getRepoRoot();
  if (existingRepoRoot) {
    return existingRepoRoot;
  }

  await provider.refresh({ sections: ['local'], fetchRemoteState: false });
  return provider.getRepoRoot();
}

async function resolveCurrentBranch(provider: BranchTreeProvider): Promise<BranchInfo | undefined> {
  const currentBranch = provider.getCurrentBranch();
  if (currentBranch) {
    return currentBranch;
  }

  await provider.refresh({ sections: ['local'], fetchRemoteState: false });
  return provider.getCurrentBranch();
}

function collectCandidateUris(
  value: unknown,
  candidateUris = new Map<string, vscode.Uri>(),
  visited = new Set<unknown>()
): Map<string, vscode.Uri> {
  if (value === null || value === undefined) {
    return candidateUris;
  }

  if (visited.has(value)) {
    return candidateUris;
  }

  if (Array.isArray(value)) {
    visited.add(value);
    for (const entry of value) {
      collectCandidateUris(entry, candidateUris, visited);
    }
    return candidateUris;
  }

  if (isUriLike(value)) {
    appendCandidateUri(candidateUris, value);
    return candidateUris;
  }

  if (typeof value !== 'object') {
    return candidateUris;
  }

  visited.add(value);

  const nestedValues = [
    'rootUri',
    'resourceUri',
    'uri',
    'sourceControl',
    'repository',
    'resourceGroup',
    'resourceStates',
    'selectedResourceGroups',
  ]
    .filter((key) => key in value)
    .map((key) => value[key as keyof typeof value]);

  for (const nestedValue of nestedValues) {
    collectCandidateUris(nestedValue, candidateUris, visited);
  }

  return candidateUris;
}

function appendCandidateUri(
  candidateUris: Map<string, vscode.Uri>,
  candidateUri: vscode.Uri
): void {
  const key = candidateUri.fsPath || candidateUri.path;
  if (!key) {
    return;
  }

  candidateUris.set(key, candidateUri);
}

function isUriLike(value: unknown): value is vscode.Uri {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (typeof (value as vscode.Uri).fsPath === 'string' ||
        typeof (value as vscode.Uri).path === 'string')
  );
}
