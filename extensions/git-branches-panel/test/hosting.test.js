const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildBranchWebUrl,
  buildCompareWebUrl,
  buildPullRequestWebUrl,
  getUpstreamBranchName,
  getUpstreamRemoteName,
  parseCustomRemoteHostingProviders,
  resolveCompareBaseBranch,
  resolveHostedRepository,
  resolveRemoteBranchName,
  resolveRemoteNameForBranch,
} = require('../out/git/hosting.js');

test('resolveHostedRepository parses GitHub SSH remotes and builds branch, compare, and pull-request URLs', () => {
  const repository = resolveHostedRepository({
    name: 'origin',
    fetchUrl: 'git@github.com:octo/repo.git',
    pushUrl: 'git@github.com:octo/repo.git',
  });

  assert.deepEqual(
    {
      provider: repository.provider,
      providerLabel: repository.providerLabel,
      remoteName: repository.remoteName,
      hostRoot: repository.hostRoot,
      namespace: repository.namespace,
      repository: repository.repository,
    },
    {
      provider: 'github',
      providerLabel: 'GitHub',
      remoteName: 'origin',
      hostRoot: 'https://github.com',
      namespace: 'octo',
      repository: 'repo',
    }
  );
  assert.equal(buildBranchWebUrl(repository, 'feature/demo'), 'https://github.com/octo/repo/tree/feature/demo');
  assert.equal(
    buildCompareWebUrl(repository, 'main', 'feature/demo'),
    'https://github.com/octo/repo/compare/main...feature%2Fdemo'
  );
  assert.equal(
    buildPullRequestWebUrl(repository, 'main', 'feature/demo'),
    'https://github.com/octo/repo/compare/main...feature%2Fdemo?expand=1'
  );
});

test('resolveHostedRepository parses GitLab HTTPS remotes with nested groups', () => {
  const repository = resolveHostedRepository({
    name: 'origin',
    fetchUrl: 'https://gitlab.com/group/subgroup/repo.git',
    pushUrl: 'https://gitlab.com/group/subgroup/repo.git',
  });

  assert.equal(repository.provider, 'gitlab');
  assert.equal(repository.namespace, 'group/subgroup');
  assert.equal(repository.repository, 'repo');
  assert.equal(
    buildBranchWebUrl(repository, 'release/2026.06'),
    'https://gitlab.com/group/subgroup/repo/-/tree/release/2026.06'
  );
  assert.equal(
    buildPullRequestWebUrl(repository, 'main', 'release/2026.06'),
    'https://gitlab.com/group/subgroup/repo/-/merge_requests/new?merge_request[source_branch]=release%2F2026.06&merge_request[target_branch]=main'
  );
});

test('resolveHostedRepository parses Azure DevOps remotes and builds URLs', () => {
  const repository = resolveHostedRepository({
    name: 'origin',
    fetchUrl: 'https://dev.azure.com/org/project/_git/repo',
    pushUrl: 'https://dev.azure.com/org/project/_git/repo',
  });

  assert.equal(repository.provider, 'azureDevOps');
  assert.equal(repository.organization, 'org');
  assert.equal(repository.project, 'project');
  assert.equal(
    buildCompareWebUrl(repository, 'main', 'feature/demo'),
    'https://dev.azure.com/org/project/_git/repo/branchCompare?baseVersion=GBmain&targetVersion=GBfeature%2Fdemo&_a=commits'
  );
  assert.equal(
    buildPullRequestWebUrl(repository, 'main', 'feature/demo'),
    'https://dev.azure.com/org/project/_git/repo/pullrequestcreate?sourceRef=refs%2Fheads%2Ffeature%2Fdemo&targetRef=refs%2Fheads%2Fmain'
  );
});

test('custom providers can reuse generic host parsing and substitute URL templates', () => {
  const customProviders = parseCustomRemoteHostingProviders([
    {
      name: 'Custom Forge',
      hostPattern: 'git\\.example\\.com',
      branchUrlTemplate: '${hostRoot}/${namespace}/${repo}/branches/${branch}',
      compareUrlTemplate: '${hostRoot}/${namespace}/${repo}/compare/${base}...${branch}',
      pullRequestUrlTemplate: '${hostRoot}/${namespace}/${repo}/pulls/new?base=${base}&head=${branch}',
    },
  ]);
  const repository = resolveHostedRepository(
    {
      name: 'origin',
      fetchUrl: 'https://git.example.com/team/repo.git',
      pushUrl: 'https://git.example.com/team/repo.git',
    },
    customProviders
  );

  assert.equal(repository.provider, 'custom');
  assert.equal(repository.providerLabel, 'Custom Forge');
  assert.equal(
    buildBranchWebUrl(repository, 'feature/demo'),
    'https://git.example.com/team/repo/branches/feature/demo'
  );
  assert.equal(
    buildCompareWebUrl(repository, 'main', 'feature/demo'),
    'https://git.example.com/team/repo/compare/main...feature/demo'
  );
  assert.equal(
    buildPullRequestWebUrl(repository, 'main', 'feature/demo'),
    'https://git.example.com/team/repo/pulls/new?base=main&head=feature/demo'
  );
});

test('remote-host helpers resolve branch and compare-base routing choices', () => {
  assert.equal(resolveRemoteBranchName('origin/feature/demo', { scope: 'remote', remoteName: 'origin' }), 'feature/demo');
  assert.equal(resolveRemoteBranchName('feature/demo', { scope: 'local' }), 'feature/demo');
  assert.equal(getUpstreamRemoteName('origin/main'), 'origin');
  assert.equal(getUpstreamBranchName('origin/main'), 'main');
  assert.equal(
    resolveRemoteNameForBranch(
      { scope: 'local', upstreamName: 'upstream/release/2026.06' },
      ['origin', 'upstream'],
      'origin'
    ),
    'upstream'
  );
  assert.equal(
    resolveRemoteNameForBranch(
      { scope: 'local' },
      ['origin', 'fork'],
      'fork'
    ),
    'fork'
  );
  assert.equal(
    resolveRemoteNameForBranch(
      { scope: 'local' },
      ['origin', 'fork'],
      undefined
    ),
    'origin'
  );
  assert.equal(
    resolveCompareBaseBranch({
      compareBaseStrategy: 'defaultBranch',
      headBranchName: 'feature/demo',
      defaultBranchName: 'main',
      currentBranchName: 'feature/current',
      upstreamBranchName: 'origin/feature/demo',
    }),
    'main'
  );
  assert.equal(
    resolveCompareBaseBranch({
      compareBaseStrategy: 'currentBranch',
      headBranchName: 'feature/demo',
      defaultBranchName: 'main',
      currentBranchName: 'feature/current',
      upstreamBranchName: 'release/2026.06',
    }),
    'feature/current'
  );
  assert.equal(
    resolveCompareBaseBranch({
      compareBaseStrategy: 'upstream',
      headBranchName: 'feature/demo',
      defaultBranchName: 'main',
      currentBranchName: 'feature/demo',
      upstreamBranchName: 'feature/demo',
    }),
    'main'
  );
});
