/**
 * Bookmark operations exposed to the UI.
 *
 * Three scopes:
 *   session — belongs to one session (saved alongside it)
 *   tag     — shared by every session carrying that tag
 *   browser — a one-way import of Chrome's bookmark tree
 *
 * Browser bookmarks are read-only here: Windrow imports them once and never
 * writes back to Chrome's tree (that would need the `bookmarks` permission and
 * is a much bigger promise than this feature makes).
 */

import Dexie from 'dexie';
import { db } from '@/db/schema';
import { bookmarksRepo, bookmarksToTabs } from '@/db/repositories/bookmarks';
import { sessionsRepo } from '@/db/repositories/sessions';
import { tabsRepo } from '@/db/repositories/tabs';
import type { Bookmark } from '@/models';
import { isPortableUrl } from '@/lib/bundle';

export interface BookmarkView {
  scope: Bookmark['type'];
  ownerId: string | null;
  rows: Bookmark[];
}

function uuid(): string {
  return crypto.randomUUID();
}

export async function listBookmarks(scope: Bookmark['type'], ownerId?: string | null): Promise<Bookmark[]> {
  if (scope === 'browser') return bookmarksRepo.listAll().then((all) => all.filter((b) => b.type === 'browser'));
  if (!ownerId) return [];
  return bookmarksRepo.listByOwner(scope, ownerId);
}

export async function addBookmark(input: {
  scope: Bookmark['type'];
  ownerId: string | null;
  title: string;
  url?: string;
  isFolder?: boolean;
  parentId?: string | null;
}): Promise<Bookmark | null> {
  if (!input.isFolder && (!input.url || !isPortableUrl(input.url))) return null;

  const siblings = input.ownerId
    ? await bookmarksRepo.listByOwner(input.scope, input.ownerId)
    : (await bookmarksRepo.listAll()).filter(
        (b) => b.type === input.scope && (b.parentId ?? null) === (input.parentId ?? null),
      );

  // parentId is the *folder* a bookmark sits in (or null at the root).
  // The owning session/tag lives in a separate column so a folder and its
  // children can share an owner without pretending the folder is the parent.
  const bm: Bookmark = {
    id: uuid(),
    type: input.scope,
    ownerId: input.ownerId,
    parentId: input.parentId ?? null,
    title: input.title.trim() || input.url || 'Untitled',
    url: input.isFolder ? undefined : input.url,
    isFolder: Boolean(input.isFolder),
    position: siblings.length,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deleted: false,
  };

  await bookmarksRepo.create(bm);
  return bm;
}

export async function updateBookmark(
  id: string,
  patch: { title?: string; url?: string },
): Promise<boolean> {
  const existing = await bookmarksRepo.get(id);
  if (!existing || existing.deleted) return false;

  const next: Partial<Bookmark> = {};
  if (patch.title !== undefined) next.title = patch.title.trim() || 'Untitled';
  if (patch.url !== undefined && !existing.isFolder) {
    if (!isPortableUrl(patch.url)) return false;
    next.url = patch.url;
  }
  await bookmarksRepo.update(id, next);
  return true;
}

export async function deleteBookmark(id: string): Promise<number> {
  return bookmarksRepo.softDelete(id);
}

/** Reorder within a scope by supplying ids in their new order. */
export async function reorderBookmarks(ids: string[]): Promise<void> {
  const ts = Date.now();
  // Dexie types the key as the literal 'id'; at runtime these are strings.
  const table = db.bookmarks as Dexie.Table<Bookmark, string>;
  for (let i = 0; i < ids.length; i++) {
    const bm = await bookmarksRepo.get(ids[i]!);
    if (!bm) continue;
    await table.update(ids[i]!, { position: i, updatedAt: ts });
  }
}

/**
 * Import Chrome's bookmark tree into the `browser` scope.
 * Returns how many rows were created. Re-importing replaces the previous copy.
 */
export async function importBrowserBookmarks(): Promise<{ imported: number; skipped: number }> {
  const tree = await chrome.bookmarks.getTree();

  // Drop the previous import so re-running does not duplicate.
  const previous = (await bookmarksRepo.listAll()).filter((b) => b.type === 'browser');
  const ts = Date.now();
  const table = db.bookmarks as Dexie.Table<Bookmark, string>;
  for (const bm of previous) {
    await table.update(bm.id, { deleted: true, updatedAt: ts });
  }

  let imported = 0;
  let skipped = 0;

  const walk = async (
    nodes: chrome.bookmarks.BookmarkTreeNode[],
    parentId: string | null,
  ): Promise<void> => {
    let position = 0;
    for (const node of nodes) {
      const isFolder = node.url === undefined;
      if (!isFolder && (!node.url || !isPortableUrl(node.url))) {
        skipped++;
        continue;
      }

      const id = uuid();
      await bookmarksRepo.create({
        id,
        type: 'browser',
        ownerId: null,
        parentId,
        title: node.title || (isFolder ? 'Untitled folder' : node.url || 'Untitled'),
        url: node.url,
        isFolder,
        position: position++,
        createdAt: ts,
        updatedAt: ts,
        deleted: false,
      });
      imported++;

      if (isFolder && node.children?.length) {
        await walk(node.children, id);
      }
    }
  };

  // Chrome exposes two roots (bar + other); keep them as top-level folders.
  await walk(tree, null);
  return { imported, skipped };
}

/**
 * Create a new closed session from bookmarks.
 * `folderId` null means "everything in this scope".
 */
export async function openBookmarksAsSession(input: {
  scope: Bookmark['type'];
  ownerId: string | null;
  folderId?: string | null;
  name?: string;
}): Promise<{ sessionId: string; tabCount: number } | null> {
  const all = await listBookmarks(input.scope, input.ownerId);
  const roots = bookmarksRepo.buildTree(
    all.filter((b) => (b.parentId ?? '') === (input.folderId ?? '') || input.folderId === null),
    input.folderId ?? '',
  );

  // If a folder was chosen, only that subtree counts.
  const selected = input.folderId ? roots : bookmarksRepo.buildTree(all, '');
  const tabs = bookmarksToTabs(selected, 'pending');

  if (tabs.length === 0) return null;

  const ts = Date.now();
  const sessionId = uuid();

  await sessionsRepo.create({
    id: sessionId,
    name: input.name?.trim() || 'Saved links',
    windowId: null,
    state: 'closed',
    mode: 'multi-window',
    tags: ['bookmarks'],
    pinnedTabUrls: [],
    createdAt: ts,
    updatedAt: ts,
    closedAt: ts,
    version: 1,
    deleted: false,
  });

  await tabsRepo.upsertMany(
    tabs.map((tab) => ({
      ...tab,
      id: uuid(),
      sessionId,
      createdAt: ts,
      updatedAt: ts,
    })),
  );

  return { sessionId, tabCount: tabs.length };
}

/** Populate the session and tag scopes for the first time from open tabs. */
export async function seedSessionBookmarks(sessionId: string): Promise<number> {
  const existing = await bookmarksRepo.listByOwner('session', sessionId);
  if (existing.length > 0) return 0;

  const tabs = await tabsRepo.listBySession(sessionId);
  const urls = tabs.filter((t) => isPortableUrl(t.url)).slice(0, 50);

  const ts = Date.now();
  let position = 0;
  for (const tab of urls) {
    await bookmarksRepo.create({
      id: uuid(),
      type: 'session',
      ownerId: sessionId,
      parentId: null,
      title: tab.title || tab.url,
      url: tab.url,
      isFolder: false,
      position: position++,
      createdAt: ts,
      updatedAt: ts,
      deleted: false,
    });
  }
  return urls.length;
}
