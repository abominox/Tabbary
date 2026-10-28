import Dexie from 'dexie';
import { db } from '@/db/schema';
import type { Tab } from '@/models';

function now(): number {
  return Date.now();
}

const _tabs = db.tabs as Dexie.Table<Tab, string>;

export const tabsRepo = {
  /** List all non-deleted tabs for a session, ordered by position. */
  async listBySession(sessionId: string): Promise<Tab[]> {
    const results = await _tabs
      .where('sessionId')
      .equals(sessionId)
      .filter(t => !t.deleted)
      .toArray();
    return results.sort((a, b) => a.position - b.position);
  },

  /** Get a single tab by id. */
  async get(id: string): Promise<Tab | undefined> {
    return _tabs.get(id);
  },

  /** Find tab by chrome tab id. */
  async getByChromeTabId(chromeTabId: number): Promise<Tab | undefined> {
    const tabs = await _tabs
      .where('chromeTabId')
      .equals(chromeTabId)
      .filter(t => !t.deleted)
      .toArray();
    return tabs[0];
  },

  /**
   * Closed tabs for a session, newest first.
   *
   * Closing a tab does not delete the row: the autosave soft-deletes it, so the
   * record of what was closed already exists. This is the read side of that.
   */
  async listClosedBySession(sessionId: string, limit = 50): Promise<Tab[]> {
    const rows = await _tabs
      .where('sessionId')
      .equals(sessionId)
      .filter(t => t.deleted)
      .toArray();
    return rows.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  },

  /** Bring a closed tab back. Returns the restored row, or undefined. */
  async restoreClosed(id: string): Promise<Tab | undefined> {
    const tab = await _tabs.get(id);
    if (!tab || !tab.deleted) return undefined;
    const ts = now();
    await _tabs.update(id, { deleted: false, updatedAt: ts });
    return { ...tab, deleted: false, updatedAt: ts };
  },

  /**
   * Keep only the newest `keep` closed tabs for a session.
   *
   * Closed rows are history, not data, so they are hard-deleted once they fall
   * out of the window. Without this a long-lived session accumulates a row for
   * every tab ever closed in it.
   */
  async pruneClosedTabs(sessionId: string, keep = 50): Promise<number> {
    const rows = await _tabs
      .where('sessionId')
      .equals(sessionId)
      .filter(t => t.deleted)
      .toArray();
    if (rows.length <= keep) return 0;
    rows.sort((a, b) => b.updatedAt - a.updatedAt);
    const doomed = rows.slice(keep).map(t => t.id);
    await _tabs.bulkDelete(doomed);
    return doomed.length;
  },

  /** Upsert a single tab (insert or update). */
  async upsert(tab: Tab): Promise<void> {
    const existing = await _tabs.get(tab.id);
    if (existing) {
      await _tabs.update(tab.id, { ...tab, updatedAt: now() });
    } else {
      await _tabs.add({ ...tab, createdAt: tab.createdAt || now(), updatedAt: now() });
    }
  },

  /** Upsert multiple tabs in a single transaction. */
  async upsertMany(tabs: Tab[]): Promise<void> {
    await db.transaction('rw', _tabs, async () => {
      for (const tab of tabs) {
        const existing = await _tabs.get(tab.id);
        if (existing) {
          await _tabs.update(tab.id, { ...tab, updatedAt: now() });
        } else {
          await _tabs.add({ ...tab, createdAt: tab.createdAt || now(), updatedAt: now() });
        }
      }
    });
  },

  /** Reorder tabs by providing the sessionId and an ordered array of tab ids. */
  async setPosition(sessionId: string, orderedIds: string[]): Promise<void> {
    await db.transaction('rw', _tabs, async () => {
      for (let i = 0; i < orderedIds.length; i++) {
        await _tabs.update(orderedIds[i]!, { position: i, updatedAt: now() });
      }
    });
  },

  /** Soft-delete all tabs for a session. */
  async softDeleteBySession(sessionId: string): Promise<void> {
    const existing = await _tabs
      .where('sessionId')
      .equals(sessionId)
      .filter(t => !t.deleted)
      .toArray();
    const ids = existing.map(t => t.id);
    if (ids.length > 0) await _tabs.bulkUpdate(ids.map(id => ({ key: id, changes: { deleted: true, updatedAt: now() } })));
  },

  /** Soft-delete a single tab. */
  async softDelete(id: string): Promise<void> {
    await _tabs.update(id, { deleted: true, updatedAt: now() });
  },

  /**
   * Transactional replace: soft-deletes all existing non-deleted tabs for the session,
   * then inserts the new tabs. Used by auto-save.
   */
  async replaceForSession(sessionId: string, tabs: Tab[]): Promise<void> {
    await db.transaction('rw', _tabs, async () => {
      // Soft-delete existing non-deleted tabs
      const existing = await _tabs
        .where('sessionId')
        .equals(sessionId)
        .filter(t => !t.deleted)
        .toArray();
      for (const t of existing) {
        await _tabs.update(t.id, { deleted: true, updatedAt: now() });
      }

      // Insert (put) new tabs — use put() because the soft-deleted records
      // still occupy the same primary keys in IndexedDB.
      const ts = now();
      for (const tab of tabs) {
        await _tabs.put({ ...tab, createdAt: tab.createdAt || ts, updatedAt: ts });
      }
    });
  },
};