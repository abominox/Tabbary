import { describe, it, expect, beforeEach } from 'vitest';
import Dexie from 'dexie';
import { WindrowDB } from '@/db/schema';
import type { Session, Tab, TabGroup, SessionVersion } from '@/models';
import { sessionVersionsRepo } from '@/db/repositories/sessionVersions';

/** Cast tables for runtime string key access (Dexie type 'id' literal is too strict). */
const _sessions = (db: WindrowDB) => db.sessions as Dexie.Table<Session, string>;
const _tabs = (db: WindrowDB) => db.tabs as Dexie.Table<Tab, string>;
const _tabGroups = (db: WindrowDB) => db.tabGroups as Dexie.Table<TabGroup, string>;
const _sv = (db: WindrowDB) => db.sessionVersions as Dexie.Table<SessionVersion, string>;

/**
 * Helper: seed a session with tabs + groups so snapshot() can read them.
 */
async function seedSession(
  d: WindrowDB,
  overrides: Partial<Session> & { id: string; version?: number },
): Promise<void> {
  const session: Session = {
    id: overrides.id,
    name: overrides.name ?? null,
    windowId: overrides.windowId ?? null,
    state: overrides.state ?? 'active',
    mode: 'multi-window',
    tags: [],
    pinnedTabUrls: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    closedAt: null,
    version: overrides.version ?? 1,
    deleted: false,
  };
  await _sessions(d).add(session);
}

function makeTab(sessionId: string, position: number, overrides: Partial<Tab> = {}): Tab {
  return {
    id: `tab-${sessionId}-${position}`,
    sessionId,
    chromeTabId: null,
    url: `https://example.com/${position}`,
    title: `Tab ${position}`,
    groupId: null,
    pinned: false,
    position,
    active: position === 0,
    discarded: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deleted: false,
    ...overrides,
  };
}

function makeGroup(sessionId: string, position: number, overrides: Partial<TabGroup> = {}): TabGroup {
  return {
    id: `grp-${sessionId}-${position}`,
    sessionId,
    chromeGroupId: null,
    title: `Group ${position}`,
    color: 'blue',
    collapsed: false,
    position,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deleted: false,
    ...overrides,
  };
}

describe('sessionVersionsRepo', () => {
  let db: WindrowDB;

  beforeEach(async () => {
    db = new WindrowDB();
    // Clear all tables to keep tests isolated; wait for DB to be ready
    await db.sessions.clear().catch(() => {});
    await db.tabs.clear().catch(() => {});
    await db.tabGroups.clear().catch(() => {});
    await db.tags.clear().catch(() => {});
    await db.bookmarks.clear().catch(() => {});
    await db.sessionVersions.clear().catch(() => {});
  });

  describe('snapshot', () => {
    it('creates a version doc with tabs, groups and name', async () => {
      await seedSession(db, { id: 's1', name: 'Research', version: 3 });
      await _tabs(db).add(makeTab('s1', 0));
      await _tabs(db).add(makeTab('s1', 1));
      await _tabGroups(db).add(makeGroup('s1', 0));

      const version = await sessionVersionsRepo.snapshot('s1');

      expect(version).toBeDefined();
      expect(version.sessionId).toBe('s1');
      expect(version.version).toBe(3);
      expect(version.snapshot.name).toBe('Research');
      expect(version.snapshot.tabs).toHaveLength(2);
      expect(version.snapshot.groups).toHaveLength(1);
      expect(version.id).toBeTruthy();
      expect(version.createdAt).toBeGreaterThan(0);
    });

    it('snapshot captures the current tab positions in order', async () => {
      await seedSession(db, { id: 's2', version: 1 });
      await _tabs(db).add(makeTab('s2', 1, { position: 1 }));
      await _tabs(db).add(makeTab('s2', 0, { position: 0 }));
      await _tabs(db).add(makeTab('s2', 2, { position: 2 }));

      const version = await sessionVersionsRepo.snapshot('s2');
      expect(version.snapshot.tabs).toHaveLength(3);
      // should be ordered by position: 0, 1, 2
      expect(version.snapshot.tabs[0]!.position).toBe(0);
      expect(version.snapshot.tabs[1]!.position).toBe(1);
      expect(version.snapshot.tabs[2]!.position).toBe(2);
    });

    it('throws on nonexistent session', async () => {
      await expect(sessionVersionsRepo.snapshot('nope')).rejects.toThrow('Session not found');
    });

    describe('pruning — per-session cap (10)', () => {
      it('keeps at most 10 versions per session', async () => {
        await seedSession(db, { id: 's3', version: 1 });

        // Create 15 versions
        for (let i = 0; i < 15; i++) {
          await _sessions(db).update('s3', { version: i + 1 });
          await sessionVersionsRepo.snapshot('s3');
        }

        const versions = await _sv(db)
          .where({ sessionId: 's3' })
          .toArray();

        // 10 should remain (oldest 5 pruned)
        expect(versions.length).toBe(10);

        // The remaining should be the 10 newest (versions 6..15)
        const versionNums = versions.map(v => v.version).sort((a, b) => a - b);
        expect(versionNums).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
      });

      it('keeps versions for other sessions when pruning one session', async () => {
        await seedSession(db, { id: 's3a', version: 1 });
        for (let i = 0; i < 12; i++) {
          await _sessions(db).update('s3a', { version: i + 1 });
          await sessionVersionsRepo.snapshot('s3a');
        }

        const s3aVersions = await _sv(db)
          .where({ sessionId: 's3a' })
          .toArray();
        expect(s3aVersions.length).toBe(10);
      });
    });

    describe('pruning — global cap (500)', () => {
      it('enforces global cap of 500 version docs across all sessions', async () => {
        // Insert 600 version docs directly (6 sessions × 100), bypassing snapshot()'s
        // per-session prune so the global total actually reaches 600. Then pruneGlobal()
        // (called periodically by the SW alarm per PLAN §8) enforces the 500 cap,
        // deleting the 100 oldest (all of g0, the first session).
        for (let s = 0; s < 6; s++) {
          const sid = `g${s}`;
          await seedSession(db, { id: sid, version: 1 });
          const docs: SessionVersion[] = [];
          for (let v = 0; v < 100; v++) {
            docs.push({
              id: crypto.randomUUID(),
              sessionId: sid,
              version: v + 1,
              snapshot: { tabs: [], groups: [], name: null },
              // Stagger createdAt so g0 is oldest, g5 newest (oldest-first prune).
              createdAt: Date.now() + s * 100_000 + v,
            });
          }
          await _sv(db).bulkAdd(docs);
        }

        expect((await _sv(db).toArray()).length).toBe(600);

        await sessionVersionsRepo.pruneGlobal(500);

        const allVersions = await _sv(db).toArray();
        expect(allVersions.length).toBe(500);

        // The 100 oldest (g0) should be pruned; g1–g5 keep all 100 each.
        const fromG0 = allVersions.filter(v => v.sessionId === 'g0');
        expect(fromG0.length).toBe(0);

        const fromG1 = allVersions.filter(v => v.sessionId === 'g1');
        expect(fromG1.length).toBe(100);
        const fromG5 = allVersions.filter(v => v.sessionId === 'g5');
        expect(fromG5.length).toBe(100);
      });
    });
  });

  describe('list', () => {
    it('returns versions newest first', async () => {
      await seedSession(db, { id: 's4', version: 1 });
      const v1 = await sessionVersionsRepo.snapshot('s4');
      await _sessions(db).update('s4', { version: 2 });
      const v2 = await sessionVersionsRepo.snapshot('s4');

      const versions = await sessionVersionsRepo.list('s4');
      expect(versions).toHaveLength(2);
      // newest first → v2 (version 2) then v1 (version 1)
      expect(versions[0]!.version).toBe(2);
      expect(versions[1]!.version).toBe(1);
    });

    it('list respects limit option', async () => {
      await seedSession(db, { id: 's5', version: 1 });
      for (let i = 0; i < 5; i++) {
        await _sessions(db).update('s5', { version: i + 1 });
        await sessionVersionsRepo.snapshot('s5');
      }

      const limited = await sessionVersionsRepo.list('s5', { limit: 3 });
      expect(limited).toHaveLength(3);
    });
  });

  describe('get', () => {
    it('returns a version doc by id', async () => {
      await seedSession(db, { id: 's6', version: 1 });
      const created = await sessionVersionsRepo.snapshot('s6');

      const got = await sessionVersionsRepo.get(created.id);
      expect(got).toBeDefined();
      expect(got!.id).toBe(created.id);
    });

    it('returns undefined for missing id', async () => {
      const got = await sessionVersionsRepo.get('nonexistent');
      expect(got).toBeUndefined();
    });
  });

  describe('restore', () => {
    it('returns snapshot data for a version', async () => {
      await seedSession(db, { id: 's7', name: 'RestoreTest', version: 1 });
      await _tabs(db).add(makeTab('s7', 0));
      await _tabGroups(db).add(makeGroup('s7', 0));
      const created = await sessionVersionsRepo.snapshot('s7');

      const restored = await sessionVersionsRepo.restore(created.id);
      expect(restored).toBeDefined();
      expect(restored!.name).toBe('RestoreTest');
      expect(restored!.tabs).toHaveLength(1);
      expect(restored!.groups).toHaveLength(1);
    });

    it('returns undefined for missing version', async () => {
      const restored = await sessionVersionsRepo.restore('nope');
      expect(restored).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('deletes a version doc', async () => {
      await seedSession(db, { id: 's8', version: 1 });
      const created = await sessionVersionsRepo.snapshot('s8');

      await sessionVersionsRepo.delete(created.id);
      const got = await sessionVersionsRepo.get(created.id);
      expect(got).toBeUndefined();
    });
  });
});