import Dexie from 'dexie';
import { db } from '@/db/schema';
import type { TabGroup } from '@/models';

function now(): number {
  return Date.now();
}

const _tabGroups = db.tabGroups as Dexie.Table<TabGroup, string>;

export const tabGroupsRepo = {
  /** List all non-deleted groups for a session, ordered by position. */
  async listBySession(sessionId: string): Promise<TabGroup[]> {
    const results = await _tabGroups
      .where('sessionId')
      .equals(sessionId)
      .filter(t => !t.deleted)
      .toArray();
    return results.sort((a, b) => a.position - b.position);
  },

  /** Get a single group by id. */
  async get(id: string): Promise<TabGroup | undefined> {
    return _tabGroups.get(id);
  },

  /** Find group by chrome group id. */
  async getByChromeGroupId(chromeGroupId: number): Promise<TabGroup | undefined> {
    const groups = await _tabGroups
      .where('chromeGroupId')
      .equals(chromeGroupId)
      .filter(t => !t.deleted)
      .toArray();
    return groups[0];
  },

  /** Upsert a single group. */
  async upsert(group: TabGroup): Promise<void> {
    const existing = await _tabGroups.get(group.id);
    const ts = now();
    if (existing) {
      await _tabGroups.update(group.id, { ...group, updatedAt: ts });
    } else {
      await _tabGroups.add({ ...group, createdAt: group.createdAt || ts, updatedAt: ts });
    }
  },

  /** Upsert multiple groups in a transaction. */
  async upsertMany(groups: TabGroup[]): Promise<void> {
    await db.transaction('rw', _tabGroups, async () => {
      const ts = now();
      for (const group of groups) {
        const existing = await _tabGroups.get(group.id);
        if (existing) {
          await _tabGroups.update(group.id, { ...group, updatedAt: ts });
        } else {
          await _tabGroups.add({ ...group, createdAt: group.createdAt || ts, updatedAt: ts });
        }
      }
    });
  },

  /** Soft-delete a single group. */
  async softDelete(id: string): Promise<void> {
    await _tabGroups.update(id, { deleted: true, updatedAt: now() });
  },

  /**
   * Transactional replace: soft-deletes existing non-deleted groups for the session,
   * then inserts new groups. Used by auto-save.
   */
  async replaceForSession(sessionId: string, groups: TabGroup[]): Promise<void> {
    await db.transaction('rw', _tabGroups, async () => {
      // Soft-delete existing non-deleted groups
      const existing = await _tabGroups
        .where('sessionId')
        .equals(sessionId)
        .filter(t => !t.deleted)
        .toArray();
      for (const g of existing) {
        await _tabGroups.update(g.id, { deleted: true, updatedAt: now() });
      }

      // Insert (put) new groups — use put() because the soft-deleted records
      // still occupy the same primary keys in IndexedDB.
      const ts = now();
      for (const group of groups) {
        await _tabGroups.put({ ...group, createdAt: group.createdAt || ts, updatedAt: ts });
      }
    });
  },
};