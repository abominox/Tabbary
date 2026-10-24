import Dexie from 'dexie';
import { db } from '@/db/schema';
import type { Bookmark, Tab } from '@/models';
import { isPortableUrl } from '@/lib/bundle';

function now(): number {
  return Date.now();
}

const _bookmarks = db.bookmarks as Dexie.Table<Bookmark, string>;

export type BookmarkScope = Bookmark['type'];

export interface BookmarkNode extends Bookmark {
  children: BookmarkNode[];
}

export const bookmarksRepo = {
  /**
   * List bookmarks for a given owner (type + parentId), ordered by position.
   * For session bookmarks: type='session', ownerId = sessionId → list where parentId = ownerId.
   * For tag bookmarks: type='tag', ownerId = tagId.
   * For browser bookmarks: type='browser', ownerId = browser tree root.
   */
  async listByOwner(type: Bookmark['type'], ownerId: string): Promise<Bookmark[]> {
    // Use the compound [type+ownerId] index. Dexie's object form of where()
    // is a primary-key lookup, not a multi-field predicate, so
    // where({type, parentId, deleted}) silently matches nothing.
    const results = await _bookmarks
      .where('[type+ownerId]')
      .equals([type, ownerId])
      .filter((b) => !b.deleted)
      .toArray();
    return results.sort((a, b) => a.position - b.position);
  },

  /** Every non-deleted bookmark, flat. */
  async listAll(): Promise<Bookmark[]> {
    return (await _bookmarks.toArray())
      .filter((b) => !b.deleted)
      .sort((a, b) => a.position - b.position);
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

  /** Soft-delete a bookmark and, for folders, everything beneath it. */
  async softDelete(id: string): Promise<number> {
    const rows = await _bookmarks.toArray();
    const ids = new Set<string>([id]);
    // Walk down: folder → children → grandchildren.
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of rows) {
        if (!row.deleted && row.parentId && ids.has(row.parentId) && !ids.has(row.id)) {
          ids.add(row.id);
          changed = true;
        }
      }
    }

    const ts = now();
    for (const each of ids) {
      await _bookmarks.update(each, { deleted: true, updatedAt: ts });
    }
    return ids.size;
  },

  /** Move a bookmark to a new parent + position. */
  async move(id: string, newParentId: string, newPosition: number): Promise<void> {
    await _bookmarks.update(id, {
      parentId: newParentId,
      position: newPosition,
      updatedAt: now(),
    });
  },

  /** Count bookmarks per scope, for the rail badges. */
  async counts(): Promise<Record<Bookmark['type'], number>> {
    const all = await this.listAll();
    return {
      session: all.filter((b) => b.type === 'session').length,
      tag: all.filter((b) => b.type === 'tag').length,
      browser: all.filter((b) => b.type === 'browser').length,
    };
  },

  /**
   * Build a forest for one scope, rooted at `parentId`.
   * Sorts folders before links, then by position.
   */
  buildTree(rows: Bookmark[], parentId: string): BookmarkNode[] {
    const children = rows
      .filter((b) => b.parentId === parentId)
      .sort((a, b) => {
        if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
        return a.position - b.position;
      });

    return children.map((child) => ({
      ...child,
      children: child.isFolder ? this.buildTree(rows, child.id) : [],
    }));
  },
};

// ── Pure helpers (unit-tested) ───────────────────────────

/** Collect every URL in a bookmark subtree, depth-first. */
export function collectUrls(nodes: BookmarkNode[]): string[] {
  const urls: string[] = [];
  const walk = (list: BookmarkNode[]) => {
    for (const node of list) {
      if (node.isFolder) walk(node.children);
      else if (node.url && isPortableUrl(node.url)) urls.push(node.url);
    }
  };
  walk(nodes);
  return urls;
}

/** Count links (not folders) in a subtree. */
export function countLinks(nodes: BookmarkNode[]): number {
  return nodes.reduce(
    (n, node) => n + (node.isFolder ? countLinks(node.children) : 1),
    0,
  );
}

/**
 * Convert a Chrome bookmark tree into flat rows for one scope.
 *
 * Chrome's tree uses string ids we do not control; we prefix them so a folder
 * and a link can never collide, and so a re-import can detect its own rows.
 */
export function flattenChromeTree(
  roots: chrome.bookmarks.BookmarkTreeNode[],
  scope: Bookmark['type'],
  ownerId: string,
  parentId: string | null = null,
): Omit<Bookmark, 'createdAt' | 'updatedAt'>[] {
  const rows: Omit<Bookmark, 'createdAt' | 'updatedAt'>[] = [];
  let position = 0;

  for (const node of roots) {
    const id = `chrome-${scope}-${node.id}`;
    const isFolder = node.url === undefined;

    rows.push({
      id,
      type: scope,
      ownerId,
      parentId,
      title: node.title || (isFolder ? 'Untitled folder' : node.url || 'Untitled'),
      url: node.url,
      isFolder,
      position: position++,
      deleted: false,
    });

    if (isFolder && node.children?.length) {
      rows.push(...flattenChromeTree(node.children, scope, ownerId, id));
    }
  }

  return rows;
}

/** Build a session's tab list from a bookmark subtree. */
export function bookmarksToTabs(
  nodes: BookmarkNode[],
  sessionId: string,
  startPosition = 0,
): Omit<Tab, 'id' | 'createdAt' | 'updatedAt'>[] {
  const tabs: Omit<Tab, 'id' | 'createdAt' | 'updatedAt'>[] = [];
  let position = startPosition;

  const walk = (list: BookmarkNode[]) => {
    for (const node of list) {
      if (node.isFolder) {
        walk(node.children);
        continue;
      }
      if (!node.url || !isPortableUrl(node.url)) continue;
      tabs.push({
        sessionId,
        chromeTabId: null,
        url: node.url,
        title: node.title || node.url,
        groupId: null,
        pinned: false,
        position: position++,
        active: false,
        discarded: false,
        deleted: false,
      });
    }
  };

  walk(nodes);
  return tabs;
}
