import * as vscode from 'vscode';

import { getErrorMessage } from '../errorUtils';
import { runGit } from '../git/shared';

export type ConflictRecoveryAction = 'createBranch' | 'discardAndRetry' | 'cancel';

export interface ConflictRecoveryPromptOptions {
  branchName: string;
  operationDescription: string;
  discardActionLabel: string;
}

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
    `${operationDescription} '${branchName}' is blocked by local changes that would be overwritten. You can keep the current changes on a new branch, discard them and retry, or cancel. What would you like to do?`,
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
