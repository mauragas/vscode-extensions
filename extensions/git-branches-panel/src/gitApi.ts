import * as vscode from 'vscode';
import { basename, sep } from 'node:path';

import { getRepoRoot } from './git/shared';

export interface GitApiRepository {
  readonly rootUri: vscode.Uri;
}

export interface GitApi {
  readonly repositories: readonly GitApiRepository[];
  getRepository(uri: vscode.Uri): GitApiRepository | null;
  toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
}

interface GitExtensionExports {
  getAPI(version: number): GitApi;
}

export interface WorkspaceRepositoryDescriptor {
  readonly repoRoot: string;
  readonly label: string;
  readonly description?: string;
}

export type RepositoryDescriptor = WorkspaceRepositoryDescriptor;

export async function getGitApi(): Promise<GitApi | undefined> {
  const extension = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
  if (!extension) {
    return undefined;
  }

  const exports = extension.isActive ? extension.exports : await extension.activate();
  if (!exports || typeof exports.getAPI !== 'function') {
    return undefined;
  }

  return exports.getAPI(1);
}

export async function getWorkspaceRepositories(): Promise<WorkspaceRepositoryDescriptor[]> {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  const gitApi = await getGitApi();
  const repositoryRoots = gitApi?.repositories.map((repository) => repository.rootUri.fsPath) ?? [];

  if (repositoryRoots.length > 0) {
    return toWorkspaceRepositoryDescriptors(repositoryRoots);
  }

  const resolvedRepositoryRoots = await Promise.all(
    workspaceFolders.map(async (workspaceFolder) => getRepoRoot(workspaceFolder.uri.fsPath))
  );

  return toWorkspaceRepositoryDescriptors(
    resolvedRepositoryRoots.filter((repoRoot): repoRoot is string => Boolean(repoRoot))
  );
}

export async function resolveRepoRootForUri(uri: vscode.Uri | undefined): Promise<string | undefined> {
  if (!uri) {
    return undefined;
  }

  const gitApi = await getGitApi();
  const repository = gitApi?.getRepository(uri);
  return repository?.rootUri.fsPath || undefined;
}

function toWorkspaceRepositoryDescriptors(
  repositoryRoots: readonly string[]
): WorkspaceRepositoryDescriptor[] {
  const uniqueRepositoryRoots = [...new Set(repositoryRoots.filter(Boolean))];

  return uniqueRepositoryRoots
    .map((repoRoot) => ({
      repoRoot,
      label: basename(repoRoot) || repoRoot,
      description: toRepositoryDescription(repoRoot),
    }))
    .sort(compareRepositoryDescriptors);
}

function toRepositoryDescription(repoRoot: string): string | undefined {
  const relativePath = vscode.workspace.asRelativePath(vscode.Uri.file(repoRoot), false);
  const label = basename(repoRoot) || repoRoot;

  return relativePath && relativePath !== label ? relativePath : undefined;
}

function compareRepositoryDescriptors(
  left: WorkspaceRepositoryDescriptor,
  right: WorkspaceRepositoryDescriptor
): number {
  const workspaceFolderOrderDelta =
    getWorkspaceFolderOrder(left.repoRoot) - getWorkspaceFolderOrder(right.repoRoot);

  if (workspaceFolderOrderDelta !== 0) {
    return workspaceFolderOrderDelta;
  }

  return left.repoRoot.localeCompare(right.repoRoot);
}

function getWorkspaceFolderOrder(repoRoot: string): number {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];

  for (const [index, workspaceFolder] of workspaceFolders.entries()) {
    if (
      repoRoot === workspaceFolder.uri.fsPath ||
      repoRoot.startsWith(`${workspaceFolder.uri.fsPath}${sep}`)
    ) {
      return index;
    }
  }

  return Number.MAX_SAFE_INTEGER;
}
