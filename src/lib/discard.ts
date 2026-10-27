/**
 * Native tab discarding via chrome.tabs.discard.
 * The preferred approach: uses Chrome's built-in tab discard rather than
 * the URL-swap-to-CDN pattern that tabXpert uses.
 */

/** Discard a single tab by its Chrome tab ID. */
export async function discardTab(chromeTabId: number): Promise<void> {
  try {
    await chrome.tabs.discard(chromeTabId);
  } catch (err) {
    // Suppress "already discarded" / "cannot discard" errors
    console.warn('[tabbary] discardTab failed:', err);
  }
}

/** Discard multiple tabs in parallel. */
export async function discardTabs(chromeTabIds: number[]): Promise<void> {
  await Promise.allSettled(chromeTabIds.map((id) => discardTab(id)));
}

/**
 * Check whether a tab is safe to discard.
 * Active tabs, already-discarded tabs, and chrome:// URLs are not discardable.
 */
export function isDiscardable(tab: {
  active?: boolean;
  discarded?: boolean;
  url?: string;
}): boolean {
  if (tab.active) return false;
  if (tab.discarded) return false;
  if (tab.url?.startsWith('chrome://')) return false;
  if (tab.url?.startsWith('chrome-extension://')) return false;
  return true;
}