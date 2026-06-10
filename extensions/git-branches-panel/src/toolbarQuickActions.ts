import * as vscode from 'vscode';

export const SINGLE_REPOSITORY_TOOLBAR_QUICK_ACTIONS_SETTING =
  'toolbar.singleRepository.quickActions';
export const MULTI_REPOSITORY_TOOLBAR_QUICK_ACTIONS_SETTING =
  'toolbar.multiRepository.quickActions';

export const TOOLBAR_QUICK_ACTION_IDS = [
  'newBranch',
  'stashSilently',
  'findRef',
  'currentBranchAction',
  'pullAllLocalBranches',
  'pullAllRepositoriesChanges',
  'fetchAll',
  'fetchAllPrune',
  'refresh',
  'selectRepository',
  'clearFilter',
  'advancedActions',
  'settings',
] as const;

export type ToolbarQuickActionId = (typeof TOOLBAR_QUICK_ACTION_IDS)[number];
export type ToolbarQuickActionScope = 'singleRepository' | 'multiRepository';

export const DEFAULT_SINGLE_REPOSITORY_TOOLBAR_QUICK_ACTIONS = [
  'findRef',
  'pullAllLocalBranches',
  'fetchAllPrune',
  'refresh',
  'advancedActions',
  'settings',
] as const;

export const DEFAULT_MULTI_REPOSITORY_TOOLBAR_QUICK_ACTIONS = [
  'findRef',
  'currentBranchAction',
  'pullAllRepositoriesChanges',
  'fetchAllPrune',
  'refresh',
  'advancedActions',
  'settings',
] as const;

const MAX_TOOLBAR_QUICK_ACTION_SLOTS = TOOLBAR_QUICK_ACTION_IDS.length;
const TOOLBAR_QUICK_ACTION_ID_SET = new Set<string>(TOOLBAR_QUICK_ACTION_IDS);

const LEGACY_TOOLBAR_QUICK_ACTION_SETTINGS: Partial<
  Record<ToolbarQuickActionId, { readonly setting: string; readonly defaultValue: boolean }>
> = {
  newBranch: {
    setting: 'toolbar.showNewBranch',
    defaultValue: true,
  },
  stashSilently: {
    setting: 'toolbar.showStashSilently',
    defaultValue: false,
  },
  currentBranchAction: {
    setting: 'toolbar.showCurrentBranchAction',
    defaultValue: true,
  },
  pullAllRepositoriesChanges: {
    setting: 'toolbar.showPullAllRepositoriesChanges',
    defaultValue: true,
  },
  fetchAll: {
    setting: 'toolbar.showFetchAll',
    defaultValue: true,
  },
  fetchAllPrune: {
    setting: 'toolbar.showFetchAllPrune',
    defaultValue: true,
  },
  refresh: {
    setting: 'toolbar.showRefresh',
    defaultValue: true,
  },
  advancedActions: {
    setting: 'toolbar.showAdvancedActions',
    defaultValue: true,
  },
  settings: {
    setting: 'toolbar.showSettings',
    defaultValue: true,
  },
};

export function registerToolbarQuickActionContextKeys(
  context: vscode.ExtensionContext
): void {
  void updateToolbarQuickActionContextKeys();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('gitBranchesPanel.toolbar')) {
        void updateToolbarQuickActionContextKeys();
      }
    })
  );
}

export function getConfiguredSingleRepositoryToolbarQuickActions(): ToolbarQuickActionId[] {
  return getConfiguredToolbarQuickActions('singleRepository');
}

export function getConfiguredMultiRepositoryToolbarQuickActions(): ToolbarQuickActionId[] {
  return getConfiguredToolbarQuickActions('multiRepository');
}

export function getConfiguredToolbarQuickActions(
  scope: ToolbarQuickActionScope,
  configuration: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration('gitBranchesPanel')
): ToolbarQuickActionId[] {
  const defaultActions = getDefaultToolbarQuickActions(scope);
  const setting = getToolbarQuickActionsSetting(scope);

  if (hasExplicitConfigurationValue(configuration, setting)) {
    return normalizeToolbarQuickActions(
      configuration.get<unknown>(setting, [...defaultActions]),
      defaultActions
    );
  }

  return defaultActions.filter((actionId) =>
    isLegacyToolbarQuickActionEnabled(actionId, configuration)
  );
}

export function normalizeToolbarQuickActions(
  configuredValue: unknown,
  fallbackActions: readonly ToolbarQuickActionId[]
): ToolbarQuickActionId[] {
  if (!Array.isArray(configuredValue)) {
    return [...fallbackActions];
  }

  const normalizedActions: ToolbarQuickActionId[] = [];

  for (const candidate of configuredValue) {
    if (typeof candidate !== 'string') {
      continue;
    }

    if (!TOOLBAR_QUICK_ACTION_ID_SET.has(candidate)) {
      continue;
    }

    if (normalizedActions.includes(candidate as ToolbarQuickActionId)) {
      continue;
    }

    normalizedActions.push(candidate as ToolbarQuickActionId);
  }

  if (configuredValue.length > 0 && normalizedActions.length === 0) {
    return [...fallbackActions];
  }

  return normalizedActions;
}

export async function updateToolbarQuickActionContextKeys(): Promise<void> {
  const singleRepositoryActions = getConfiguredSingleRepositoryToolbarQuickActions();
  const multiRepositoryActions = getConfiguredMultiRepositoryToolbarQuickActions();

  await Promise.all([
    ...buildToolbarQuickActionContextUpdates('singleRepository', singleRepositoryActions),
    ...buildToolbarQuickActionContextUpdates('multiRepository', multiRepositoryActions),
  ]);
}

export function buildToolbarQuickActionSlotContextKey(
  scope: ToolbarQuickActionScope,
  slot: number
): string {
  return `gitBranchesPanel.toolbar.${scope}.slot${slot}`;
}

function getDefaultToolbarQuickActions(
  scope: ToolbarQuickActionScope
): readonly ToolbarQuickActionId[] {
  return scope === 'singleRepository'
    ? DEFAULT_SINGLE_REPOSITORY_TOOLBAR_QUICK_ACTIONS
    : DEFAULT_MULTI_REPOSITORY_TOOLBAR_QUICK_ACTIONS;
}

function getToolbarQuickActionsSetting(scope: ToolbarQuickActionScope): string {
  return scope === 'singleRepository'
    ? SINGLE_REPOSITORY_TOOLBAR_QUICK_ACTIONS_SETTING
    : MULTI_REPOSITORY_TOOLBAR_QUICK_ACTIONS_SETTING;
}

function hasExplicitConfigurationValue(
  configuration: vscode.WorkspaceConfiguration,
  setting: string
): boolean {
  if (typeof configuration.inspect !== 'function') {
    return false;
  }

  const inspected = configuration.inspect<unknown>(setting);
  return Boolean(
    inspected &&
      (inspected.globalValue !== undefined ||
        inspected.workspaceValue !== undefined ||
        inspected.workspaceFolderValue !== undefined ||
        inspected.globalLanguageValue !== undefined ||
        inspected.workspaceLanguageValue !== undefined ||
        inspected.workspaceFolderLanguageValue !== undefined)
  );
}

function isLegacyToolbarQuickActionEnabled(
  actionId: ToolbarQuickActionId,
  configuration: vscode.WorkspaceConfiguration
): boolean {
  const legacySetting = LEGACY_TOOLBAR_QUICK_ACTION_SETTINGS[actionId];
  if (!legacySetting) {
    return true;
  }

  return configuration.get<boolean>(legacySetting.setting, legacySetting.defaultValue);
}

function buildToolbarQuickActionContextUpdates(
  scope: ToolbarQuickActionScope,
  configuredActions: readonly ToolbarQuickActionId[]
): Thenable<unknown>[] {
  return Array.from({ length: MAX_TOOLBAR_QUICK_ACTION_SLOTS }, (_, index) =>
    vscode.commands.executeCommand(
      'setContext',
      buildToolbarQuickActionSlotContextKey(scope, index + 1),
      configuredActions[index] ?? ''
    )
  );
}
