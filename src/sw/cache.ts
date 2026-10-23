// In-memory caches for fast lookups in the SW.
// Rebuilt on service-worker startup from active sessions in IndexedDB.
// Avoids calling buggy non-indexed Dexie queries (e.g. getByWindowId, getByChromeGroupId).

import type { Session } from '@/models';

// windowId → sessionId
const windowSession = new Map<number, string>();

// chromeGroupId → tabGroupId
const chromeGroup = new Map<number, string>();

export const swCache = {
  // ── Window ↔ Session ──

  bindWindow(windowId: number, sessionId: string): void {
    windowSession.set(windowId, sessionId);
  },

  unbindWindow(windowId: number): void {
    windowSession.delete(windowId);
  },

  getSessionForWindow(windowId: number): string | undefined {
    return windowSession.get(windowId);
  },

  getAllWindowIds(): number[] {
    return [...windowSession.keys()];
  },

  // ── Chrome TabGroup ↔ our TabGroup ──

  bindGroup(chromeGroupId: number, tabGroupId: string): void {
    chromeGroup.set(chromeGroupId, tabGroupId);
  },

  unbindGroup(chromeGroupId: number): void {
    chromeGroup.delete(chromeGroupId);
  },

  getGroupForChromeId(chromeGroupId: number): string | undefined {
    return chromeGroup.get(chromeGroupId);
  },

  // ── Rebuild ──

  /** Rebuild both caches from a list of active sessions + their tab groups. */
  rebuildFromActiveSessions(activeSessions: Session[]): void {
    windowSession.clear();
    chromeGroup.clear();
    for (const s of activeSessions) {
      if (s.windowId !== null) {
        windowSession.set(s.windowId, s.id);
      }
    }
  },
};
