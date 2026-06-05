import { buildBranchDescription, type BranchInfo } from './branchModel';
import type { CheckoutRemoteBranchResult, SyncBranchResult } from './git';

export const DOUBLE_CLICK_WINDOW_MS = 500;

export interface BranchItemIdentity {
  branchName?: string;
  repoRoot?: string;
}

interface BranchActivationState {
  branchName: string;
  repoRoot: string;
  activatedAt: number;
}

export class BranchItemActivationTracker {
  private lastActivation?: BranchActivationState;

  constructor(private readonly now: () => number = () => Date.now()) {}

  shouldCheckout(item: BranchItemIdentity): boolean {
    if (!item.branchName || !item.repoRoot) {
      return false;
    }

    const activatedAt = this.now();
    // Treat two activations in a short window as an intentional checkout.
    const isDoubleClick =
      this.lastActivation?.branchName === item.branchName &&
      this.lastActivation.repoRoot === item.repoRoot &&
      activatedAt - this.lastActivation.activatedAt <= DOUBLE_CLICK_WINDOW_MS;

    this.lastActivation = {
      branchName: item.branchName,
      repoRoot: item.repoRoot,
      activatedAt,
    };

    return isDoubleClick;
  }

  reset(): void {
    this.lastActivation = undefined;
  }
}

export function buildSyncResultMessage(syncResult: SyncBranchResult): string {
  if (!syncResult.didPull && !syncResult.didPush) {
    return `'${syncResult.branchName}' is already up to date with '${syncResult.upstreamName}'.`;
  }

  if (syncResult.didPull && syncResult.didPush) {
    return `Synced '${syncResult.branchName}' with '${syncResult.upstreamName}' (pulled and pushed).`;
  }

  if (syncResult.didPull) {
    return `Updated '${syncResult.branchName}' from '${syncResult.upstreamName}'.`;
  }

  if (syncResult.publishedUpstream) {
    return `Published '${syncResult.branchName}' to '${syncResult.upstreamName}'.`;
  }

  return `Pushed '${syncResult.branchName}' to '${syncResult.upstreamName}'.`;
}

export function validateBranchName(value: string, currentName?: string): string | undefined {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return 'Branch name cannot be empty.';
  }

  if (/\s/.test(trimmedValue)) {
    return 'Branch name cannot contain spaces.';
  }

  if (trimmedValue.startsWith('-')) {
    return 'Branch name cannot start with a dash.';
  }

  if (trimmedValue.endsWith('/') || trimmedValue.includes('//')) {
    return 'Branch name cannot end with a slash or contain empty path segments.';
  }

  if (currentName && trimmedValue === currentName) {
    return 'Please enter a different branch name.';
  }

  return undefined;
}

export function validateTagName(value: string): string | undefined {
  const trimmedValue = value.trim();
  const invalidTagCharacters = ['~', '^', ':', '?', '*', '[', '\\'];

  if (!trimmedValue) {
    return 'Tag name cannot be empty.';
  }

  if (/\s/.test(trimmedValue)) {
    return 'Tag name cannot contain spaces.';
  }

  if (trimmedValue.startsWith('-')) {
    return 'Tag name cannot start with a dash.';
  }

  if (
    trimmedValue.startsWith('/') ||
    trimmedValue.endsWith('/') ||
    trimmedValue.includes('//')
  ) {
    return 'Tag name cannot start or end with a slash or contain empty path segments.';
  }

  if (trimmedValue.endsWith('.') || trimmedValue.includes('..')) {
    return 'Tag name cannot end with a dot or contain consecutive dots.';
  }

  if (trimmedValue === '@') {
    return "Tag name cannot be '@'.";
  }

  if (trimmedValue.endsWith('.lock')) {
    return "Tag name cannot end with '.lock'.";
  }

  if (
    invalidTagCharacters.some((character) => trimmedValue.includes(character)) ||
    trimmedValue.includes('@{')
  ) {
    return 'Tag name contains invalid Git characters.';
  }

  return undefined;
}

export function looksLikeMergeSafetyError(message: string): boolean {
  return /not fully merged/i.test(message);
}

export function buildCurrentBranchMessage(
  currentBranch: BranchInfo | undefined,
  showCurrentBranchInfo = true
): string {
  if (!showCurrentBranchInfo || !currentBranch) {
    return '';
  }

  const description = buildBranchDescription(currentBranch);

  return description
    ? `Current branch: ${currentBranch.name} • ${description}`
    : `Current branch: ${currentBranch.name}`;
}

export function buildCurrentBranchAlreadyCheckedOutMessage(branchName: string): string {
  return `Already on '${branchName}'.`;
}

export function buildRemoteBranchCheckoutMessage(
  checkoutResult: CheckoutRemoteBranchResult
): string {
  return checkoutResult.createdLocalBranch
    ? `Created and switched to local branch '${checkoutResult.localBranchName}' tracking '${checkoutResult.remoteBranchName}'.`
    : `Switched to existing local branch '${checkoutResult.localBranchName}' for '${checkoutResult.remoteBranchName}'.`;
}
