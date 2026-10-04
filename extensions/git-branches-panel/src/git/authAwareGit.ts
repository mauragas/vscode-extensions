import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { GitApiFetchOptions, GitApiRepository } from '../gitApi';

const execFileAsync = promisify(execFile);
const GIT_COMMAND_MAX_BUFFER = 10 * 1024 * 1024;

type GitNetworkFailureKind =
  | 'authentication'
  | 'credentialPrompt'
  | 'ssh'
  | 'network'
  | 'tls'
  | 'repositoryAccess';

interface BuiltInGitExecutor {
  exec(workingDirectory: string, args: string[]): Promise<{ stdout: string; stderr: string }>;
}

export interface GitCommandError extends Error {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  gitErrorCode?: string;
  gitCommand?: string;
  gitArgs?: readonly string[];
  cause?: unknown;
}

export interface GitWithBuiltInAuthDependencies {
  loadBuiltInRepository(repoRoot: string): Promise<GitApiRepository | undefined>;
  loadBuiltInExecutor(repoRoot: string): Promise<BuiltInGitExecutor | undefined>;
}

const defaultDependencies: GitWithBuiltInAuthDependencies = {
  loadBuiltInRepository: loadBuiltInGitRepository,
  loadBuiltInExecutor: loadBuiltInGitExecutor,
};

export const BUILT_IN_FORCE_PUSH_MODE = {
  Force: 0,
  ForceWithLease: 1,
  ForceWithLeaseIfIncludes: 2,
} as const;

export async function runGitWithBuiltInAuth(
  repoRoot: string,
  workingDirectory: string,
  args: string[],
  runRawGit: (workingDirectory: string, args: string[]) => Promise<{ stdout: string; stderr: string }>,
  overrides: Partial<GitWithBuiltInAuthDependencies> = {}
): Promise<{ stdout: string; stderr: string }> {
  const dependencies: GitWithBuiltInAuthDependencies = {
    ...defaultDependencies,
    ...overrides,
  };

  const builtInExecutor = await dependencies.loadBuiltInExecutor(repoRoot);

  try {
    if (builtInExecutor) {
      return await builtInExecutor.exec(workingDirectory, args);
    }

    return await runRawGit(workingDirectory, args);
  } catch (error) {
    throw createGitCommandError(error, args, { classifyNetworkFailures: true });
  }
}

export async function fetchWithBuiltInGit(
  repoRoot: string,
  options: GitApiFetchOptions,
  fallback: () => Promise<void>,
  overrides: Partial<GitWithBuiltInAuthDependencies> = {}
): Promise<void> {
  const dependencies = {
    ...defaultDependencies,
    ...overrides,
  };

  const args = buildFetchArgs(options);
  const repository = await dependencies.loadBuiltInRepository(repoRoot);

  try {
    if (repository?.fetch) {
      await repository.fetch(options);
      return;
    }

    await fallback();
  } catch (error) {
    throw createGitCommandError(error, args, { classifyNetworkFailures: true });
  }
}

export async function pushWithBuiltInGit(
  repoRoot: string,
  options: {
    remoteName?: string;
    refspec?: string;
    setUpstream?: boolean;
    forcePushMode?: number;
  },
  fallback: () => Promise<void>,
  overrides: Partial<GitWithBuiltInAuthDependencies> = {}
): Promise<void> {
  const dependencies = {
    ...defaultDependencies,
    ...overrides,
  };

  const args = buildPushArgs(options);
  const repository = await dependencies.loadBuiltInRepository(repoRoot);

  try {
    if (repository?.push) {
      await repository.push(
        options.remoteName,
        options.refspec,
        options.setUpstream ?? false,
        options.forcePushMode
      );
      return;
    }

    await fallback();
  } catch (error) {
    throw createGitCommandError(error, args, { classifyNetworkFailures: true });
  }
}

export async function pushTagsWithBuiltInGit(
  repoRoot: string,
  remoteName: string,
  fallback: () => Promise<void>,
  overrides: Partial<GitWithBuiltInAuthDependencies> = {}
): Promise<void> {
  const dependencies = {
    ...defaultDependencies,
    ...overrides,
  };

  const args = ['push', remoteName, '--tags'];
  const repository = await dependencies.loadBuiltInRepository(repoRoot);
  const pushTags = getRepositoryPushTags(repository);

  try {
    if (pushTags) {
      await pushTags(remoteName);
      return;
    }

    await fallback();
  } catch (error) {
    throw createGitCommandError(error, args, { classifyNetworkFailures: true });
  }
}

export async function listRemoteRefsWithBuiltInGit(
  repoRoot: string,
  remoteName: string,
  options: {
    heads?: boolean;
    tags?: boolean;
  },
  fallback: () => Promise<readonly string[]>,
  overrides: Partial<GitWithBuiltInAuthDependencies> = {}
): Promise<readonly string[]> {
  const dependencies = {
    ...defaultDependencies,
    ...overrides,
  };

  const args = buildListRemoteRefsArgs(remoteName, options);
  const repository = await dependencies.loadBuiltInRepository(repoRoot);

  try {
    if (typeof repository?.getRemoteRefs === 'function') {
      const refs = await repository.getRemoteRefs(remoteName, options);
      return refs
        .map((ref) => normalizeRemoteRefName(ref.name))
        .filter((refName): refName is string => Boolean(refName));
    }

    return await fallback();
  } catch (error) {
    throw createGitCommandError(error, args, { classifyNetworkFailures: true });
  }
}

export function createGitCommandError(
  error: unknown,
  args: readonly string[],
  options: {
    classifyNetworkFailures: boolean;
  }
): GitCommandError {
  const normalizedError = normalizeGitCommandError(error, args);

  if (!options.classifyNetworkFailures) {
    return normalizedError;
  }

  const networkFailure = classifyGitNetworkError(normalizedError, args);
  if (!networkFailure) {
    return normalizedError;
  }

  const combinedMessage = buildGitNetworkFailureMessage(networkFailure);
  if (normalizedError.message === combinedMessage) {
    return normalizedError;
  }

  return cloneGitCommandError(normalizedError, combinedMessage);
}

export function classifyGitNetworkError(
  error: unknown,
  args: readonly string[]
): {
  kind: GitNetworkFailureKind;
  summary: string;
  detail: string;
  gitErrorCode?: string;
} | undefined {
  const detail = getGitErrorDetail(error, 'Unknown git error');
  const gitErrorCode = getGitErrorCode(error);
  const operation = describeNetworkOperation(args);

  if (
    /could not read username/i.test(detail) ||
    /terminal prompts disabled/i.test(detail) ||
    /askpass/i.test(detail)
  ) {
    return {
      kind: 'credentialPrompt',
      summary: `Git could not prompt for credentials while ${operation}.`,
      detail,
      gitErrorCode,
    };
  }

  if (
    /permission denied \(publickey\)/i.test(detail) ||
    /sign_and_send_pubkey/i.test(detail) ||
    /enter passphrase for key/i.test(detail) ||
    /could not open a connection to your authentication agent/i.test(detail)
  ) {
    return {
      kind: 'ssh',
      summary: `SSH authentication failed while ${operation}.`,
      detail,
      gitErrorCode,
    };
  }

  if (gitErrorCode === 'AuthenticationFailed' || /authentication failed/i.test(detail)) {
    return {
      kind: 'authentication',
      summary: `Authentication failed while ${operation}.`,
      detail,
      gitErrorCode,
    };
  }

  if (
    /ssl/i.test(detail) ||
    /tls/i.test(detail) ||
    /certificate/i.test(detail)
  ) {
    return {
      kind: 'tls',
      summary: `TLS/SSL error while ${operation}.`,
      detail,
      gitErrorCode,
    };
  }

  if (
    gitErrorCode === 'RemoteConnectionError' ||
    /could not resolve host/i.test(detail) ||
    /failed to connect/i.test(detail) ||
    /timed out/i.test(detail) ||
    /network is unreachable/i.test(detail) ||
    /connection refused/i.test(detail) ||
    /could not read from remote repository/i.test(detail)
  ) {
    return {
      kind: 'network',
      summary: `Network error while ${operation}.`,
      detail,
      gitErrorCode,
    };
  }

  if (
    gitErrorCode === 'RepositoryNotFound' ||
    gitErrorCode === 'PermissionDenied' ||
    gitErrorCode === 'NoRemoteRepositorySpecified' ||
    /repository not found/i.test(detail) ||
    /permission denied/i.test(detail) ||
    /access denied/i.test(detail)
  ) {
    return {
      kind: 'repositoryAccess',
      summary: `The remote repository could not be accessed while ${operation}.`,
      detail,
      gitErrorCode,
    };
  }

  return undefined;
}

async function loadBuiltInGitExecutor(repoRoot: string): Promise<BuiltInGitExecutor | undefined> {
  try {
    const { getGitApi } = await import('../gitApi');
    const gitApi = await getGitApi();
    const gitPath = gitApi?.git?.path?.trim();

    if (!gitPath) {
      return undefined;
    }

    const env = toBuiltInGitEnvironment(gitApi?.git?.env);

    return {
      exec: async (workingDirectory, args) =>
        executeGitWithBuiltInRuntime(gitPath, env, workingDirectory, args),
    };
  } catch {
    return undefined;
  }
}

async function loadBuiltInGitRepository(repoRoot: string): Promise<GitApiRepository | undefined> {
  try {
    const { getRepositoryForRoot } = await import('../gitApi');
    return await getRepositoryForRoot(repoRoot);
  } catch {
    return undefined;
  }
}

function getRepositoryPushTags(
  repository: GitApiRepository | undefined
): ((remoteName?: string) => Promise<void>) | undefined {
  const candidate = repository as (GitApiRepository & {
    pushTags?: (remoteName?: string) => Promise<void>;
  }) | undefined;

  return typeof candidate?.pushTags === 'function'
    ? candidate.pushTags.bind(candidate)
    : undefined;
}

function normalizeGitCommandError(
  error: unknown,
  args: readonly string[]
): GitCommandError {
  if (isGitCommandError(error) && Array.isArray(error.gitArgs)) {
    return error;
  }

  const normalizedError = new Error(getGitErrorDetail(error, 'Unknown git error')) as GitCommandError;
  const source = error as {
    stdout?: unknown;
    stderr?: unknown;
    exitCode?: unknown;
    code?: unknown;
    gitErrorCode?: unknown;
    gitCommand?: unknown;
    gitArgs?: unknown;
  } | undefined;

  normalizedError.name = error instanceof Error ? error.name : 'Error';
  normalizedError.stdout = typeof source?.stdout === 'string' ? source.stdout : undefined;
  normalizedError.stderr = typeof source?.stderr === 'string' ? source.stderr : undefined;
  normalizedError.exitCode =
    typeof source?.exitCode === 'number'
      ? source.exitCode
      : typeof source?.code === 'number'
        ? source.code
        : undefined;
  normalizedError.gitErrorCode =
    typeof source?.gitErrorCode === 'string' ? source.gitErrorCode : undefined;
  normalizedError.gitCommand =
    typeof source?.gitCommand === 'string' ? source.gitCommand : 'git';
  normalizedError.gitArgs =
    Array.isArray(source?.gitArgs) && source.gitArgs.every((arg) => typeof arg === 'string')
      ? [...source.gitArgs]
      : [...args];
  normalizedError.cause = error;

  return normalizedError;
}

function cloneGitCommandError(error: GitCommandError, message: string): GitCommandError {
  const clonedError = new Error(message) as GitCommandError;
  clonedError.name = error.name;
  clonedError.stdout = error.stdout;
  clonedError.stderr = error.stderr;
  clonedError.exitCode = error.exitCode;
  clonedError.gitErrorCode = error.gitErrorCode;
  clonedError.gitCommand = error.gitCommand;
  clonedError.gitArgs = error.gitArgs ? [...error.gitArgs] : undefined;
  clonedError.cause = error.cause ?? error;

  return clonedError;
}

function buildGitNetworkFailureMessage(networkFailure: {
  summary: string;
  detail: string;
}): string {
  const normalizedSummary = networkFailure.summary.trim();
  const normalizedDetail = networkFailure.detail.trim();
  if (!normalizedDetail || normalizedDetail === normalizedSummary) {
    return normalizedSummary;
  }

  return `${normalizedSummary} ${normalizedDetail}`;
}

function describeNetworkOperation(args: readonly string[]): string {
  const [command = ''] = args;

  switch (command) {
    case 'fetch':
      return 'fetching from the remote';
    case 'pull':
      return 'pulling from the remote';
    case 'push':
      return 'pushing to the remote';
    default:
      return 'contacting the remote';
  }
}

function getGitErrorCode(error: unknown): string | undefined {
  return isGitCommandError(error) && typeof error.gitErrorCode === 'string'
    ? error.gitErrorCode
    : undefined;
}

function getGitErrorDetail(error: unknown, fallback: string): string {
  const stderr = isGitCommandError(error) ? error.stderr?.trim() : undefined;
  if (stderr) {
    return stderr;
  }

  const stdout = isGitCommandError(error) ? error.stdout?.trim() : undefined;
  if (stdout) {
    return stdout;
  }

  const message =
    error instanceof Error
      ? error.message.trim()
      : typeof error === 'string'
        ? error.trim()
        : fallback;

  return message || fallback;
}

function isGitCommandError(error: unknown): error is GitCommandError {
  return Boolean(error && typeof error === 'object' && 'message' in error);
}

function buildFetchArgs(options: GitApiFetchOptions): string[] {
  const args = ['fetch'];

  if (options.remote) {
    args.push(options.remote);
    if (options.ref) {
      args.push(options.ref);
    }
  } else if (options.all) {
    args.push('--all');
  }

  if (options.prune) {
    args.push('--prune');
  }

  if (typeof options.depth === 'number') {
    args.push(`--depth=${options.depth}`);
  }

  return args;
}

function buildPushArgs(options: {
  remoteName?: string;
  refspec?: string;
  setUpstream?: boolean;
  forcePushMode?: number;
}): string[] {
  const args = ['push'];

  if (options.forcePushMode === BUILT_IN_FORCE_PUSH_MODE.ForceWithLease) {
    args.push('--force-with-lease');
  } else if (options.forcePushMode === BUILT_IN_FORCE_PUSH_MODE.ForceWithLeaseIfIncludes) {
    args.push('--force-with-lease', '--force-if-includes');
  } else if (options.forcePushMode === BUILT_IN_FORCE_PUSH_MODE.Force) {
    args.push('--force');
  }

  if (options.setUpstream) {
    args.push('-u');
  }

  if (options.remoteName) {
    args.push(options.remoteName);
  }

  if (options.refspec) {
    args.push(options.refspec);
  }

  return args;
}

function buildListRemoteRefsArgs(
  remoteName: string,
  options: {
    heads?: boolean;
    tags?: boolean;
  }
): string[] {
  const args = ['ls-remote'];

  if (options.heads) {
    args.push('--heads');
  }

  if (options.tags) {
    args.push('--tags');
  }

  if (options.tags && !options.heads) {
    args.push('--refs');
  }

  args.push(remoteName);
  return args;
}

function normalizeRemoteRefName(refName: string | undefined): string | undefined {
  return refName?.trim().replace(/^refs\/(?:tags|heads)\//u, '');
}

function toBuiltInGitEnvironment(
  env: Readonly<Record<string, string>> | undefined
): NodeJS.ProcessEnv | undefined {
  if (!env || Object.keys(env).length === 0) {
    return undefined;
  }

  return {
    ...process.env,
    ...env,
  };
}

async function executeGitWithBuiltInRuntime(
  gitPath: string,
  env: NodeJS.ProcessEnv | undefined,
  workingDirectory: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(gitPath, args, {
    cwd: workingDirectory,
    encoding: 'utf8',
    env,
    maxBuffer: GIT_COMMAND_MAX_BUFFER,
  });
}
