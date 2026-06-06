import * as vscode from 'vscode';

import { registerBranchDomainCommands } from './commands/branchCommands';
import { registerBulkActionCommands } from './commands/bulkActions';
import { registerRepositoryCommands } from './commands/repositoryCommands';
import { createCommandContext } from './commands/shared';
import { registerStashCommands } from './commands/stashCommands';
import { registerTagCommands } from './commands/tagCommands';
import { registerWorktreeCommands } from './commands/worktreeCommands';
import { type BranchItemActivationTracker } from './extensionHelpers';
import { type BranchTreeProvider } from './treeProvider';

export function registerBranchCommands(
  context: vscode.ExtensionContext,
  provider: BranchTreeProvider,
  activationTracker: BranchItemActivationTracker
): void {
  const commandContext = createCommandContext(provider, activationTracker);

  registerRepositoryCommands(context, commandContext);
  registerBulkActionCommands(context, commandContext);
  registerBranchDomainCommands(context, commandContext);
  registerTagCommands(context, commandContext);
  registerStashCommands(context, commandContext);
  registerWorktreeCommands(context, commandContext);
}
