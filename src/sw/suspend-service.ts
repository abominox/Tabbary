// Tab suspension handlers.

import { planSuspension, describeSkip, DEFAULT_SUSPEND_POLICY } from '@/lib/suspend';
import type { SuspendResult } from '@/messaging/suspend';

function policyFor(minIdleMinutes?: number) {
  if (!minIdleMinutes || !Number.isFinite(minIdleMinutes)) return DEFAULT_SUSPEND_POLICY;
  return {
    ...DEFAULT_SUSPEND_POLICY,
    // Clamp: suspending a tab used "0 minutes ago" would be hostile.
    minIdleMs: Math.max(1, Math.round(minIdleMinutes)) * 60_000,
  };
}

function toSuspendable(tab: chrome.tabs.Tab) {
  return {
    id: tab.id,
    url: tab.url,
    title: tab.title,
    pinned: tab.pinned,
    active: tab.active,
    discarded: tab.discarded,
    audible: tab.audible,
    autoDiscardable: tab.autoDiscardable,
    lastAccessed: tab.lastAccessed,
  };
}

/** Report what *would* be discarded, without touching anything. */
export async function previewSuspension(
  windowId: number,
  minIdleMinutes?: number,
): Promise<SuspendResult> {
  const tabs = await chrome.tabs.query({ windowId });
  const { toDiscard, skipped } = planSuspension(
    tabs.map(toSuspendable),
    Date.now(),
    policyFor(minIdleMinutes),
  );

  return {
    discarded: toDiscard.length,
    skipped: skipped.map((s) => ({
      tabId: s.tab.id,
      title: s.tab.title ?? s.tab.url ?? 'Untitled',
      reason: describeSkip(s.reason),
    })),
  };
}

/**
 * Discard idle tabs in a window.
 *
 * `chrome.tabs.discard` is a no-op on tabs Chrome refuses to discard, so the
 * count reflects what we asked for; the preview endpoint shows the plan.
 */
export async function suspendWindow(
  windowId: number,
  minIdleMinutes?: number,
): Promise<SuspendResult> {
  const tabs = await chrome.tabs.query({ windowId });
  const { toDiscard, skipped } = planSuspension(
    tabs.map(toSuspendable),
    Date.now(),
    policyFor(minIdleMinutes),
  );

  let discarded = 0;
  for (const tab of toDiscard) {
    if (tab.id == null) continue;
    try {
      await chrome.tabs.discard(tab.id);
      discarded++;
    } catch {
      // Chrome may refuse (already discarded, capturing, …); not an error.
    }
  }

  return {
    discarded,
    skipped: skipped.map((s) => ({
      tabId: s.tab.id,
      title: s.tab.title ?? s.tab.url ?? 'Untitled',
      reason: describeSkip(s.reason),
    })),
  };
}

/** Discard a single tab, used by the tab-row context action. */
export async function suspendTab(chromeTabId: number): Promise<boolean> {
  try {
    await chrome.tabs.discard(chromeTabId);
    return true;
  } catch {
    return false;
  }
}
