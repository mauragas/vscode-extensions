import * as vscode from 'vscode';

import { registerAutoRefresh } from './autoRefresh';
import { registerBranchContextMenuContextKeys } from './branchContextMenu';
import { registerBranchCommands } from './extensionCommands';
import { BranchItemActivationTracker } from './extensionHelpers';
import { BranchTreeProvider } from './treeProvider';
import { registerBranchViews } from './viewRegistration';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new BranchTreeProvider(context);
  const activationTracker = new BranchItemActivationTracker();

  registerBranchContextMenuContextKeys(context);
  registerBranchViews(context, provider);
  registerBranchCommands(context, provider, activationTracker);
  registerAutoRefresh(context, provider, activationTracker);
}

export function deactivate(): void {}
