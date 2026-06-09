import { listRefs } from './refListing';
import { ensureRemoteExists, runGit } from './shared';

const TAG_FIELD_SEPARATOR = '\u001f';
const TAG_RECORD_SEPARATOR = '\u001e';
const TAG_METADATA_FORMAT = [
  '%(refname:short)',
  '%(taggername)',
  '%(taggeremail)',
  '%(taggerdate:iso-strict)',
  '%(subject)',
  '%(body)',
].join(TAG_FIELD_SEPARATOR) + TAG_RECORD_SEPARATOR;
const COMMIT_METADATA_FORMAT = [
  '%an',
  '%ae',
  '%aI',
  '%s',
  '%b',
].join(TAG_FIELD_SEPARATOR) + TAG_RECORD_SEPARATOR;

export type TagType = 'lightweight' | 'annotated' | 'signedAnnotated';

export interface CreateTagOptions {
  type?: TagType;
  message?: string;
}

export interface TagDetails {
  name: string;
  type: TagType;
  tagObjectSha: string;
  targetSha: string;
  targetType: string;
  authorName?: string;
  authorEmail?: string;
  createdAt?: string;
  subject?: string;
  message?: string;
  isSigned: boolean;
}

export async function getTags(repoRoot: string) {
  return listRefs(repoRoot, 'refs/tags', 'tag');
}

export async function checkoutTag(repoRoot: string, tagName: string): Promise<void> {
  await runGit(repoRoot, ['checkout', `refs/tags/${tagName}`]);
}

export async function createTag(
  repoRoot: string,
  tagName: string,
  targetRef: string,
  options: CreateTagOptions = {}
): Promise<void> {
  const type = options.type ?? 'lightweight';
  const args = ['tag'];

  if (type === 'annotated') {
    args.push('-a');
  }

  if (type === 'signedAnnotated') {
    args.push('-s');
  }

  if (type !== 'lightweight') {
    const message = options.message?.trim();
    if (!message) {
      throw new Error('Annotated tags require a message.');
    }

    args.push('-m', message);
  }

  args.push(tagName, targetRef);

  await runGit(repoRoot, args);
}

export async function deleteTag(repoRoot: string, tagName: string): Promise<void> {
  await runGit(repoRoot, ['tag', '-d', tagName]);
}

export async function pushAllTags(repoRoot: string, remoteName: string): Promise<void> {
  await ensureRemoteExists(repoRoot, remoteName);
  await runGit(repoRoot, ['push', remoteName, '--tags']);
}

export async function pushTag(
  repoRoot: string,
  remoteName: string,
  tagName: string
): Promise<void> {
  await ensureRemoteExists(repoRoot, remoteName);
  await runGit(repoRoot, ['push', remoteName, `refs/tags/${tagName}`]);
}

export async function deleteRemoteTag(
  repoRoot: string,
  remoteName: string,
  tagName: string
): Promise<void> {
  await ensureRemoteExists(repoRoot, remoteName);
  await runGit(repoRoot, ['push', remoteName, `:refs/tags/${tagName}`]);
}

export async function getTagDetails(
  repoRoot: string,
  tagName: string
): Promise<TagDetails> {
  const tagRef = `refs/tags/${tagName}`;
  const { stdout: tagObjectTypeOutput } = await runGit(repoRoot, ['cat-file', '-t', tagRef]);
  const { stdout: tagObjectShaOutput } = await runGit(repoRoot, ['rev-parse', tagRef]);
  const { stdout: targetShaOutput } = await runGit(repoRoot, ['rev-parse', `${tagName}^{}`]);
  const { stdout: targetTypeOutput } = await runGit(repoRoot, ['cat-file', '-t', `${tagName}^{}`]);

  const metadata = await getTagMetadata(repoRoot, tagRef);
  const tagObjectType = tagObjectTypeOutput.trim();
  const tagObjectSha = tagObjectShaOutput.trim();
  const targetSha = targetShaOutput.trim();
  const targetType = targetTypeOutput.trim();

  if (tagObjectType !== 'tag') {
    const commitMetadata =
      targetType === 'commit'
        ? await getCommitMetadata(repoRoot, tagName)
        : undefined;

    return {
      name: metadata.name || tagName,
      type: 'lightweight',
      tagObjectSha,
      targetSha,
      targetType,
      authorName: commitMetadata?.authorName,
      authorEmail: commitMetadata?.authorEmail,
      createdAt: commitMetadata?.createdAt,
      subject: commitMetadata?.subject,
      message: commitMetadata?.message,
      isSigned: false,
    };
  }

  const { stdout: rawTagContents } = await runGit(repoRoot, ['cat-file', '-p', tagRef]);
  const isSigned = /-----BEGIN PGP SIGNATURE-----/u.test(rawTagContents);

  return {
    name: metadata.name || tagName,
    type: isSigned ? 'signedAnnotated' : 'annotated',
    tagObjectSha,
    targetSha,
    targetType,
    authorName: metadata.authorName,
    authorEmail: metadata.authorEmail,
    createdAt: metadata.createdAt,
    subject: metadata.subject,
    message: metadata.message,
    isSigned,
  };
}

async function getTagMetadata(
  repoRoot: string,
  tagRef: string
): Promise<{
  name?: string;
  authorName?: string;
  authorEmail?: string;
  createdAt?: string;
  subject?: string;
  message?: string;
}> {
  const { stdout } = await runGit(repoRoot, [
    'for-each-ref',
    `--format=${TAG_METADATA_FORMAT}`,
    tagRef,
  ]);

  const [record = ''] = stdout.split(TAG_RECORD_SEPARATOR).filter(Boolean);
  const [
    name = '',
    authorName = '',
    authorEmail = '',
    createdAt = '',
    subject = '',
    body = '',
  ] = record.split(TAG_FIELD_SEPARATOR);

  return {
    name: name || undefined,
    authorName: authorName || undefined,
    authorEmail: authorEmail || undefined,
    createdAt: createdAt || undefined,
    subject: subject || undefined,
    message: buildMessage(subject, body),
  };
}

async function getCommitMetadata(
  repoRoot: string,
  refName: string
): Promise<{
  authorName?: string;
  authorEmail?: string;
  createdAt?: string;
  subject?: string;
  message?: string;
}> {
  const { stdout } = await runGit(repoRoot, ['show', '-s', `--format=${COMMIT_METADATA_FORMAT}`, refName]);

  const [record = ''] = stdout.split(TAG_RECORD_SEPARATOR).filter(Boolean);
  const [authorName = '', authorEmail = '', createdAt = '', subject = '', body = ''] = record.split(
    TAG_FIELD_SEPARATOR
  );

  return {
    authorName: authorName || undefined,
    authorEmail: authorEmail || undefined,
    createdAt: createdAt || undefined,
    subject: subject || undefined,
    message: buildMessage(subject, body),
  };
}

function buildMessage(subject: string, body: string): string | undefined {
  const normalizedSubject = subject.trim();
  const normalizedBody = body.trim();

  if (!normalizedSubject && !normalizedBody) {
    return undefined;
  }

  return [normalizedSubject, normalizedBody].filter(Boolean).join('\n\n');
}
