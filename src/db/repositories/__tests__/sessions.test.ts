import { describe, it, expect, beforeEach } from 'vitest';
import Dexie from 'dexie';
import { WindrowDB } from '@/db/schema';
import type { Session } from '@/models';
import { sessionsRepo } from '@/db/repositories/sessions';

/** Cast tables for runtime string key access (Dexie type 'id' literal is too strict). */
const _s = (db: WindrowDB) => db.sessions as Dexie.Table<Session, string>;

function createTestSession(overrides: Partial<Session> = {}): Session {
  return {
    id: `sess-${Math.random().toString(36).slice(2, 8)}`,
    name: null,
    windowId: null,
    state: 'active',
    mode: 'multi-window',
    tags: [],
    pinnedTabUrls: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    closedAt: null,
    version: 1,
    deleted: false,
    ...overrides,
  };
}

describe('sessionsRepo', () => {
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

  describe('create', () => {
    it('inserts a session with version=1 and timestamps', async () => {
      const s = createTestSession({ id: 's1', name: 'Test Session' });
      await sessionsRepo.create(s);

      const got = await _s(db).get('s1');
      expect(got).toBeDefined();
      expect(got!.id).toBe('s1');
      expect(got!.name).toBe('Test Session');
      expect(got!.version).toBe(1);
      expect(got!.createdAt).toBeGreaterThan(0);
      expect(got!.updatedAt).toBeGreaterThan(0);
    });
  });

  describe('get', () => {
    it('returns undefined for missing session', async () => {
      const got = await sessionsRepo.get('nonexistent');
      expect(got).toBeUndefined();
    });

    it('returns a session by id', async () => {
      const s = createTestSession({ id: 's2' });
      await _s(db).add(s);
      const got = await sessionsRepo.get('s2');
      expect(got).toBeDefined();
      expect(got!.id).toBe('s2');
    });
  });

  describe('getByWindowId', () => {
    it('returns the active session for a window', async () => {
      const s = createTestSession({ id: 's3', windowId: 42, state: 'active' });
      await _s(db).add(s);
      const got = await sessionsRepo.getByWindowId(42);
      expect(got).toBeDefined();
      expect(got!.id).toBe('s3');
    });

    it('returns undefined for inactive window id', async () => {
      const s = createTestSession({ id: 's4', windowId: 99, state: 'closed' });
      await _s(db).add(s);
      const got = await sessionsRepo.getByWindowId(99);
      expect(got).toBeUndefined();
    });
  });

  describe('listActive / listClosed', () => {
    it('lists active sessions ordered by updatedAt desc', async () => {
      const now = Date.now();
      const a = createTestSession({ id: 'a', state: 'active', updatedAt: now });
      const b = createTestSession({ id: 'b', state: 'active', updatedAt: now + 100 });
      const c = createTestSession({ id: 'c', state: 'closed', updatedAt: now + 200 });
      await _s(db).bulkAdd([a, b, c]);

      const active = await sessionsRepo.listActive();
      expect(active).toHaveLength(2);
      expect(active[0]!.id).toBe('b');
      expect(active[1]!.id).toBe('a');
    });

    it('lists closed sessions ordered by updatedAt desc', async () => {
      const now = Date.now();
      const a = createTestSession({ id: 'a', state: 'closed', updatedAt: now });
      const b = createTestSession({ id: 'b', state: 'closed', updatedAt: now + 50 });
      await _s(db).bulkAdd([a, b]);

      const closed = await sessionsRepo.listClosed();
      expect(closed).toHaveLength(2);
      expect(closed[0]!.id).toBe('b');
      expect(closed[1]!.id).toBe('a');
    });

    it('listClosed respects limit option', async () => {
      const now = Date.now();
      const a = createTestSession({ id: 'a', state: 'closed', updatedAt: now });
      const b = createTestSession({ id: 'b', state: 'closed', updatedAt: now + 50 });
      const c = createTestSession({ id: 'c', state: 'closed', updatedAt: now + 100 });
      await _s(db).bulkAdd([a, b, c]);

      const limited = await sessionsRepo.listClosed({ limit: 2 });
      expect(limited).toHaveLength(2);
      expect(limited[0]!.id).toBe('c');
      expect(limited[1]!.id).toBe('b');
    });

    it('listClosed filters by tagId when provided', async () => {
      const now = Date.now();
      const a = createTestSession({ id: 'a', state: 'closed', tags: ['tag1'], updatedAt: now });
      const b = createTestSession({ id: 'b', state: 'closed', tags: ['tag2'], updatedAt: now + 50 });
      await _s(db).bulkAdd([a, b]);

      const tagged = await sessionsRepo.listClosed({ tagId: 'tag1' });
      expect(tagged).toHaveLength(1);
      expect(tagged[0]!.id).toBe('a');
    });
  });

  describe('update', () => {
    it('updates fields and bumps version', async () => {
      const s = createTestSession({ id: 'u1', name: 'Old', version: 3 });
      await _s(db).add(s);

      await sessionsRepo.update('u1', { name: 'New Name' });

      const got = await _s(db).get('u1');
      expect(got!.name).toBe('New Name');
      expect(got!.version).toBe(4);
    });
  });

  describe('bumpVersion', () => {
    it('increments version and updatedAt', async () => {
      const s = createTestSession({ id: 'bv1', version: 5 });
      await _s(db).add(s);

      await sessionsRepo.bumpVersion('bv1');

      const got = await _s(db).get('bv1');
      expect(got!.version).toBe(6);
    });
  });

  describe('markClosed', () => {
    it('sets state=closed, clears windowId, sets closedAt, bumps version', async () => {
      const s = createTestSession({
        id: 'mc1',
        state: 'active',
        windowId: 100,
        closedAt: null,
        version: 2,
      });
      await _s(db).add(s);

      await sessionsRepo.markClosed('mc1');

      const got = await _s(db).get('mc1');
      expect(got!.state).toBe('closed');
      expect(got!.windowId).toBeNull();
      expect(got!.closedAt).toBeGreaterThan(0);
      expect(got!.version).toBe(3);
    });
  });

  describe('markActive', () => {
    it('sets state=active, windowId, clears closedAt, bumps version', async () => {
      const s = createTestSession({
        id: 'ma1',
        state: 'closed',
        windowId: null,
        closedAt: 1000,
        version: 2,
      });
      await _s(db).add(s);

      await sessionsRepo.markActive('ma1', 200);

      const got = await _s(db).get('ma1');
      expect(got!.state).toBe('active');
      expect(got!.windowId).toBe(200);
      expect(got!.closedAt).toBeNull();
      expect(got!.version).toBe(3);
    });
  });

  describe('softDelete', () => {
    it('marks session as deleted', async () => {
      const s = createTestSession({ id: 'sd1' });
      await _s(db).add(s);

      await sessionsRepo.softDelete('sd1');

      const got = await _s(db).get('sd1');
      expect(got!.deleted).toBe(true);
    });
  });

  describe('rename', () => {
    it('renames and bumps version', async () => {
      const s = createTestSession({ id: 'rn1', name: 'Old', version: 7 });
      await _s(db).add(s);

      await sessionsRepo.rename('rn1', 'Renamed');

      const got = await _s(db).get('rn1');
      expect(got!.name).toBe('Renamed');
      expect(got!.version).toBe(8);
    });
  });
});