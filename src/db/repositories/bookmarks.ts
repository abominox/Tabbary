import Dexie from 'dexie';
import { db } from '@/db/schema';
import type { Bookmark } from '@/models';

function now(): number {
  return Date.now();
}

const _bookmarks = db.bookmarks as Dexie.Table<Bookmark, string>;

export const bookmarksRepo = {
  /**
   * List bookmarks for a given owner (type + parentId), ordered by position.
   * For session bookmarks: type='session', ownerId = sessionId → list where parentId = ownerId.
   * For tag bookmarks: type='tag', ownerId = tagId.
   * For browser bookmarks: type='browser', ownerId = browser tree root.
   */
  async listByOwner(type: Bookmark['type'], ownerId: string): Promise<Bookmark[]> {
    const results = await _bookmarks
      .where({ type: type as any, parentId: ownerId, deleted: false })
      .toArray();
    return results.sort((a, b) => a.position - b.position);
  },

  /** Get a single bookmark by id. */
  async get(id: string): Promise<Bookmark | undefined> {
    return _bookmarks.get(id);
  },

  /** Create a new bookmark. */
  async create(bm: Bookmark): Promise<void> {
    const ts = now();
    await _bookmarks.add({
      ...bm,
      createdAt: bm.createdAt || ts,
      updatedAt: ts,
    });
  },

  /** Update a bookmark with partial fields. */
  async update(id: string, patch: Partial<Bookmark>): Promise<void> {
    await _bookmarks.update(id, { ...patch, updatedAt: now() });
  },

  /** Soft-delete a bookmark. */
  async softDelete(id: string): Promise<void> {
    await _bookmarks.update(id, { deleted: true, updatedAt: now() });
  },

  /** Move a bookmark to a new parent + position. */
  async move(id: string, newParentId: string, newPosition: number): Promise<void> {
    await _bookmarks.update(id, {
      parentId: newParentId,
      position: newPosition,
      updatedAt: now(),
    });
  },
};