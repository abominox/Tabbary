import Dexie from 'dexie';
import { db } from '@/db/schema';
import type { Tag } from '@/models';

function now(): number {
  return Date.now();
}

const _tags = db.tags as Dexie.Table<Tag, string>;

export const tagsRepo = {
  /** List all non-deleted tags. */
  async listAll(): Promise<Tag[]> {
    return _tags
      .where({ deleted: false })
      .toArray();
  },

  /** Get a single tag by id. */
  async get(id: string): Promise<Tag | undefined> {
    return _tags.get(id);
  },

  /** Find a tag by name (exact match). */
  async getByName(name: string): Promise<Tag | undefined> {
    return _tags
      .where({ name, deleted: false })
      .first();
  },

  /** Create a new tag. */
  async create(tag: Tag): Promise<void> {
    const ts = now();
    await _tags.add({
      ...tag,
      createdAt: tag.createdAt || ts,
      updatedAt: ts,
    });
  },

  /** Rename a tag. */
  async rename(id: string, name: string): Promise<void> {
    await _tags.update(id, { name, updatedAt: now() });
  },

  /** Soft-delete a tag. */
  async softDelete(id: string): Promise<void> {
    await _tags.update(id, { deleted: true, updatedAt: now() });
  },
};