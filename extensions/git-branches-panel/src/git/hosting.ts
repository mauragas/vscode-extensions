import { type BranchInfo } from '../branchModel';

export interface RemoteInfo {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface CustomRemoteHostingProvider {
  name: string;
  hostPattern: string;
  branchUrlTemplate?: string;
  compareUrlTemplate?: string;
  pullRequestUrlTemplate?: string;
}

export type HostedProviderId = 'github' | 'gitlab' | 'bitbucket' | 'azureDevOps' | 'custom';

export interface HostedRepository {
  provider: HostedProviderId;
  providerLabel: string;
  remoteName: string;
  remoteUrl: string;
  hostRoot: string;
  namespace: string;
  repository: string;
  organization?: string;
  project?: string;
  customProvider?: CustomRemoteHostingProvider;
}

export type CompareBaseStrategy = 'defaultBranch' | 'upstream' | 'currentBranch';

interface HostedUrlTemplateValues {
  hostRoot: string;
  namespace: string;
  owner: string;
  repo: string;
  branch: string;
  base: string;
  remoteName: string;
  organization: string;
  project: string;
}

type RemoteHostingTemplateKey = keyof HostedUrlTemplateValues;

export function parseCustomRemoteHostingProviders(
  configuredValue: unknown
): CustomRemoteHostingProvider[] {
  if (!Array.isArray(configuredValue)) {
    return [];
  }

  const providers: CustomRemoteHostingProvider[] = [];

  for (const candidate of configuredValue) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }

    const name = readStringField(candidate, 'name');
    const hostPattern = readStringField(candidate, 'hostPattern');
    if (!name || !hostPattern) {
      continue;
    }

    providers.push({
      name,
      hostPattern,
      branchUrlTemplate: readStringField(candidate, 'branchUrlTemplate'),
      compareUrlTemplate: readStringField(candidate, 'compareUrlTemplate'),
      pullRequestUrlTemplate: readStringField(candidate, 'pullRequestUrlTemplate'),
    });
  }

  return providers;
}

export function resolveHostedRepository(
  remote: RemoteInfo,
  customProviders: readonly CustomRemoteHostingProvider[] = []
): HostedRepository | undefined {
  const normalizedRemoteUrl = normalizeRemoteUrl(remote.fetchUrl);
  if (!normalizedRemoteUrl) {
    return undefined;
  }

  const builtInRepository =
    parseAzureDevOpsRepository(remote, normalizedRemoteUrl) ??
    parseStandardHostedRepository(remote, normalizedRemoteUrl);
  const customProvider = findMatchingCustomProvider(customProviders, normalizedRemoteUrl, remote.fetchUrl);
  if (customProvider) {
    const customRepository = builtInRepository ?? parseGenericHostedRepository(remote, normalizedRemoteUrl);
    if (!customRepository) {
      return undefined;
    }

    return {
      ...customRepository,
      provider: 'custom',
      providerLabel: customProvider.name,
      customProvider,
    };
  }

  return builtInRepository;
}

export function buildBranchWebUrl(
  repository: HostedRepository,
  branchName: string
): string | undefined {
  if (repository.provider === 'custom') {
    return repository.customProvider?.branchUrlTemplate
      ? applyRemoteHostingTemplate(repository.customProvider.branchUrlTemplate, repository, branchName, '')
      : undefined;
  }

  switch (repository.provider) {
    case 'github':
      return `${repository.hostRoot}/${repository.namespace}/${repository.repository}/tree/${encodePathLikeBranch(branchName)}`;
    case 'gitlab':
      return `${repository.hostRoot}/${repository.namespace}/${repository.repository}/-/tree/${encodePathLikeBranch(branchName)}`;
    case 'bitbucket':
      return `${repository.hostRoot}/${repository.namespace}/${repository.repository}/branch/${encodePathLikeBranch(branchName)}`;
    case 'azureDevOps':
      return `${repository.hostRoot}/${repository.project}/_git/${repository.repository}?version=GB${encodeURIComponent(branchName)}&_a=contents`;
    default:
      return undefined;
  }
}

export function buildCompareWebUrl(
  repository: HostedRepository,
  baseBranchName: string,
  headBranchName: string
): string | undefined {
  if (repository.provider === 'custom') {
    return repository.customProvider?.compareUrlTemplate
      ? applyRemoteHostingTemplate(
          repository.customProvider.compareUrlTemplate,
          repository,
          headBranchName,
          baseBranchName
        )
      : undefined;
  }

  switch (repository.provider) {
    case 'github':
      return `${repository.hostRoot}/${repository.namespace}/${repository.repository}/compare/${encodeURIComponent(baseBranchName)}...${encodeURIComponent(headBranchName)}`;
    case 'gitlab':
      return `${repository.hostRoot}/${repository.namespace}/${repository.repository}/-/compare/${encodeURIComponent(baseBranchName)}...${encodeURIComponent(headBranchName)}`;
    case 'bitbucket':
      return `${repository.hostRoot}/${repository.namespace}/${repository.repository}/branches/compare/${encodeURIComponent(headBranchName)}%0D${encodeURIComponent(baseBranchName)}`;
    case 'azureDevOps':
      return `${repository.hostRoot}/${repository.project}/_git/${repository.repository}/branchCompare?baseVersion=GB${encodeURIComponent(baseBranchName)}&targetVersion=GB${encodeURIComponent(headBranchName)}&_a=commits`;
    default:
      return undefined;
  }
}

export function buildPullRequestWebUrl(
  repository: HostedRepository,
  baseBranchName: string,
  headBranchName: string
): string | undefined {
  if (repository.provider === 'custom') {
    return repository.customProvider?.pullRequestUrlTemplate
      ? applyRemoteHostingTemplate(
          repository.customProvider.pullRequestUrlTemplate,
          repository,
          headBranchName,
          baseBranchName
        )
      : undefined;
  }

  switch (repository.provider) {
    case 'github':
      return `${repository.hostRoot}/${repository.namespace}/${repository.repository}/compare/${encodeURIComponent(baseBranchName)}...${encodeURIComponent(headBranchName)}?expand=1`;
    case 'gitlab':
      return `${repository.hostRoot}/${repository.namespace}/${repository.repository}/-/merge_requests/new?merge_request[source_branch]=${encodeURIComponent(headBranchName)}&merge_request[target_branch]=${encodeURIComponent(baseBranchName)}`;
    case 'bitbucket':
      return `${repository.hostRoot}/${repository.namespace}/${repository.repository}/pull-requests/new?source=${encodeURIComponent(`${repository.namespace}/${repository.repository}::${headBranchName}`)}&dest=${encodeURIComponent(`${repository.namespace}/${repository.repository}::${baseBranchName}`)}`;
    case 'azureDevOps':
      return `${repository.hostRoot}/${repository.project}/_git/${repository.repository}/pullrequestcreate?sourceRef=${encodeURIComponent(`refs/heads/${headBranchName}`)}&targetRef=${encodeURIComponent(`refs/heads/${baseBranchName}`)}`;
    default:
      return undefined;
  }
}

export function resolveRemoteBranchName(fullBranchName: string, branch?: Pick<BranchInfo, 'scope' | 'remoteName'>): string {
  if (branch?.scope === 'remote' || branch?.remoteName) {
    const [remoteName, ...branchSegments] = fullBranchName.split('/');
    return remoteName && branchSegments.length > 0 ? branchSegments.join('/') : fullBranchName;
  }

  return fullBranchName;
}

export function getUpstreamRemoteName(upstreamName: string | undefined): string | undefined {
  if (!upstreamName) {
    return undefined;
  }

  const [remoteName] = upstreamName.split('/');
  return remoteName || undefined;
}

export function getUpstreamBranchName(upstreamName: string | undefined): string | undefined {
  if (!upstreamName) {
    return undefined;
  }

  const [, ...branchSegments] = upstreamName.split('/');
  return branchSegments.length > 0 ? branchSegments.join('/') : undefined;
}

export function resolveRemoteNameForBranch(
  branch: Pick<BranchInfo, 'scope' | 'remoteName' | 'upstreamName'>,
  availableRemoteNames: readonly string[],
  preferredRemoteName: string | undefined
): string | undefined {
  if (branch.scope === 'remote' && branch.remoteName && availableRemoteNames.includes(branch.remoteName)) {
    return branch.remoteName;
  }

  const upstreamRemoteName = getUpstreamRemoteName(branch.upstreamName);
  if (upstreamRemoteName && availableRemoteNames.includes(upstreamRemoteName)) {
    return upstreamRemoteName;
  }

  if (preferredRemoteName && availableRemoteNames.includes(preferredRemoteName)) {
    return preferredRemoteName;
  }

  if (availableRemoteNames.includes('origin')) {
    return 'origin';
  }

  return availableRemoteNames.length === 1 ? availableRemoteNames[0] : undefined;
}

export function resolveCompareBaseBranch(options: {
  compareBaseStrategy: CompareBaseStrategy;
  headBranchName: string;
  currentBranchName?: string;
  upstreamBranchName?: string;
  defaultBranchName?: string;
}): string | undefined {
  const candidatesByStrategy = {
    defaultBranch: [options.defaultBranchName, options.currentBranchName, options.upstreamBranchName],
    upstream: [options.upstreamBranchName, options.defaultBranchName, options.currentBranchName],
    currentBranch: [options.currentBranchName, options.defaultBranchName, options.upstreamBranchName],
  } as const;

  const candidates = candidatesByStrategy[options.compareBaseStrategy];

  for (const candidate of candidates) {
    if (candidate && candidate !== options.headBranchName) {
      return candidate;
    }
  }

  return undefined;
}

function normalizeRemoteUrl(remoteUrl: string): URL | undefined {
  const trimmedRemoteUrl = remoteUrl.trim();
  if (!trimmedRemoteUrl) {
    return undefined;
  }

  const scpLikeMatch = trimmedRemoteUrl.match(/^([^@]+@[^:]+):(.+)$/u);
  const normalizedRemoteUrl = scpLikeMatch
    ? `ssh://${scpLikeMatch[1]}/${scpLikeMatch[2]}`
    : trimmedRemoteUrl;

  try {
    return new URL(normalizedRemoteUrl);
  } catch {
    return undefined;
  }
}

function parseStandardHostedRepository(
  remote: RemoteInfo,
  remoteUrl: URL
): HostedRepository | undefined {
  const hostname = remoteUrl.hostname.toLowerCase();
  const provider = resolveStandardProviderId(hostname);
  if (!provider) {
    return undefined;
  }

  const pathSegments = trimRepositoryPathSegments(remoteUrl.pathname);
  if (pathSegments.length < 2) {
    return undefined;
  }

  const repository = pathSegments[pathSegments.length - 1];
  const namespace = pathSegments.slice(0, -1).join('/');

  return {
    provider,
    providerLabel: providerLabel(provider),
    remoteName: remote.name,
    remoteUrl: remote.fetchUrl,
    hostRoot: toBrowserHostRoot(remoteUrl),
    namespace,
    repository,
  };
}

function parseGenericHostedRepository(
  remote: RemoteInfo,
  remoteUrl: URL
): HostedRepository | undefined {
  const pathSegments = trimRepositoryPathSegments(remoteUrl.pathname);
  if (pathSegments.length < 2) {
    return undefined;
  }

  return {
    provider: 'custom',
    providerLabel: 'Custom',
    remoteName: remote.name,
    remoteUrl: remote.fetchUrl,
    hostRoot: toBrowserHostRoot(remoteUrl),
    namespace: pathSegments.slice(0, -1).join('/'),
    repository: pathSegments[pathSegments.length - 1],
  };
}

function parseAzureDevOpsRepository(
  remote: RemoteInfo,
  remoteUrl: URL
): HostedRepository | undefined {
  const hostname = remoteUrl.hostname.toLowerCase();
  const pathSegments = trimRepositoryPathSegments(remoteUrl.pathname);

  if (hostname === 'ssh.dev.azure.com') {
    if (pathSegments.length !== 4 || pathSegments[0] !== 'v3') {
      return undefined;
    }

    const [, organization, project, repository] = pathSegments;

    return {
      provider: 'azureDevOps',
      providerLabel: providerLabel('azureDevOps'),
      remoteName: remote.name,
      remoteUrl: remote.fetchUrl,
      hostRoot: `https://dev.azure.com/${organization}`,
      namespace: `${organization}/${project}`,
      repository,
      organization,
      project,
    };
  }

  if (hostname === 'dev.azure.com') {
    if (pathSegments.length !== 4 || pathSegments[2] !== '_git') {
      return undefined;
    }

    const [organization, project, , repository] = pathSegments;

    return {
      provider: 'azureDevOps',
      providerLabel: providerLabel('azureDevOps'),
      remoteName: remote.name,
      remoteUrl: remote.fetchUrl,
      hostRoot: `https://dev.azure.com/${organization}`,
      namespace: `${organization}/${project}`,
      repository,
      organization,
      project,
    };
  }

  if (hostname.endsWith('.visualstudio.com')) {
    if (pathSegments.length !== 3 || pathSegments[1] !== '_git') {
      return undefined;
    }

    const [project, , repository] = pathSegments;
    const organization = hostname.slice(0, -'.visualstudio.com'.length);

    return {
      provider: 'azureDevOps',
      providerLabel: providerLabel('azureDevOps'),
      remoteName: remote.name,
      remoteUrl: remote.fetchUrl,
      hostRoot: `${remoteUrl.protocol}//${remoteUrl.host}`,
      namespace: `${organization}/${project}`,
      repository,
      organization,
      project,
    };
  }

  return undefined;
}

function findMatchingCustomProvider(
  customProviders: readonly CustomRemoteHostingProvider[],
  remoteUrl: URL,
  rawRemoteUrl: string
): CustomRemoteHostingProvider | undefined {
  const matchTargetValues = [
    rawRemoteUrl,
    `${remoteUrl.protocol}//${remoteUrl.host}`,
    remoteUrl.host,
  ];

  return customProviders.find((provider) => {
    try {
      const pattern = new RegExp(provider.hostPattern, 'iu');
      return matchTargetValues.some((value) => pattern.test(value));
    } catch {
      return false;
    }
  });
}

function applyRemoteHostingTemplate(
  template: string,
  repository: HostedRepository,
  branchName: string,
  baseBranchName: string
): string {
  const [owner = repository.namespace] = repository.namespace.split('/');
  const values: HostedUrlTemplateValues = {
    hostRoot: repository.hostRoot,
    namespace: repository.namespace,
    owner,
    repo: repository.repository,
    branch: branchName,
    base: baseBranchName,
    remoteName: repository.remoteName,
    organization: repository.organization ?? '',
    project: repository.project ?? '',
  };

  return template.replace(/\$\{(hostRoot|namespace|owner|repo|branch|base|remoteName|organization|project)\}/gu, (_match, name) =>
    formatTemplateValue(name as RemoteHostingTemplateKey, values[name as RemoteHostingTemplateKey])
  );
}

function formatTemplateValue(
  key: RemoteHostingTemplateKey,
  value: string
): string {
  return key === 'hostRoot' ? value : encodeTemplateValue(value);
}

function encodeTemplateValue(value: string): string {
  return encodeURIComponent(value).replace(/%2F/gu, '/');
}

function trimRepositoryPathSegments(pathname: string): string[] {
  return pathname
    .replace(/\.git$/iu, '')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function resolveStandardProviderId(hostname: string): HostedProviderId | undefined {
  if (hostname === 'github.com') {
    return 'github';
  }

  if (hostname === 'gitlab.com') {
    return 'gitlab';
  }

  if (hostname === 'bitbucket.org') {
    return 'bitbucket';
  }

  return undefined;
}

function providerLabel(provider: HostedProviderId): string {
  switch (provider) {
    case 'azureDevOps':
      return 'Azure DevOps';
    case 'bitbucket':
      return 'Bitbucket';
    case 'gitlab':
      return 'GitLab';
    case 'github':
      return 'GitHub';
    default:
      return 'Custom';
  }
}

function toBrowserHostRoot(remoteUrl: URL): string {
  return `${remoteUrl.protocol === 'http:' ? 'http:' : 'https:'}//${remoteUrl.host}`;
}

function encodePathLikeBranch(branchName: string): string {
  return branchName
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function readStringField(candidate: object, key: string): string | undefined {
  const value = (candidate as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
