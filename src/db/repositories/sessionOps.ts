/**
 * Session-level mutations used by drag-and-drop, merge, "save a copy" and
 * version restore. Pure IndexedDB operations: no chrome.* calls here, so the
 * behaviour is unit-testable and the service worker decides what to do with
 * live browser windows.
 */

import Dexie from 'dexie';
import { db } from '@/db/schema';
import type { Session, Tab, TabGroup, SessionVersion } from '@/models';
import { sessionVersionsRepo } from './sessionVersions';

const _sessions = db.sessions as Dexie.Table<Session, string>;
const _tabs = db.tabs as Dexie.Table<Tab, string>;
const _groups = db.tabGroups as Dexie.Table<TabGroup, string>;
const _versions = db.sessionVersions as Dexie.Table<SessionVersion, string>;

function uuid(): string {
  return crypto.randomUUID();
}

function now(): number {
  return Date.now();
}

async function liveTabs(sessionId: string): Promise<Tab[]> {
  return (await _tabs.where('sessionId').equals(sessionId).toArray())
    .filter(t => !t.deleted)
    .sort((a, b) => a.position - b.position);
}

async function liveGroups(sessionId: string): Promise<TabGroup[]> {
  return (await _groups.where('sessionId').equals(sessionId).toArray())
    .filter(g => !g.deleted)
    .sort((a, b) => a.position - b.position);
}

export interface MoveTabsResult {
  moved: number;
}

export const sessionOps = {
  /** Move tabs into another session, appending after its existing tabs. */
  async moveTabs(tabIds: string[], targetSessionId: string): Promise<MoveTabsResult> {
    if (tabIds.length === 0) return { moved: 0 };

    return db.transaction('rw', _sessions, _tabs, async () => {
      const target = await _sessions.get(targetSessionId);
      if (!target || target.deleted) return { moved: 0 };

      const targetTabs = await liveTabs(targetSessionId);
      let position = targetTabs.length;

      // Keep the target session's own group ids; a moved tab's old groupId
      // belongs to the source session and would dangle.
      const moved: Tab[] = [];
      for (const id of tabIds) {
        const tab = await _tabs.get(id);
        if (!tab || tab.deleted || tab.sessionId === targetSessionId) continue;
        moved.push(tab);
      }

      const ts = now();
      for (const tab of moved) {
        await _tabs.update(tab.id, {
          sessionId: targetSessionId,
          groupId: null,
          position: position++,
          chromeTabId: null,
          updatedAt: ts,
        });
      }

      if (moved.length > 0) {
        await _sessions.update(targetSessionId, {
          version: target.version + 1,
          updatedAt: ts,
        });
      }
      return { moved: moved.length };
    });
  },

  /** Move a whole tab group (and its tabs) into another session. */
  async moveGroup(groupId: string, targetSessionId: string): Promise<MoveTabsResult> {
    return db.transaction('rw', _sessions, _tabs, _groups, async () => {
      const group = await _groups.get(groupId);
      const target = await _sessions.get(targetSessionId);
      if (!group || group.deleted || !target || target.deleted) return { moved: 0 };
      if (group.sessionId === targetSessionId) return { moved: 0 };

      const members = (await liveTabs(group.sessionId)).filter(t => t.groupId === groupId);
      if (members.length === 0) return { moved: 0 };

      const ts = now();
      const newGroupId = uuid();
      const targetGroups = await liveGroups(targetSessionId);
      const targetTabs = await liveTabs(targetSessionId);

      await _groups.add({
        ...group,
        id: newGroupId,
        sessionId: targetSessionId,
        chromeGroupId: null,
        position: targetGroups.length,
        createdAt: ts,
        updatedAt: ts,
      });
      await _groups.update(groupId, { deleted: true, updatedAt: ts });

      let position = targetTabs.length;
      for (const tab of members) {
        await _tabs.update(tab.id, {
          sessionId: targetSessionId,
          groupId: newGroupId,
          position: position++,
          chromeTabId: null,
          updatedAt: ts,
        });
      }

      await _sessions.update(targetSessionId, { version: target.version + 1, updatedAt: ts });
      return { moved: members.length };
    });
  },

  /**
   * Merge `sourceSessionId` into `targetSessionId`.
   * Tabs whose URL already exists in the target are dropped as duplicates.
   */
  async mergeSession(
    sourceSessionId: string,
    targetSessionId: string,
  ): Promise<{ moved: number; skipped: number; sourceEmptied: boolean }> {
    if (sourceSessionId === targetSessionId) return { moved: 0, skipped: 0, sourceEmptied: false };

    return db.transaction('rw', _sessions, _tabs, _groups, async () => {
      const source = await _sessions.get(sourceSessionId);
      const target = await _sessions.get(targetSessionId);
      if (!source || !target || source.deleted || target.deleted) {
        return { moved: 0, skipped: 0, sourceEmptied: false };
      }

      const sourceTabs = await liveTabs(sourceSessionId);
      const targetTabs = await liveTabs(targetSessionId);

      const seenUrls = new Set(targetTabs.map(t => t.url).filter(Boolean));
      const ts = now();
      let position = targetTabs.length;
      let moved = 0;
      let skipped = 0;

      for (const tab of sourceTabs) {
        if (tab.url && seenUrls.has(tab.url)) {
          skipped++;
          await _tabs.update(tab.id, { deleted: true, updatedAt: ts });
          continue;
        }
        if (tab.url) seenUrls.add(tab.url);
        await _tabs.update(tab.id, {
          sessionId: targetSessionId,
          groupId: null,
          position: position++,
          chromeTabId: null,
          updatedAt: ts,
        });
        moved++;
      }

      // Groups from the source are archived; their tabs now live ungrouped
      // in the target (group ids are session-scoped).
      for (const group of await liveGroups(sourceSessionId)) {
        await _groups.update(group.id, { deleted: true, updatedAt: ts });
      }

      // Merge tags onto the target, de-duplicated.
      const mergedTags = [...new Set([...(target.tags ?? []), ...(source.tags ?? [])])];

      await _sessions.update(targetSessionId, {
        tags: mergedTags,
        version: target.version + 1,
        updatedAt: ts,
      });

      const remaining = await liveTabs(sourceSessionId);
      const sourceEmptied = remaining.length === 0;
      if (sourceEmptied) {
        await _sessions.update(sourceSessionId, {
          deleted: true,
          updatedAt: ts,
          version: source.version + 1,
        });
      } else {
        await _sessions.update(sourceSessionId, { version: source.version + 1, updatedAt: ts });
      }

      return { moved, skipped, sourceEmptied };
    });
  },

  /**
   * Clone a session (tabs, groups, tags) as a new closed session.
   * Used by "Save a copy" and "Clone revision".
   */
  async duplicateSession(sessionId: string, name?: string): Promise<Session | null> {
    return db.transaction('rw', _sessions, _tabs, _groups, async () => {
      const source = await _sessions.get(sessionId);
      if (!source || source.deleted) return null;

      const sourceTabs = await liveTabs(sessionId);
      const sourceGroups = await liveGroups(sessionId);

      const ts = now();
      const newId = uuid();

      const copy: Session = {
        ...source,
        id: newId,
        name: name ?? (source.name ? `${source.name} (copy)` : null),
        windowId: null,
        state: 'closed',
        closedAt: ts,
        createdAt: ts,
        updatedAt: ts,
        version: 1,
      };
      await _sessions.add(copy);

      // Remap group ids so the copy owns its own groups.
      const groupIdMap = new Map<string, string>();
      for (const group of sourceGroups) {
        const gid = uuid();
        groupIdMap.set(group.id, gid);
        await _groups.add({
          ...group,
          id: gid,
          sessionId: newId,
          chromeGroupId: null,
          createdAt: ts,
          updatedAt: ts,
        });
      }

      for (const tab of sourceTabs) {
        await _tabs.add({
          ...tab,
          id: uuid(),
          sessionId: newId,
          chromeTabId: null,
          groupId: tab.groupId ? (groupIdMap.get(tab.groupId) ?? null) : null,
          createdAt: ts,
          updatedAt: ts,
        });
      }

      return copy;
    });
  },

  /**
   * Restore a version's tabs/groups as the current state of its session.
   *
   * The current state is snapshotted first, so a restore is reversible.
   * Live tabs are detached (chromeTabId = null): the service worker closes the
   * old browser tabs and opens the restored ones.
   */
  async restoreVersion(versionId: string): Promise<{ sessionId: string; tabCount: number } | null> {
    const version = await _versions.get(versionId);
    if (!version) return null;
    const sessionId = version.sessionId;
    const session = await _sessions.get(sessionId);
    if (!session) return null;

    // Snapshot before mutating — never make a restore a one-way door.
    await sessionVersionsRepo.snapshot(sessionId);

    return db.transaction('rw', _sessions, _tabs, _groups, async () => {
      const ts = now();

      for (const tab of await liveTabs(sessionId)) {
        await _tabs.update(tab.id, { deleted: true, updatedAt: ts });
      }
      for (const group of await liveGroups(sessionId)) {
        await _groups.update(group.id, { deleted: true, updatedAt: ts });
      }

      const groupIdMap = new Map<string, string>();
      for (const group of version.snapshot.groups) {
        const gid = uuid();
        groupIdMap.set(group.id, gid);
        await _groups.add({
          ...group,
          id: gid,
          sessionId,
          chromeGroupId: null,
          createdAt: ts,
          updatedAt: ts,
        });
      }

      let position = 0;
      for (const tab of version.snapshot.tabs) {
        await _tabs.add({
          ...tab,
          id: uuid(),
          sessionId,
          chromeTabId: null,
          groupId: tab.groupId ? (groupIdMap.get(tab.groupId) ?? null) : null,
          position: position++,
          active: false,
          createdAt: ts,
          updatedAt: ts,
        });
      }

      await _sessions.update(sessionId, {
        name: version.snapshot.name ?? session.name,
        version: session.version + 1,
        updatedAt: ts,
      });

      return { sessionId, tabCount: version.snapshot.tabs.length };
    });
  },

  /** Replace a session's tags (tag names, as stored on the session). */
  async setSessionTags(sessionId: string, tags: string[]): Promise<void> {
    const session = await _sessions.get(sessionId);
    if (!session) return;
    const clean = [...new Set(tags.map(t => t.trim()).filter(Boolean))];
    await _sessions.update(sessionId, {
      tags: clean,
      version: session.version + 1,
      updatedAt: now(),
    });
  },
};
