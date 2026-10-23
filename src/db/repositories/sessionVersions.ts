import Dexie from 'dexie';
import { db } from '@/db/schema';
import type { Session, SessionVersion } from '@/models';
import { DEFAULT_SETTINGS } from '@/models';

function now(): number {
  return Date.now();
}

const _sessions = db.sessions as Dexie.Table<Session, string>;
const _tabs = db.tabs as Dexie.Table<import('@/models').Tab, string>;
const _tabGroups = db.tabGroups as Dexie.Table<import('@/models').TabGroup, string>;
const _sessionVersions = db.sessionVersions as Dexie.Table<SessionVersion, string>;

export const sessionVersionsRepo = {
  /**
   * Read current session + its tabs (ordered) + tabGroups (ordered),
   * create a SessionVersion doc with version = session.version, createdAt = Date.now().
   * Then prune: per-session cap (versionHistoryLimit, default 10) and global cap (500).
   */
  async snapshot(sessionId: string): Promise<SessionVersion> {
    return db.transaction('rw', _sessions, _tabs, _tabGroups, _sessionVersions, async () => {
      const session = await _sessions.get(sessionId);
      if (!session) throw new Error(`Session not found: ${sessionId}`);

      const tabs = (await _tabs
        .where('sessionId')
        .equals(sessionId)
        .toArray())
        .filter(t => !t.deleted)
        .sort((a, b) => a.position - b.position);

      const groups = (await _tabGroups
        .where('sessionId')
        .equals(sessionId)
        .toArray())
        .filter(g => !g.deleted)
        .sort((a, b) => a.position - b.position);

      const versionDoc: SessionVersion = {
        id: crypto.randomUUID(),
        sessionId,
        version: session.version,
        snapshot: {
          tabs,
          groups,
          name: session.name,
        },
        createdAt: now(),
      };

      await _sessionVersions.add(versionDoc);

      // --- Per-session pruning ---
      // Keep at most versionHistoryLimit (default 10) versions for THIS session,
      // oldest first. The global cap (500) is enforced separately by pruneGlobal(),
      // which the service-worker alarm calls periodically (see PLAN §8). Keeping
      // these concerns separate avoids the tension where incremental per-session
      // pruning prevents the global total from ever reaching the global cap.
      const limit = DEFAULT_SETTINGS.versionHistoryLimit;
      const perSessionVersions =
        (await _sessionVersions.where('sessionId').equals(sessionId).toArray())
          // Stable order: version is monotonic per session; createdAt is a tiebreaker.
          // (Sorting by createdAt alone is unstable when consecutive snapshots share
          // a millisecond, which caused flaky prune results.)
          .sort((a, b) => a.version - b.version || a.createdAt - b.createdAt);

      if (perSessionVersions.length > limit) {
        const toRemove = perSessionVersions.length - limit;
        const ids = perSessionVersions.slice(0, toRemove).map(v => v.id);
        await _sessionVersions.bulkDelete(ids);
      }

      return versionDoc;
    });
  },

  /**
   * Enforce the global cap: at most 500 SessionVersion docs across ALL sessions,
   * pruning oldest-first. Called periodically by the service-worker alarm
   * (PLAN §8). This is the safety net for users with many sessions; per-session
   * pruning (in snapshot()) is the everyday bound.
   */
  async pruneGlobal(cap = 500): Promise<void> {
    await db.transaction('rw', _sessionVersions, async () => {
      // Stable oldest-first: createdAt primary, (sessionId, version) tiebreaker so
      // versions sharing a millisecond are ordered deterministically.
      const all = (await _sessionVersions.toArray())
        .sort((a, b) =>
          a.createdAt - b.createdAt
          || (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0)
          || a.version - b.version,
        );
      if (all.length > cap) {
        const excess = all.length - cap;
        const ids = all.slice(0, excess).map(v => v.id);
        await _sessionVersions.bulkDelete(ids);
      }
    });
  },

  /** List version snapshots for a session, newest first. */
  async list(sessionId: string, opts?: { limit?: number }): Promise<SessionVersion[]> {
    const versions =
      (await _sessionVersions.where('sessionId').equals(sessionId).toArray())
        // Newest first; version is monotonic per session (stable), createdAt as tiebreaker.
        .sort((a, b) => b.version - a.version || b.createdAt - a.createdAt);
    return opts?.limit && opts.limit > 0 ? versions.slice(0, opts.limit) : versions;
  },

  /** Get a single version doc by id. */
  async get(id: string): Promise<SessionVersion | undefined> {
    return _sessionVersions.get(id);
  },

  /**
   * Restore returns the snapshot data (tabs, groups, name) so the SW/UI can apply it.
   * Does not mutate current session state — that's the SW's job.
   */
  async restore(id: string): Promise<{ tabs: SessionVersion['snapshot']['tabs']; groups: SessionVersion['snapshot']['groups']; name: string | null } | undefined> {
    const version = await _sessionVersions.get(id);
    if (!version) return undefined;
    return {
      tabs: version.snapshot.tabs,
      groups: version.snapshot.groups,
      name: version.snapshot.name,
    };
  },

  /** Delete a single version doc. */
  async delete(id: string): Promise<void> {
    await _sessionVersions.delete(id);
  },
};