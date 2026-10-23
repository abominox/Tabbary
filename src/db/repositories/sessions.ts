import Dexie from 'dexie';
import { db } from '@/db/schema';
import type { Session } from '@/models';

function now(): number {
  return Date.now();
}

// Cast to string key — Dexie's 'id' literal is too strict for runtime string ids
const _sessions = db.sessions as Dexie.Table<Session, string>;

export const sessionsRepo = {
  /** Return all active (non-deleted) sessions, newest updatedAt first. */
  async listActive(): Promise<Session[]> {
    const results = await _sessions
      .where('state')
      .equals('active')
      .toArray();
    return results
      .filter(s => !s.deleted)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },

  /** Return closed (non-deleted) sessions, newest updatedAt first. */
  async listClosed(opts?: { limit?: number; tagId?: string }): Promise<Session[]> {
    let results = await _sessions
      .where('state')
      .equals('closed')
      .toArray();
    results = results.filter(s => !s.deleted);

    if (opts?.tagId) {
      results = results.filter(s => s.tags.includes(opts.tagId!));
    }

    results.sort((a, b) => b.updatedAt - a.updatedAt);
    return opts?.limit ? results.slice(0, opts.limit) : results;
  },

  /** Get a single session by id. */
  async get(id: string): Promise<Session | undefined> {
    return _sessions.get(id);
  },

  /** Get session by chrome windowId (only for active sessions). */
  async getByWindowId(windowId: number): Promise<Session | undefined> {
    const all = await _sessions.toArray();
    return all.find(s =>
      s.windowId === windowId &&
      s.state === 'active' &&
      !s.deleted
    );
  },

  /** Create a new session. Sets version=1 and timestamps. */
  async create(session: Session): Promise<void> {
    const record: Session = {
      ...session,
      version: 1,
      createdAt: session.createdAt || now(),
      updatedAt: now(),
    };
    await _sessions.add(record);
  },

  /** Update a session with partial fields. Bumps version and updatedAt. */
  async update(id: string, patch: Partial<Session>): Promise<void> {
    await db.transaction('rw', _sessions, async () => {
      const existing = await _sessions.get(id);
      if (!existing) return;
      const merged: Partial<Session> = {
        ...patch,
        version: existing.version + 1,
        updatedAt: now(),
      };
      await _sessions.update(id, merged);
    });
  },

  /** Bump version and updatedAt only. */
  async bumpVersion(id: string): Promise<void> {
    await _sessions.where(':id').equals(id).modify(s => {
      s.version++;
      s.updatedAt = now();
    });
  },

  /** Mark session as closed. Bumps version. */
  async markClosed(id: string): Promise<void> {
    await db.transaction('rw', _sessions, async () => {
      const existing = await _sessions.get(id);
      if (!existing) return;
      await _sessions.update(id, {
        state: 'closed' as const,
        windowId: null,
        closedAt: now(),
        version: existing.version + 1,
        updatedAt: now(),
      });
    });
  },

  /** Mark session as active with a windowId. Clears closedAt, bumps version. */
  async markActive(id: string, windowId: number): Promise<void> {
    await db.transaction('rw', _sessions, async () => {
      const existing = await _sessions.get(id);
      if (!existing) return;
      await _sessions.update(id, {
        state: 'active' as const,
        windowId,
        closedAt: null,
        version: existing.version + 1,
        updatedAt: now(),
      });
    });
  },

  /** Soft-delete a session. */
  async softDelete(id: string): Promise<void> {
    await _sessions.update(id, { deleted: true, updatedAt: now() });
  },

  /** Rename a session. Bumps version. */
  async rename(id: string, name: string): Promise<void> {
    await db.transaction('rw', _sessions, async () => {
      const existing = await _sessions.get(id);
      if (!existing) return;
      await _sessions.update(id, {
        name,
        version: existing.version + 1,
        updatedAt: now(),
      });
    });
  },
};