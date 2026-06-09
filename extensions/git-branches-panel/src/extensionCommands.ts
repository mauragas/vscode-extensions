import * as vscode from 'vscode';

import { registerBranchDomainCommands } from './commands/branchCommands';
import { registerBulkActionCommands } from './commands/bulkActions';
import { registerHookCommands } from './commands/hookCommands';
import { registerHistoryCommands } from './commands/historyCommands';
import { registerItemCommands } from './commands/itemCommands';
import { registerRepositoryCommands } from './commands/repositoryCommands';
import { registerRemoteCommands } from './commands/remoteCommands';
import { registerSearchCommands } from './commands/searchCommands';
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
  registerRemoteCommands(context, commandContext);
  registerSearchCommands(context, commandContext);
  registerHistoryCommands(context, commandContext);
  registerBulkActionCommands(context, commandContext);
  registerItemCommands(context, commandContext);
  registerBranchDomainCommands(context, commandContext);
  registerTagCommands(context, commandContext);
  registerStashCommands(context, commandContext);
  registerHookCommands(context, commandContext);
  registerWorktreeCommands(context, commandContext);
}
