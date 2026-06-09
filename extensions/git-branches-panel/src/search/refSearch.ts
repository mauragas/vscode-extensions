import {
  buildBranchDescription,
  isPublishableBranch,
  type BranchInfo,
  type BranchTreeNode,
  type TreeBranch,
  type TreeChildNode,
  type TreeContainerScope,
  type TreeFolder,
  type TreeRepository,
  type TreeSection,
} from '../branchModel';

export type RefFilterScope = TreeContainerScope;
export type RefFilterStateFlag = 'pinned' | 'stale' | 'missingUpstream' | 'publishable' | 'current';
export type RefFilterPreset = 'needsAttention';

export interface ParsedRefQuery {
  readonly rawQuery: string;
  readonly textTerms: readonly string[];
  readonly scopes: readonly RefFilterScope[];
  readonly states: readonly RefFilterStateFlag[];
}

export interface RefFilterState extends ParsedRefQuery {
  readonly showOnlyPinned: boolean;
  readonly preset?: RefFilterPreset;
}

export interface SearchCandidate {
  readonly node: TreeBranch;
  readonly repoLabel?: string;
  readonly repoDescription?: string;
  readonly scope: RefFilterScope;
  readonly score: number;
  readonly searchText: string;
  readonly description: string;
  readonly detail?: string;
}

const ALL_SCOPES = new Set<RefFilterScope>(['local', 'remote', 'tag', 'stash', 'worktree', 'hook']);
const ALL_STATES = new Set<RefFilterStateFlag>([
  'pinned',
  'stale',
  'missingUpstream',
  'publishable',
  'current',
]);
const NEEDS_ATTENTION_STATES: readonly RefFilterStateFlag[] = [
  'stale',
  'missingUpstream',
  'publishable',
];

export function createRefFilterState(
  rawQuery = '',
  options: {
    showOnlyPinned?: boolean;
    preset?: RefFilterPreset;
  } = {}
): RefFilterState {
  const parsedQuery = parseRefQuery(rawQuery);

  return {
    ...parsedQuery,
    showOnlyPinned: options.showOnlyPinned ?? false,
    preset: options.preset,
  };
}

export function createNeedsAttentionFilterState(): RefFilterState {
  return {
    ...parseRefQuery(''),
    showOnlyPinned: false,
    preset: 'needsAttention',
  };
}

export function clearRefFilterState(): RefFilterState {
  return createRefFilterState('');
}

export function parseRefQuery(rawQuery: string): ParsedRefQuery {
  const textTerms: string[] = [];
  const scopes = new Set<RefFilterScope>();
  const states = new Set<RefFilterStateFlag>();

  for (const token of rawQuery.split(/\s+/u).map((part) => part.trim()).filter(Boolean)) {
    const [rawPrefix = '', ...rest] = token.split(':');
    const prefix = rawPrefix.toLowerCase();
    const suffix = rest.join(':').trim();

    if (ALL_SCOPES.has(prefix as RefFilterScope)) {
      scopes.add(prefix as RefFilterScope);
      if (suffix) {
        textTerms.push(suffix.toLowerCase());
      }
      continue;
    }

    if (prefix === 'state' && suffix) {
      for (const stateCandidate of suffix.split(',').map((part) => part.trim().toLowerCase())) {
        if (ALL_STATES.has(stateCandidate as RefFilterStateFlag)) {
          states.add(stateCandidate as RefFilterStateFlag);
        }
      }
      continue;
    }

    textTerms.push(token.toLowerCase());
  }

  return {
    rawQuery,
    textTerms,
    scopes: [...scopes],
    states: [...states],
  };
}

export function hasActiveFilter(filterState: RefFilterState): boolean {
  return Boolean(
    filterState.rawQuery.trim() ||
      filterState.showOnlyPinned ||
      filterState.preset ||
      filterState.scopes.length > 0 ||
      filterState.states.length > 0
  );
}

export function buildFilterSummary(filterState: RefFilterState): string {
  if (!hasActiveFilter(filterState)) {
    return '';
  }

  const parts: string[] = [];

  if (filterState.preset === 'needsAttention') {
    parts.push('needs attention');
  }

  if (filterState.rawQuery.trim()) {
    parts.push(`query: ${filterState.rawQuery.trim()}`);
  }

  if (filterState.showOnlyPinned) {
    parts.push('pinned only');
  }

  return `Filter: ${parts.join(' • ')}`;
}

export function filterTreeNodes(
  nodes: readonly BranchTreeNode[],
  filterState: RefFilterState
): BranchTreeNode[] {
  if (!hasActiveFilter(filterState)) {
    return [...nodes];
  }

  const filteredNodes = nodes
    .map((node) => filterNode(node, filterState))
    .filter((node): node is BranchTreeNode => Boolean(node));

  return filteredNodes;
}

export function findMatchingRefs(
  nodes: readonly BranchTreeNode[],
  query: string,
  options: {
    includeHooks?: boolean;
    maxResults?: number;
  } = {}
): SearchCandidate[] {
  const parsedQuery = createRefFilterState(query);
  const candidates = collectSearchCandidates(nodes, parsedQuery, {
    includeHooks: options.includeHooks ?? false,
  });
  const maxResults = options.maxResults ?? 200;

  return candidates
    .sort(compareSearchCandidates)
    .slice(0, maxResults);
}

function collectSearchCandidates(
  nodes: readonly BranchTreeNode[],
  filterState: RefFilterState,
  options: {
    includeHooks: boolean;
  },
  repositoryContext: {
    repoLabel?: string;
    repoDescription?: string;
  } = {}
): SearchCandidate[] {
  const candidates: SearchCandidate[] = [];

  for (const node of nodes) {
    if (node.kind === 'repository') {
      candidates.push(
        ...collectSearchCandidates(node.children, filterState, options, {
          repoLabel: node.label,
          repoDescription: node.description,
        })
      );
      continue;
    }

    if (node.kind === 'branch') {
      const scope = (node.info.scope ?? 'local') as RefFilterScope;
      if (scope === 'hook' && !options.includeHooks) {
        continue;
      }

      if (!doesBranchMatchFilter(node, filterState, repositoryContext)) {
        continue;
      }

      candidates.push(buildSearchCandidate(node, filterState, repositoryContext));
      continue;
    }

    if (node.kind === 'remote') {
      continue;
    }

    candidates.push(...collectSearchCandidates(node.children, filterState, options, repositoryContext));
  }

  return candidates;
}

function filterNode(
  node: BranchTreeNode,
  filterState: RefFilterState
): BranchTreeNode | undefined {
  if (node.kind === 'branch') {
    return doesBranchMatchFilter(node, filterState) ? node : undefined;
  }

  if (node.kind === 'remote') {
    return undefined;
  }

  const filteredChildren = node.children
    .map((child) => filterNode(child, filterState))
    .filter((child): child is TreeChildNode | TreeSection => Boolean(child));

  if (filteredChildren.length === 0) {
    return undefined;
  }

  return {
    ...node,
    expanded: true,
    children: filteredChildren,
  } as TreeRepository | TreeSection | TreeFolder;
}

function doesBranchMatchFilter(
  node: TreeBranch,
  filterState: RefFilterState,
  repositoryContext: {
    repoLabel?: string;
    repoDescription?: string;
  } = {}
): boolean {
  const scope = (node.info.scope ?? 'local') as RefFilterScope;
  if (filterState.scopes.length > 0 && !filterState.scopes.includes(scope)) {
    return false;
  }

  if (filterState.showOnlyPinned && !node.info.isPinned) {
    return false;
  }

  const stateFlags = new Set<RefFilterStateFlag>(filterState.states);
  if (filterState.preset === 'needsAttention') {
    for (const state of NEEDS_ATTENTION_STATES) {
      stateFlags.add(state);
    }
  }

  if (stateFlags.size > 0 && !doesBranchMatchAnyState(node.info, stateFlags)) {
    return false;
  }

  if (filterState.textTerms.length === 0) {
    return true;
  }

  const searchText = buildSearchText(node, repositoryContext);
  return filterState.textTerms.every((term) => searchText.includes(term));
}

function doesBranchMatchAnyState(
  branch: BranchInfo,
  stateFlags: ReadonlySet<RefFilterStateFlag>
): boolean {
  for (const stateFlag of stateFlags) {
    if (matchesStateFlag(branch, stateFlag)) {
      return true;
    }
  }

  return false;
}

function matchesStateFlag(branch: BranchInfo, stateFlag: RefFilterStateFlag): boolean {
  switch (stateFlag) {
    case 'pinned':
      return Boolean(branch.isPinned);
    case 'stale':
      return branch.scope === 'remote' && branch.remoteTrackingState === 'stale';
    case 'missingUpstream':
      return Boolean(branch.upstreamMissing);
    case 'publishable':
      return isPublishableBranch(branch);
    case 'current':
      return Boolean(branch.isCurrent);
    default:
      return false;
  }
}

function buildSearchCandidate(
  node: TreeBranch,
  filterState: RefFilterState,
  repositoryContext: {
    repoLabel?: string;
    repoDescription?: string;
  }
): SearchCandidate {
  const scope = (node.info.scope ?? 'local') as RefFilterScope;
  const searchText = buildSearchText(node, repositoryContext);

  return {
    node,
    repoLabel: repositoryContext.repoLabel,
    repoDescription: repositoryContext.repoDescription,
    scope,
    score: scoreSearchCandidate(node, searchText, filterState),
    searchText,
    description: buildSearchCandidateDescription(node, repositoryContext),
    detail: buildSearchCandidateDetail(node),
  };
}

function buildSearchText(
  node: TreeBranch,
  repositoryContext: {
    repoLabel?: string;
    repoDescription?: string;
  }
): string {
  return [
    repositoryContext.repoLabel ?? '',
    repositoryContext.repoDescription ?? '',
    node.fullName,
    node.label,
    node.info.lastCommit ?? '',
    node.info.lastCommitDate ?? '',
    node.info.remoteName ?? '',
    node.info.upstreamName ?? '',
    node.info.worktreePath ?? '',
    node.info.worktreeRef ?? '',
    node.info.hookName ?? '',
    node.info.hookRelativePath ?? '',
    node.info.hookPath ?? '',
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function buildSearchCandidateDescription(
  node: TreeBranch,
  repositoryContext: {
    repoLabel?: string;
  }
): string {
  const parts = [repositoryContext.repoLabel, scopeLabel((node.info.scope ?? 'local') as RefFilterScope), buildBranchDescription(node.info)]
    .filter(Boolean);

  return parts.join(' • ');
}

function buildSearchCandidateDetail(node: TreeBranch): string | undefined {
  if (node.info.scope === 'worktree') {
    return node.info.worktreePath;
  }

  if (node.info.scope === 'hook') {
    return node.info.hookRelativePath ?? node.info.hookPath;
  }

  return node.fullName !== node.label ? node.fullName : undefined;
}

function scoreSearchCandidate(
  node: TreeBranch,
  searchText: string,
  filterState: RefFilterState
): number {
  let score = 0;

  if (filterState.textTerms.length === 0) {
    score += 1;
  }

  const normalizedFullName = node.fullName.toLowerCase();
  const normalizedLabel = node.label.toLowerCase();

  for (const term of filterState.textTerms) {
    if (normalizedFullName === term || normalizedLabel === term) {
      score += 400;
      continue;
    }

    if (normalizedFullName.startsWith(term) || normalizedLabel.startsWith(term)) {
      score += 250;
      continue;
    }

    if (searchText.includes(term)) {
      score += 100;
    }
  }

  if (node.info.isCurrent) {
    score += 25;
  }

  if (node.info.isPinned) {
    score += 15;
  }

  score += node.info.lastCommitTimestamp ?? 0;

  return score;
}

function compareSearchCandidates(left: SearchCandidate, right: SearchCandidate): number {
  if (left.score !== right.score) {
    return right.score - left.score;
  }

  if (Boolean(left.node.info.isPinned) !== Boolean(right.node.info.isPinned)) {
    return left.node.info.isPinned ? -1 : 1;
  }

  if (left.node.info.isCurrent !== right.node.info.isCurrent) {
    return left.node.info.isCurrent ? -1 : 1;
  }

  return left.node.fullName.localeCompare(right.node.fullName);
}

function scopeLabel(scope: RefFilterScope): string {
  switch (scope) {
    case 'tag':
      return 'tag';
    case 'stash':
      return 'stash';
    case 'worktree':
      return 'worktree';
    case 'hook':
      return 'hook';
    case 'remote':
      return 'remote';
    default:
      return 'local';
  }
}
