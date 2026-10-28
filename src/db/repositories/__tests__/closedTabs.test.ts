import { describe, it, expect, beforeEach } from 'vitest';
import Dexie from 'dexie';
import { TabbaryDB } from '@/db/schema';
import type { Tab } from '@/models';
import { tabsRepo } from '@/db/repositories/tabs';

const ts = 1_700_000_000_000;

/** Cast for runtime string keys: Dexie types the primary key as the literal 'id'. */
const tabsTable = (db: TabbaryDB) => db.tabs as unknown as Dexie.Table<Tab, string>;

function tab(id: string, over: Partial<Tab> = {}): Tab {
  return {
    id,
    sessionId: 's1',
    chromeTabId: null,
    url: `https://example.test/${id}`,
    title: `Tab ${id}`,
    groupId: null,
    pinned: false,
    position: 0,
    active: false,
    discarded: false,
    createdAt: ts,
    updatedAt: ts,
    deleted: false,
    ...over,
  };
}

describe('closed tab history', () => {
  let db: TabbaryDB;

  beforeEach(async () => {
    db = new TabbaryDB();
    await db.tabs.clear().catch(() => {});
    await db.sessions.clear().catch(() => {});
  });

  it('reports a tab that left the window as closed', async () => {
    await tabsRepo.upsertMany([tab('a'), tab('b')]);
    // A save that no longer includes "b" is how a close is observed.
    await tabsRepo.replaceForSession('s1', [tab('a')]);

    const closed = await tabsRepo.listClosedBySession('s1');
    expect(closed.map((t) => t.id)).toEqual(['b']);
  });

  it('does not report open tabs as closed', async () => {
    await tabsRepo.upsertMany([tab('a')]);
    const closed = await tabsRepo.listClosedBySession('s1');
    expect(closed).toEqual([]);
  });

  it('orders closed tabs newest first', async () => {
    await tabsRepo.upsertMany([tab('old'), tab('new')]);
    await tabsRepo.replaceForSession('s1', []);
    // Make the ordering unambiguous regardless of clock resolution.
    await tabsTable(db).update('old', { updatedAt: ts + 1 } as Partial<Tab>);
    await tabsTable(db).update('new', { updatedAt: ts + 2 } as Partial<Tab>);

    const closed = await tabsRepo.listClosedBySession('s1');
    expect(closed.map((t) => t.id)).toEqual(['new', 'old']);
  });

  it('brings a closed tab back', async () => {
    await tabsRepo.upsertMany([tab('a'), tab('b')]);
    await tabsRepo.replaceForSession('s1', [tab('a')]);

    const restored = await tabsRepo.restoreClosed('b');
    expect(restored?.deleted).toBe(false);

    const open = await tabsRepo.listBySession('s1');
    expect(open.map((t) => t.id).sort()).toEqual(['a', 'b']);
    expect(await tabsRepo.listClosedBySession('s1')).toEqual([]);
  });

  it('refuses to restore a tab that is not closed', async () => {
    await tabsRepo.upsertMany([tab('a')]);
    expect(await tabsRepo.restoreClosed('a')).toBeUndefined();
  });

  it('refuses to restore an unknown id', async () => {
    expect(await tabsRepo.restoreClosed('nope')).toBeUndefined();
  });

  it('caps the history and keeps the newest', async () => {
    const many = Array.from({ length: 70 }, (_, i) => tab(`t${i}`));
    await tabsRepo.upsertMany(many);
    // Closing everything makes all 70 candidates.
    await tabsRepo.replaceForSession('s1', []);
    for (let i = 0; i < 70; i++) {
      await tabsTable(db).update(`t${i}`, { updatedAt: ts + i } as Partial<Tab>);
    }

    const removed = await tabsRepo.pruneClosedTabs('s1', 50);
    expect(removed).toBe(20);

    const closed = await tabsRepo.listClosedBySession('s1', 100);
    expect(closed).toHaveLength(50);
    // Newest survive: t69 is present, t0 is gone.
    expect(closed[0]!.id).toBe('t69');
    expect(closed.some((t) => t.id === 't0')).toBe(false);
  });

  it('does not prune when under the cap', async () => {
    await tabsRepo.upsertMany([tab('a'), tab('b')]);
    await tabsRepo.replaceForSession('s1', []);
    expect(await tabsRepo.pruneClosedTabs('s1', 50)).toBe(0);
  });
});
