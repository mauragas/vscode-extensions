import * as vscode from 'vscode';

import { type BranchInfo } from '../branchModel';
import { formatErrorMessage } from '../errorUtils';
import type { BranchItemActivationTracker } from '../extensionHelpers';
import { resetTrackerAndRefresh } from '../providerRefresh';
import { BranchTreeProvider, type BranchLoadOptions } from '../treeProvider';

const NO_REPOSITORY_MESSAGE = 'No git repository found in the current workspace.';
export const NO_CURRENT_BRANCH_MESSAGE = 'No current git branch was found.';

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
