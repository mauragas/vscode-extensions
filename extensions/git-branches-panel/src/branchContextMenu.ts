import * as vscode from 'vscode';

export const BRANCH_CONTEXT_MENU_PRIMARY_ACTIONS_SETTING = 'branchContextMenu.primaryActions';

export const DEFAULT_BRANCH_CONTEXT_MENU_PRIMARY_ACTIONS = [
  'syncOrPublish',
  'checkout',
  'newBranchFromSelected',
  'newBranchFromSelectedAndCheckout',
  'createWorktree',
  'renameBranch',
  'createTag',
  'copyBranchName',
  'compareWithCurrent',
  'mergeIntoCurrent',
  'cherryPickIntoCurrent',
  'deleteOrCleanup',
] as const;

export type BranchContextMenuPrimaryActionId =
  (typeof DEFAULT_BRANCH_CONTEXT_MENU_PRIMARY_ACTIONS)[number];

const BRANCH_CONTEXT_MENU_PRIMARY_ACTION_SET = new Set<string>(
  DEFAULT_BRANCH_CONTEXT_MENU_PRIMARY_ACTIONS
);

export function registerBranchContextMenuContextKeys(
  context: vscode.ExtensionContext
): void {
  void updateBranchContextMenuContextKeys();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration(
          `gitBranchesPanel.${BRANCH_CONTEXT_MENU_PRIMARY_ACTIONS_SETTING}`
        )
      ) {
        void updateBranchContextMenuContextKeys();
      }
    })
  );
}

export function getConfiguredBranchContextMenuPrimaryActions(): BranchContextMenuPrimaryActionId[] {
  const configuredValue = vscode.workspace
    .getConfiguration('gitBranchesPanel')
    .get<unknown>(BRANCH_CONTEXT_MENU_PRIMARY_ACTIONS_SETTING, [
      ...DEFAULT_BRANCH_CONTEXT_MENU_PRIMARY_ACTIONS,
    ]);

  return normalizeBranchContextMenuPrimaryActions(configuredValue);
}

export function normalizeBranchContextMenuPrimaryActions(
  configuredValue: unknown
): BranchContextMenuPrimaryActionId[] {
  if (!Array.isArray(configuredValue)) {
    return [...DEFAULT_BRANCH_CONTEXT_MENU_PRIMARY_ACTIONS];
  }

  const normalizedActions: BranchContextMenuPrimaryActionId[] = [];

  for (const candidate of configuredValue) {
    if (typeof candidate !== 'string') {
      continue;
    }

    if (!BRANCH_CONTEXT_MENU_PRIMARY_ACTION_SET.has(candidate)) {
      continue;
    }

    if (normalizedActions.includes(candidate as BranchContextMenuPrimaryActionId)) {
      continue;
    }

    normalizedActions.push(candidate as BranchContextMenuPrimaryActionId);
  }

  if (configuredValue.length > 0 && normalizedActions.length === 0) {
    return [...DEFAULT_BRANCH_CONTEXT_MENU_PRIMARY_ACTIONS];
  }

  return normalizedActions;
}

export async function updateBranchContextMenuContextKeys(): Promise<void> {
  const configuredActions = getConfiguredBranchContextMenuPrimaryActions();

  await Promise.all(
    DEFAULT_BRANCH_CONTEXT_MENU_PRIMARY_ACTIONS.map((_, index) =>
      vscode.commands.executeCommand(
        'setContext',
        buildBranchContextMenuSlotContextKey(index + 1),
        configuredActions[index] ?? ''
      )
    )
  );
}

export function buildBranchContextMenuSlotContextKey(slot: number): string {
  return `gitBranchesPanel.branchContextMenu.slot${slot}`;
}
