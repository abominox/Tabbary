/**
 * Tab suspension.
 *
 * Uses Chrome's native discard (`chrome.tabs.discard`), so the address bar keeps
 * the real URL and there is no third-party suspender service involved.
 *
 * Deciding *what* to discard is the risky part: discarding a tab that is
 * playing audio, holding an unsaved form, or pinned will annoy the user. The
 * policy below is deliberately conservative and unit-tested.
 */

export interface SuspendableTab {
  id?: number;
  url?: string;
  title?: string;
  pinned?: boolean;
  active?: boolean;
  discarded?: boolean;
  audible?: boolean;
  autoDiscardable?: boolean;
  /** Chrome's last-accessed time, ms since epoch. */
  lastAccessed?: number;
}

export interface SuspendPolicy {
  /** Do not touch tabs accessed more recently than this. */
  minIdleMs: number;
  /** Never discard pinned tabs (default true — pinned means "keep"). */
  skipPinned: boolean;
  /** URL prefixes that must never be discarded. */
  allowlist: string[];
}

export const DEFAULT_SUSPEND_POLICY: SuspendPolicy = {
  minIdleMs: 30 * 60_000, // 30 minutes
  skipPinned: true,
  allowlist: [
    'chrome://',
    'chrome-extension://',
    'devtools://',
    'about:',
    'file://',
  ],
};

/**
 * Why a tab is / is not a candidate. Returning a reason (rather than a boolean)
 * makes the behavior auditable and gives the UI something to show.
 */
export type SkipReason =
  | 'no-id'
  | 'active'
  | 'pinned'
  | 'already-discarded'
  | 'audible'
  | 'not-auto-discardable'
  | 'too-recent'
  | 'allowlisted'
  | 'no-url';

export interface CandidateDecision {
  tab: SuspendableTab;
  suspend: boolean;
  reason?: SkipReason;
}

export function evaluateTab(
  tab: SuspendableTab,
  now: number,
  policy: SuspendPolicy = DEFAULT_SUSPEND_POLICY,
): CandidateDecision {
  if (tab.id == null) return { tab, suspend: false, reason: 'no-id' };
  if (tab.active) return { tab, suspend: false, reason: 'active' };
  if (policy.skipPinned && tab.pinned) return { tab, suspend: false, reason: 'pinned' };
  if (tab.discarded) return { tab, suspend: false, reason: 'already-discarded' };

  // Audio is the clearest "the user is using this" signal we get for free.
  if (tab.audible) return { tab, suspend: false, reason: 'audible' };

  // A tab Chrome itself refuses to auto-discard usually has a reason
  // (e.g. it is capturing, or the page called preventAutoDiscardable()).
  if (tab.autoDiscardable === false) {
    return { tab, suspend: false, reason: 'not-auto-discardable' };
  }

  if (!tab.url) return { tab, suspend: false, reason: 'no-url' };
  for (const prefix of policy.allowlist) {
    if (tab.url.startsWith(prefix)) return { tab, suspend: false, reason: 'allowlisted' };
  }

  // Treat a missing lastAccessed as "old enough": Chrome only fills it in for
  // tabs it has seen, and refusing to suspend those would make the feature
  // silently do nothing.
  if (tab.lastAccessed != null && now - tab.lastAccessed < policy.minIdleMs) {
    return { tab, suspend: false, reason: 'too-recent' };
  }

  return { tab, suspend: true };
}

/** Split a window's tabs into those worth discarding and those to leave alone. */
export function planSuspension(
  tabs: SuspendableTab[],
  now: number,
  policy: SuspendPolicy = DEFAULT_SUSPEND_POLICY,
): { toDiscard: SuspendableTab[]; skipped: { tab: SuspendableTab; reason: SkipReason }[] } {
  const toDiscard: SuspendableTab[] = [];
  const skipped: { tab: SuspendableTab; reason: SkipReason }[] = [];

  for (const tab of tabs) {
    const decision = evaluateTab(tab, now, policy);
    if (decision.suspend) toDiscard.push(tab);
    else if (decision.reason) skipped.push({ tab, reason: decision.reason });
  }

  return { toDiscard, skipped };
}

/** Human-readable summary for a skipped tab (used in the UI tooltip). */
export function describeSkip(reason: SkipReason): string {
  switch (reason) {
    case 'active':
      return 'Currently active';
    case 'pinned':
      return 'Pinned';
    case 'already-discarded':
      return 'Already suspended';
    case 'audible':
      return 'Playing audio';
    case 'not-auto-discardable':
      return 'Page asked not to be discarded';
    case 'too-recent':
      return 'Used recently';
    case 'allowlisted':
      return 'Browser page';
    case 'no-url':
      return 'No URL';
    default:
      return 'Not eligible';
  }
}
