import * as vscode from 'vscode';

import {
  DEFAULT_NEW_BRANCH_PREFIXES,
  normalizeConfiguredBranchPrefixes,
} from '../branchRules';
import { getErrorMessage } from '../errorUtils';
import {
  normalizeBranchName,
  sanitizeNewBranchName,
  validateNewBranchNameInput,
} from '../extensionHelpers';
import { runGit } from '../git/shared';

export type ConflictRecoveryAction = 'createBranch' | 'discardAndRetry' | 'cancel';

export interface ConflictRecoveryPromptOptions {
  branchName: string;
  operationDescription: string;
  discardActionLabel: string;
}

interface RecoveryBranchNamePromptOptions {
  prompt: string;
  currentName?: string;
  normalize?: boolean;
}

const NEW_BRANCH_PLACEHOLDER = 'feature/my-feature or hotfix/bug-123';

export function looksLikeCheckoutConflictError(error: unknown): boolean {
  const message = getErrorMessage(error, '').toLowerCase();

  return /would be overwritten by (checkout|pull)|local changes to the following files would be overwritten|please commit your changes|stash them before you switch branches/i.test(message);
}

export async function discardLocalChanges(repoRoot: string): Promise<void> {
  await runGit(repoRoot, ['reset', '--hard', 'HEAD']);
  await runGit(repoRoot, ['clean', '-fd']);
}

export async function promptForConflictRecoveryAction({
  branchName,
  operationDescription,
  discardActionLabel,
}: ConflictRecoveryPromptOptions): Promise<ConflictRecoveryAction> {
  const action = await vscode.window.showWarningMessage(
    `${operationDescription} '${branchName}' is blocked by local changes that would be overwritten. You can keep the current changes on a new branch, permanently discard the current tracked and untracked changes and retry, or cancel. What would you like to do?`,
    { modal: true },
    'Create a new branch',
    discardActionLabel,
    'Cancel'
  );

  if (action === 'Create a new branch') {
    return 'createBranch';
  }

  if (action === discardActionLabel) {
    return 'discardAndRetry';
  }

  return 'cancel';
}

export async function promptForRecoveryBranchName(
  options: RecoveryBranchNamePromptOptions
): Promise<string | undefined> {
  const prefix = await promptForNewBranchPrefix();
  const prefixedBranchName = prefix ? `${prefix}/` : undefined;
  const name = await vscode.window.showInputBox({
    prompt: options.prompt,
    placeHolder: NEW_BRANCH_PLACEHOLDER,
    value: prefixedBranchName,
    valueSelection: prefixedBranchName
      ? [prefixedBranchName.length, prefixedBranchName.length]
      : undefined,
    validateInput: (value) =>
      validateNewBranchNameInput(value, options.currentName, {
        normalize: options.normalize,
      }),
  });

  if (!name) {
    return undefined;
  }

  return options.normalize ? normalizeBranchName(name) : sanitizeNewBranchName(name) || undefined;
}

async function promptForNewBranchPrefix(): Promise<string | undefined> {
  const prefixes = normalizeConfiguredBranchPrefixes(
    vscode.workspace
      .getConfiguration('gitBranchesPanel')
      .get<string[]>('newBranchPrefixes', [...DEFAULT_NEW_BRANCH_PREFIXES])
  );

  if (prefixes.length === 0) {
    return undefined;
  }

  const selection = await vscode.window.showQuickPick<
    { label: string; description: string; prefix?: string }
  >(
    [
      {
        label: 'No prefix',
        description: 'Start from a plain branch name',
      },
      ...prefixes.map((prefix) => ({
        label: `${prefix}/`,
        description: `Prefill the new branch name with '${prefix}/'`,
        prefix,
      })),
    ],
    {
      placeHolder: 'Choose a default branch folder for the new branch (optional)',
    }
  );

  return selection?.prefix;
}
