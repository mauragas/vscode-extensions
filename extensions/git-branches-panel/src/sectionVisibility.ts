import * as vscode from 'vscode';

import type { BranchSectionKey } from './treeDataLoader';

export type SectionVisibilityConfiguration = Record<BranchSectionKey, boolean>;

export const SECTION_VISIBILITY_DEFAULTS: SectionVisibilityConfiguration = {
  local: true,
  remote: true,
  remotes: false,
  stash: true,
  worktree: true,
  hooks: true,
  tags: true,
};

const SECTION_VISIBILITY_SETTING_KEYS: Record<BranchSectionKey, string> = {
  local: 'sections.local.visible',
  remote: 'sections.remote.visible',
  remotes: 'sections.remotes.visible',
  stash: 'sections.stash.visible',
  worktree: 'sections.worktree.visible',
  hooks: 'sections.hooks.visible',
  tags: 'sections.tags.visible',
};

const SECTION_ORDER: readonly BranchSectionKey[] = [
  'local',
  'remote',
  'remotes',
  'stash',
  'worktree',
  'hooks',
  'tags',
] as const;

const LEGACY_SHOW_REMOTES_SECTION_SETTING = 'showRemotesSection';

export function getSectionVisibilityConfiguration(
  configuration = vscode.workspace.getConfiguration('gitBranchesPanel')
): SectionVisibilityConfiguration {
  return {
    local: configuration.get<boolean>(
      SECTION_VISIBILITY_SETTING_KEYS.local,
      SECTION_VISIBILITY_DEFAULTS.local
    ),
    remote: configuration.get<boolean>(
      SECTION_VISIBILITY_SETTING_KEYS.remote,
      SECTION_VISIBILITY_DEFAULTS.remote
    ),
    remotes: resolveRemotesSectionVisibility(configuration),
    stash: configuration.get<boolean>(
      SECTION_VISIBILITY_SETTING_KEYS.stash,
      SECTION_VISIBILITY_DEFAULTS.stash
    ),
    worktree: configuration.get<boolean>(
      SECTION_VISIBILITY_SETTING_KEYS.worktree,
      SECTION_VISIBILITY_DEFAULTS.worktree
    ),
    hooks: configuration.get<boolean>(
      SECTION_VISIBILITY_SETTING_KEYS.hooks,
      SECTION_VISIBILITY_DEFAULTS.hooks
    ),
    tags: configuration.get<boolean>(
      SECTION_VISIBILITY_SETTING_KEYS.tags,
      SECTION_VISIBILITY_DEFAULTS.tags
    ),
  };
}

export function getVisibleSectionKeys(
  sectionVisibility: SectionVisibilityConfiguration = getSectionVisibilityConfiguration()
): BranchSectionKey[] {
  return SECTION_ORDER.filter((section) => sectionVisibility[section]);
}

function resolveRemotesSectionVisibility(
  configuration: vscode.WorkspaceConfiguration
): boolean {
  const explicitNewValue = getExplicitBooleanSetting(
    configuration,
    SECTION_VISIBILITY_SETTING_KEYS.remotes
  );
  if (explicitNewValue !== undefined) {
    return explicitNewValue;
  }

  const explicitLegacyValue = getExplicitBooleanSetting(
    configuration,
    LEGACY_SHOW_REMOTES_SECTION_SETTING
  );
  if (explicitLegacyValue !== undefined) {
    return explicitLegacyValue;
  }

  return SECTION_VISIBILITY_DEFAULTS.remotes;
}

function getExplicitBooleanSetting(
  configuration: vscode.WorkspaceConfiguration,
  key: string
): boolean | undefined {
  const inspected =
    typeof configuration.inspect === 'function'
      ? configuration.inspect<boolean>(key)
      : undefined;

  return (
    inspected?.workspaceFolderValue ??
    inspected?.workspaceValue ??
    inspected?.globalValue ??
    inspected?.globalLanguageValue ??
    inspected?.workspaceFolderLanguageValue ??
    inspected?.workspaceLanguageValue
  );
}
