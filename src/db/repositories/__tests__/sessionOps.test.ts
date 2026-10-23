import { describe, it, expect, beforeEach } from 'vitest';
import type { Session, Tab, TabGroup } from '@/models';
import { db } from '@/db/schema';
import { sessionsRepo } from '@/db/repositories/sessions';
import { tabsRepo } from '@/db/repositories/tabs';
import { tabGroupsRepo } from '@/db/repositories/tabGroups';
import { sessionVersionsRepo } from '@/db/repositories/sessionVersions';
import { sessionOps } from '@/db/repositories/sessionOps';

function session(overrides: Partial<Session> = {}): Session {
  const ts = Date.now();
  return {
    id: `s-${Math.random().toString(36).slice(2, 8)}`,
    name: null,
    windowId: null,
    state: 'closed',
    mode: 'multi-window',
    tags: [],
    pinnedTabUrls: [],
    createdAt: ts,
    updatedAt: ts,
    closedAt: ts,
    version: 1,
    deleted: false,
    ...overrides,
  };
}

function tab(sessionId: string, position: number, overrides: Partial<Tab> = {}): Tab {
  const ts = Date.now();
  return {
    id: `t-${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    chromeTabId: null,
    url: `https://example.com/${position}`,
    title: `Tab ${position}`,
    groupId: null,
    pinned: false,
    position,
    active: false,
    discarded: false,
    createdAt: ts,
    updatedAt: ts,
    deleted: false,
    ...overrides,
  };
}

function group(sessionId: string, overrides: Partial<TabGroup> = {}): TabGroup {
  const ts = Date.now();
  return {
    id: `g-${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    chromeGroupId: null,
    title: 'Group',
    color: 'blue',
    collapsed: false,
    position: 0,
    createdAt: ts,
    updatedAt: ts,
    deleted: false,
    ...overrides,
  };
}

describe('sessionOps', () => {
  beforeEach(async () => {
    await Promise.all([
      db.sessions.clear(),
      db.tabs.clear(),
      db.tabGroups.clear(),
      db.sessionVersions.clear(),
    ]);
  });

  describe('moveTabs', () => {
    it('moves tabs to the target and appends them after existing tabs', async () => {
      const a = session({ id: 'a' });
      const b = session({ id: 'b' });
      await sessionsRepo.create(a);
      await sessionsRepo.create(b);

      const t1 = tab('a', 0);
      const t2 = tab('a', 1);
      const existing = tab('b', 0);
      await tabsRepo.upsertMany([t1, t2, existing]);

      const result = await sessionOps.moveTabs([t1.id, t2.id], 'b');

      expect(result.moved).toBe(2);
      expect(await tabsRepo.listBySession('a')).toHaveLength(0);
      const bTabs = await tabsRepo.listBySession('b');
      expect(bTabs).toHaveLength(3);
      expect(bTabs.map(t => t.position)).toEqual([0, 1, 2]);
      expect(bTabs[1]!.sessionId).toBe('b');
    });

    it('clears groupId so moved tabs do not reference the source session groups', async () => {
      await sessionsRepo.create(session({ id: 'a' }));
      await sessionsRepo.create(session({ id: 'b' }));
      const g = group('a');
      await db.tabGroups.add(g);
      const t = tab('a', 0, { groupId: g.id });
      await tabsRepo.upsert(t);

      await sessionOps.moveTabs([t.id], 'b');

      const [moved] = await tabsRepo.listBySession('b');
      expect(moved!.groupId).toBeNull();
    });

    it('ignores tabs already in the target and unknown ids', async () => {
      await sessionsRepo.create(session({ id: 'a' }));
      const t = tab('a', 0);
      await tabsRepo.upsert(t);

      const result = await sessionOps.moveTabs([t.id, 'nope'], 'a');
      expect(result.moved).toBe(0);
      expect(await tabsRepo.listBySession('a')).toHaveLength(1);
    });
  });

  describe('mergeSession', () => {
    it('moves unique tabs and reports duplicates as skipped', async () => {
      await sessionsRepo.create(session({ id: 'src', tags: ['one'] }));
      await sessionsRepo.create(session({ id: 'dst', tags: ['two'] }));

      const dup = tab('src', 0, { url: 'https://same.test' });
      const unique = tab('src', 1, { url: 'https://unique.test' });
      const inDst = tab('dst', 0, { url: 'https://same.test' });
      await tabsRepo.upsertMany([dup, unique, inDst]);

      const result = await sessionOps.mergeSession('src', 'dst');

      expect(result.moved).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.sourceEmptied).toBe(true);

      const dstTabs = await tabsRepo.listBySession('dst');
      expect(dstTabs.map(t => t.url).sort()).toEqual([
        'https://same.test',
        'https://unique.test',
      ]);
    });

    it('merges tags without duplicates and archives an emptied source', async () => {
      await sessionsRepo.create(session({ id: 'src', tags: ['shared', 'src-only'] }));
      await sessionsRepo.create(session({ id: 'dst', tags: ['shared', 'dst-only'] }));
      await tabsRepo.upsert(tab('src', 0, { url: 'https://x.test' }));

      await sessionOps.mergeSession('src', 'dst');

      const dst = await sessionsRepo.get('dst');
      expect(dst!.tags.sort()).toEqual(['dst-only', 'shared', 'src-only']);

      const src = await sessionsRepo.get('src');
      expect(src!.deleted).toBe(true);
    });

    it('refuses to merge a session into itself', async () => {
      await sessionsRepo.create(session({ id: 'a' }));
      const result = await sessionOps.mergeSession('a', 'a');
      expect(result).toEqual({ moved: 0, skipped: 0, sourceEmptied: false });
    });
  });

  describe('duplicateSession', () => {
    it('copies tabs and remaps group ids to the new session', async () => {
      await sessionsRepo.create(session({ id: 'src', name: 'Research', tags: ['x'] }));
      const g = group('src');
      await db.tabGroups.add(g);
      await tabsRepo.upsertMany([
        tab('src', 0, { groupId: g.id }),
        tab('src', 1, { groupId: g.id }),
      ]);

      const copy = await sessionOps.duplicateSession('src');

      expect(copy).not.toBeNull();
      expect(copy!.id).not.toBe('src');
      expect(copy!.name).toBe('Research (copy)');
      expect(copy!.state).toBe('closed');
      expect(copy!.tags).toEqual(['x']);

      const copyTabs = await tabsRepo.listBySession(copy!.id);
      expect(copyTabs).toHaveLength(2);
      // Group ids must be remapped, never shared with the source session.
      expect(copyTabs[0]!.groupId).not.toBe(g.id);
      expect(copyTabs[0]!.groupId).toBe(copyTabs[1]!.groupId);
    });
  });

  describe('restoreVersion', () => {
    it('snapshots the current state first, then replaces tabs with the revision', async () => {
      await sessionsRepo.create(session({ id: 's', name: 'Live' }));
      await tabsRepo.upsert(tab('s', 0, { url: 'https://old.test' }));

      const version = await sessionVersionsRepo.snapshot('s');
      expect(version.snapshot.tabs).toHaveLength(1);

      // Diverge: replace the tab set.
      await tabsRepo.replaceForSession('s', [tab('s', 0, { url: 'https://new.test' })]);

      const result = await sessionOps.restoreVersion(version.id);
      expect(result).not.toBeNull();
      expect(result!.tabCount).toBe(1);

      const restored = await tabsRepo.listBySession('s');
      expect(restored.map(t => t.url)).toEqual(['https://old.test']);

      // The pre-restore state must still be recoverable.
      const versions = await sessionVersionsRepo.list('s');
      const urls = versions.flatMap(v => v.snapshot.tabs.map(t => t.url));
      expect(urls).toContain('https://new.test');
    });

    it('returns null for a missing version', async () => {
      expect(await sessionOps.restoreVersion('missing')).toBeNull();
    });
  });

  describe('setSessionTags', () => {
    it('trims, de-duplicates and ignores empty tags', async () => {
      await sessionsRepo.create(session({ id: 's' }));
      await sessionOps.setSessionTags('s', ['  work ', 'work', '', 'home']);
      const s = await sessionsRepo.get('s');
      expect(s!.tags).toEqual(['work', 'home']);
    });
  });
});
