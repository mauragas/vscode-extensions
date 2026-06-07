import type { BranchInfo } from './branchModel';
import { sanitizeNewBranchName } from './extensionHelpers';

export const DEFAULT_PROTECTED_BRANCH_NAMES = ['main', 'master', 'develop'] as const;
export const DEFAULT_NEW_BRANCH_PREFIXES = ['feature', 'bugfix', 'hotfix'] as const;

export function normalizeConfiguredBranchNames(
  values: readonly string[] | undefined
): string[] {
  if (!values) {
    return [];
  }

  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function normalizeConfiguredBranchPrefixes(
  values: readonly string[] | undefined
): string[] {
  return [...new Set(
    normalizeConfiguredBranchNames(values)
      .map((value) => sanitizeNewBranchName(value).replace(/^\/+|\/+$/gu, ''))
      .filter(Boolean)
  )];
}

export function isBranchProtectedFromDeletion(
  branch: Pick<BranchInfo, 'name' | 'scope'>,
  protectedBranchNames: readonly string[]
): boolean {
  const normalizedProtectedNames = new Set(
    normalizeConfiguredBranchNames(protectedBranchNames).map((name) => name.toLowerCase())
  );

  if (normalizedProtectedNames.size === 0) {
    return false;
  }

  return getProtectedBranchNameCandidates(branch).some((candidate) =>
    normalizedProtectedNames.has(candidate.toLowerCase())
  );
}

function getProtectedBranchNameCandidates(
  branch: Pick<BranchInfo, 'name' | 'scope'>
): string[] {
  if ((branch.scope ?? 'local') !== 'remote') {
    return [branch.name];
  }

  const [_remoteName, ...branchSegments] = branch.name.split('/');
  const remoteBranchName = branchSegments.join('/').trim();

  return [branch.name, remoteBranchName].filter(Boolean);
}
