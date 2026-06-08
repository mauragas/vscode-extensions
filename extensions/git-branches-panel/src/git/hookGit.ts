import { chmod, readdir, rename, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { type BranchInfo, type HookSource } from '../branchModel';
import { readGitConfig, runGit } from './shared';

const DISABLED_HOOK_SUFFIX = '.disabled';
const KNOWN_GIT_HOOK_NAMES = [
  'applypatch-msg',
  'commit-msg',
  'fsmonitor-watchman',
  'post-applypatch',
  'post-checkout',
  'post-commit',
  'post-index-change',
  'post-merge',
  'post-receive',
  'post-rewrite',
  'post-update',
  'pre-applypatch',
  'pre-auto-gc',
  'pre-commit',
  'pre-merge-commit',
  'pre-push',
  'pre-rebase',
  'pre-receive',
  'prepare-commit-msg',
  'proc-receive',
  'push-to-checkout',
  'reference-transaction',
  'sendemail-validate',
  'update',
] as const;

interface HookSourceDirectory {
  readonly path: string;
  readonly source: HookSource;
  readonly activeSource: boolean;
}

interface HookToggleTarget {
  readonly hookEnabled?: boolean;
  readonly hookPath: string;
}

export async function getHooks(repoRoot: string): Promise<BranchInfo[]> {
  const gitDir = await getGitDirectory(repoRoot);
  const localHooksPath = join(gitDir, 'hooks');
  const configuredHooksPath = await readGitConfig(repoRoot, 'core.hooksPath');

  const hookSources: HookSourceDirectory[] = [];

  if (!configuredHooksPath) {
    hookSources.push({
      path: localHooksPath,
      source: 'local',
      activeSource: true,
    });
  } else {
    const activeHooksPath = await getActiveHooksPath(repoRoot);
    if (activeHooksPath === localHooksPath) {
      hookSources.push({
        path: localHooksPath,
        source: 'local',
        activeSource: true,
      });
    } else {
      if (await hasHookArtifacts(activeHooksPath)) {
        hookSources.push({
          path: activeHooksPath,
          source: 'shared',
          activeSource: true,
        });
      }

      hookSources.push({
        path: localHooksPath,
        source: 'local',
        activeSource: false,
      });
    }
  }

  const hooks = await Promise.all(
    hookSources.map((hookSource) => collectHooksFromDirectory(repoRoot, hookSource))
  );

  return hooks.flat();
}

export async function setHookEnabled(
  target: HookToggleTarget,
  enabled: boolean
): Promise<void> {
  if (target.hookEnabled === enabled) {
    return;
  }

  if (enabled) {
    await enableHook(target);
    return;
  }

  await disableHook(target);
}

async function collectHooksFromDirectory(
  repoRoot: string,
  hookSource: HookSourceDirectory
): Promise<BranchInfo[]> {
  const entries = await listDirectoryEntries(hookSource.path);
  if (entries.length === 0) {
    return [];
  }

  const entryNames = new Set(entries);

  const hooks: Array<BranchInfo | undefined> = await Promise.all(
    KNOWN_GIT_HOOK_NAMES.map(async (hookName) => {
      const enabledHookPath = join(hookSource.path, hookName);
      const disabledHookPath = `${enabledHookPath}${DISABLED_HOOK_SUFFIX}`;

      const enabledEntryExists = entryNames.has(hookName);
      const disabledEntryExists = entryNames.has(`${hookName}${DISABLED_HOOK_SUFFIX}`);
      if (!enabledEntryExists && !disabledEntryExists) {
        return undefined;
      }

      const hookPath = enabledEntryExists ? enabledHookPath : disabledHookPath;
      const hookStats = await stat(hookPath);
      if (!hookStats.isFile()) {
        return undefined;
      }

      const hookEnabled = enabledEntryExists
        ? isHookEnabled(hookStats.mode)
        : false;

      return {
        name: `${hookName} · ${hookSource.source}`,
        isCurrent: false,
        scope: 'hook',
        hookName,
        hookSource: hookSource.source,
        hookEnabled,
        hookActive: hookSource.activeSource && hookEnabled,
        hookOverridden: !hookSource.activeSource && hookEnabled,
        hookPath,
        hookRelativePath: toRelativeHookPath(repoRoot, hookPath),
      } satisfies BranchInfo;
    })
  );

  return hooks.flatMap((hook) => (hook ? [hook] : []));
}

async function enableHook(target: HookToggleTarget): Promise<void> {
  if (target.hookPath.endsWith(DISABLED_HOOK_SUFFIX)) {
    const restoredPath = target.hookPath.slice(0, -DISABLED_HOOK_SUFFIX.length);
    await rename(target.hookPath, restoredPath);

    if (shouldToggleHookByRename()) {
      return;
    }

    await ensureHookIsExecutable(restoredPath);
    return;
  }

  if (shouldToggleHookByRename()) {
    return;
  }

  await ensureHookIsExecutable(target.hookPath);
}

async function disableHook(target: HookToggleTarget): Promise<void> {
  if (target.hookPath.endsWith(DISABLED_HOOK_SUFFIX)) {
    return;
  }

  if (shouldToggleHookByRename()) {
    await rename(target.hookPath, `${target.hookPath}${DISABLED_HOOK_SUFFIX}`);
    return;
  }

  const hookStats = await stat(target.hookPath);
  await chmod(target.hookPath, hookStats.mode & ~0o111);
}

async function ensureHookIsExecutable(hookPath: string): Promise<void> {
  const hookStats = await stat(hookPath);
  await chmod(hookPath, hookStats.mode | 0o111);
}

async function hasHookArtifacts(directoryPath: string): Promise<boolean> {
  const entries = await listDirectoryEntries(directoryPath);
  if (entries.length === 0) {
    return false;
  }

  const entryNames = new Set(entries);
  return KNOWN_GIT_HOOK_NAMES.some(
    (hookName) =>
      entryNames.has(hookName) || entryNames.has(`${hookName}${DISABLED_HOOK_SUFFIX}`)
  );
}

async function listDirectoryEntries(directoryPath: string): Promise<string[]> {
  try {
    return await readdir(directoryPath);
  } catch {
    return [];
  }
}

async function getGitDirectory(repoRoot: string): Promise<string> {
  const { stdout } = await runGit(repoRoot, ['rev-parse', '--absolute-git-dir']);
  return stdout.trim();
}

async function getActiveHooksPath(repoRoot: string): Promise<string> {
  const { stdout } = await runGit(repoRoot, ['rev-parse', '--git-path', 'hooks']);
  return resolveGitPath(repoRoot, stdout.trim());
}

function resolveGitPath(repoRoot: string, gitPath: string): string {
  return isAbsolute(gitPath) ? gitPath : resolve(repoRoot, gitPath);
}

function isHookEnabled(mode: number): boolean {
  if (process.platform === 'win32') {
    return true;
  }

  return Boolean(mode & 0o111);
}

function shouldToggleHookByRename(): boolean {
  return process.platform === 'win32';
}

function toRelativeHookPath(repoRoot: string, hookPath: string): string {
  const relativePath = relative(repoRoot, hookPath);
  return relativePath && !relativePath.startsWith('..') ? relativePath : hookPath;
}
