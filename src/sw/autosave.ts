// Debounced auto-save logic for active sessions.
// On every tab/group change, coalesce writes via per-window debounce (250 ms),
// then persist the full tab list + groups + bump version + snapshot (throttled).

import { sessionsRepo, tabsRepo, tabGroupsRepo, sessionVersionsRepo } from '@/db';
import type { Tab, TabGroup, Session } from '@/models';
import { uuid } from '@/lib';
import { swCache } from './cache';
import { broadcast } from '@/messaging';

// ── Per-window debounce timers ──
const pendingSaves = new Map<number, ReturnType<typeof setTimeout>>();

// ── Snapshot throttle state ──
// sessionId → { lastSnapshotAt }
const lastSnapshotAt = new Map<string, number>();

const SNAPSHOT_INTERVAL_MS = 60_000; // snapshot at most every 60s
const SNAPSHOT_VERSION_DELTA = 5;    // snapshot at most every 5 versions

/**
 * Request a debounced save for the session associated with `windowId`.
 * Called by tab/group event handlers.
 */
export function requestSaveSession(windowId: number): void {
  // Cancel any pending save for this window
  const existing = pendingSaves.get(windowId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    pendingSaves.delete(windowId);
    await saveSession(windowId);
  }, 250);

  pendingSaves.set(windowId, timer);
}

/**
 * Immediately persist the current tabs + groups + metadata for the session
 * bound to `windowId`. Idempotent — safe to call multiple times or after close.
 */
async function saveSession(windowId: number): Promise<void> {
  const sessionId = swCache.getSessionForWindow(windowId);
  if (!sessionId) return; // no bound session, nothing to save

  // Check window still exists
  let chromeTabs: chrome.tabs.Tab[];
  let chromeTabGroups: chrome.tabGroups.TabGroup[];
  try {
    chromeTabs = await chrome.tabs.query({ windowId });
    // Get tab groups for this window
    const groups = await chrome.tabGroups.query({ windowId });
    chromeTabGroups = groups;
  } catch {
    // Window no longer exists — skip (onRemoved handles closing the session)
    return;
  }

  // ── Resolve existing Tab IDs from DB so chromeTabId → our ID is stable ──
  const existingTabs = await tabsRepo.listBySession(sessionId);
  const chromeIdToOurId = new Map<number, string>();
  for (const t of existingTabs) {
    if (t.chromeTabId !== null) {
      chromeIdToOurId.set(t.chromeTabId, t.id);
    }
  }

  // ── Map chrome tabs → our Tab records ──
  const ourTabs: Tab[] = chromeTabs.map((ct, idx) => {
    const existingId = ct.id !== undefined ? chromeIdToOurId.get(ct.id) : undefined;
    const groupId = ct.groupId !== undefined && ct.groupId > 0
      ? resolveGroupId(ct.groupId, sessionId)
      : null;

    return {
      id: existingId ?? uuid(),
      sessionId,
      chromeTabId: ct.id ?? null,
      url: ct.url ?? '',
      title: ct.title ?? '',
      favIconUrl: ct.favIconUrl,
      groupId,
      pinned: ct.pinned ?? false,
      position: idx,
      active: ct.active ?? false,
      discarded: ct.discarded ?? false,
      createdAt: existingId ? (existingTabs.find(t => t.id === existingId)?.createdAt ?? Date.now()) : Date.now(),
      updatedAt: Date.now(),
      deleted: false,
    };
  });

  // ── Resolve existing TabGroup IDs from DB so chromeGroupId → our ID is stable ──
  const existingGroups = await tabGroupsRepo.listBySession(sessionId);
  const chromeIdToGroupId = new Map<number, string>();
  for (const g of existingGroups) {
    if (g.chromeGroupId !== null) {
      chromeIdToGroupId.set(g.chromeGroupId, g.id);
    }
  }

  // ── Map chrome tab groups → our TabGroup records ──
  const ourGroups: TabGroup[] = chromeTabGroups.map((cg) => {
    const existingId = chromeIdToGroupId.get(cg.id) ?? swCache.getGroupForChromeId(cg.id);
    const now = Date.now();
    return {
      id: existingId ?? uuid(),
      sessionId,
      chromeGroupId: cg.id,
      title: cg.title ?? '',
      color: (cg.color as TabGroup['color']) ?? 'grey',
      collapsed: cg.collapsed ?? false,
      position: 0, // groups don't have a guaranteed order in the API; we'll set by first tab
      createdAt: existingId ? (existingGroups.find(g => g.id === existingId)?.createdAt ?? now) : now,
      updatedAt: now,
      deleted: false,
    };
  });

  // Assign group positions based on the first member tab's position
  const groupPositions = new Map<number, number>();
  for (let i = 0; i < chromeTabs.length; i++) {
    const ct = chromeTabs[i]!;
    const cgId = ct.groupId;
    if (cgId !== undefined && cgId > 0 && !groupPositions.has(cgId)) {
      groupPositions.set(cgId, i);
    }
  }
  for (const group of ourGroups) {
    if (group.chromeGroupId !== null && groupPositions.has(group.chromeGroupId)) {
      group.position = groupPositions.get(group.chromeGroupId)!;
    }
  }

  // Cache chromeGroupId → our TabGroup id for future lookups
  for (const g of ourGroups) {
    if (g.chromeGroupId !== null) {
      swCache.bindGroup(g.chromeGroupId, g.id);
    }
  }

  // ── Persist ──
  try {
    await tabsRepo.replaceForSession(sessionId, ourTabs);
    await tabGroupsRepo.replaceForSession(sessionId, ourGroups);
    await sessionsRepo.bumpVersion(sessionId);
  } catch (err) {
    console.error('[Windrow SW] saveSession error:', err);
    return;
  }

  // ── Throttled snapshot ──
  await maybeSnapshot(sessionId);

  // ── Broadcast ──
  broadcast({ type: 'tabsChanged', sessionId });
  broadcast({ type: 'sessionsChanged' });
}

/** Resolve a chrome tab.GroupId to our TabGroup id, or create one if needed. */
function resolveGroupId(chromeGroupId: number, sessionId: string): string | null {
  if (chromeGroupId <= 0) return null;
  return swCache.getGroupForChromeId(chromeGroupId) ?? null;
}

/** Snapshot only if enough time or versions have passed since the last one. */
async function maybeSnapshot(sessionId: string): Promise<void> {
  const session = await sessionsRepo.get(sessionId);
  if (!session) return;

  const lastSnapshot = lastSnapshotAt.get(sessionId) ?? 0;
  const now = Date.now();

  if (
    now - lastSnapshot >= SNAPSHOT_INTERVAL_MS ||
    session.version % SNAPSHOT_VERSION_DELTA === 0
  ) {
    try {
      await sessionVersionsRepo.snapshot(sessionId);
      lastSnapshotAt.set(sessionId, now);
    } catch (err) {
      console.error('[Windrow SW] snapshot error:', err);
    }
  }
}

/** Cancel all pending debounced saves (e.g. on shutdown). */
export function cancelPendingSaves(): void {
  for (const [wid, timer] of pendingSaves) {
    clearTimeout(timer);
    pendingSaves.delete(wid);
  }
}