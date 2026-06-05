import { listRefs } from './refListing';
import { ensureRemoteExists, runGit } from './shared';

export async function getTags(repoRoot: string) {
  return listRefs(repoRoot, 'refs/tags', 'tag');
}

export async function checkoutTag(repoRoot: string, tagName: string): Promise<void> {
  await runGit(repoRoot, ['checkout', `refs/tags/${tagName}`]);
}

export async function createTag(
  repoRoot: string,
  tagName: string,
  targetRef: string
): Promise<void> {
  await runGit(repoRoot, ['tag', tagName, targetRef]);
}

export async function deleteTag(repoRoot: string, tagName: string): Promise<void> {
  await runGit(repoRoot, ['tag', '-d', tagName]);
}

export async function pushAllTags(repoRoot: string, remoteName: string): Promise<void> {
  await ensureRemoteExists(repoRoot, remoteName);
  await runGit(repoRoot, ['push', remoteName, '--tags']);
}
