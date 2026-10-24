import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/db/schema';
import { sessionsRepo } from '@/db/repositories/sessions';
import { tabsRepo } from '@/db/repositories/tabs';
import { tabGroupsRepo } from '@/db/repositories/tabGroups';
import { exportAll, importBundle, importText, exportSummary } from '@/db/io';
import type { Session, Tab, TabGroup } from '@/models';

const ts = Date.now();

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: `s-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Research',
    windowId: 3,
    state: 'active',
    mode: 'multi-window',
    tags: ['work'],
    pinnedTabUrls: [],
    createdAt: ts,
    updatedAt: ts,
    closedAt: null,
    version: 2,
    deleted: false,
    ...overrides,
  };
}

function tab(sessionId: string, overrides: Partial<Tab> = {}): Tab {
  return {
    id: `t-${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    chromeTabId: 12,
    url: 'https://example.com/a',
    title: 'A',
    groupId: null,
    pinned: false,
    position: 0,
    active: false,
    discarded: false,
    createdAt: ts,
    updatedAt: ts,
    deleted: false,
    ...overrides,
  };
}

function group(sessionId: string, overrides: Partial<TabGroup> = {}): TabGroup {
  return {
    id: `g-${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    chromeGroupId: 4,
    title: 'Specs',
    color: 'blue',
    collapsed: false,
    position: 0,
    createdAt: ts,
    updatedAt: ts,
    deleted: false,
    ...overrides,
  };
}

describe('export/import', () => {
  beforeEach(async () => {
    await Promise.all([
      db.sessions.clear(),
      db.tabs.clear(),
      db.tabGroups.clear(),
      db.sessionVersions.clear(),
    ]);
  });

  it('exports only live sessions, tabs and groups', async () => {
    const live = session({ id: 'live' });
    const gone = session({ id: 'gone', deleted: true });
    await sessionsRepo.create(live);
    await sessionsRepo.create(gone);

    const g = group('live');
    await tabGroupsRepo.upsert(g);
    await tabsRepo.upsertMany([
      tab('live', { url: 'https://a.test', groupId: g.id, position: 0 }),
      tab('live', { url: 'https://removed.test', deleted: true, position: 1 }),
      tab('gone', { url: 'https://b.test' }),
    ]);

    const result = await exportAll();
    expect(result.bundle.counts.sessions).toBe(1);
    expect(result.bundle.counts.tabs).toBe(1);
    expect(result.bundle.sessions[0]!.tabs[0]!.url).toBe('https://a.test');
    expect(result.bytes).toBeGreaterThan(0);
  });

  it('writes pretty-printed JSON that parses back', async () => {
    await sessionsRepo.create(session({ id: 's' }));
    await tabsRepo.upsert(tab('s', { url: 'https://a.test' }));

    const { json } = await exportAll();
    expect(json).toContain('\n  "format"');
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('round-trips: export, import into an empty database, compare', async () => {
    const s = session({ id: 'orig', name: 'Original' });
    await sessionsRepo.create(s);
    const g = group('orig');
    await tabGroupsRepo.upsert(g);
    await tabsRepo.upsertMany([
      tab('orig', { url: 'https://a.test', groupId: g.id, position: 0, pinned: true }),
      tab('orig', { url: 'https://b.test', position: 1 }),
    ]);

    const exported = await exportAll();

    // Fresh DB
    await Promise.all([db.sessions.clear(), db.tabs.clear(), db.tabGroups.clear()]);

    const result = await importBundle(exported.bundle);
    expect(result.sessions).toBe(1);
    expect(result.tabs).toBe(2);
    expect(result.groups).toBe(1);

    const imported = await sessionsRepo.listClosed();
    expect(imported).toHaveLength(1);
    // Imported sessions are always closed and get a new id.
    expect(imported[0]!.id).not.toBe('orig');
    expect(imported[0]!.name).toBe('Original');
    expect(imported[0]!.state).toBe('closed');

    const tabs = await tabsRepo.listBySession(imported[0]!.id);
    expect(tabs.map((t) => t.url)).toEqual(['https://a.test', 'https://b.test']);
    expect(tabs[0]!.pinned).toBe(true);

    const groups = await tabGroupsRepo.listBySession(imported[0]!.id);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.title).toBe('Specs');
    // Group ids are remapped, and the tab points at the new id.
    expect(groups[0]!.id).not.toBe(g.id);
    expect(tabs[0]!.groupId).toBe(groups[0]!.id);
  });

  it('is additive: importing the same bundle twice creates two sessions', async () => {
    await sessionsRepo.create(session({ id: 's' }));
    await tabsRepo.upsert(tab('s', { url: 'https://a.test' }));

    const { bundle, json } = await exportAll();
    await importBundle(bundle);
    await importBundle(JSON.parse(json));

    expect(await sessionsRepo.listClosed()).toHaveLength(2);
  });

  it('never leaves imported sessions bound to a window', async () => {
    const s = session({ id: 's', state: 'active', windowId: 42 });
    await sessionsRepo.create(s);
    await tabsRepo.upsert(tab('s'));

    const { bundle } = await exportAll();
    await db.sessions.clear();
    await db.tabs.clear();
    await importBundle(bundle);

    const imported = (await sessionsRepo.listClosed())[0]!;
    expect(imported.windowId).toBeNull();
    expect(imported.state).toBe('closed');
  });

  it('importText detects and imports a OneTab export', async () => {
    const text = 'https://a.test\tTitle A\nhttps://b.test\tTitle B';
    const result = await importText(text);

    expect(result.source).toBe('onetab');
    expect(result.sessions).toBe(1);
    expect(result.tabs).toBe(2);

    const sessions = await sessionsRepo.listClosed();
    expect(sessions).toHaveLength(1);
    const tabs = await tabsRepo.listBySession(sessions[0]!.id);
    expect(tabs.map((t) => t.title)).toContain('Title A');
  });

  it('importText imports a plain URL list', async () => {
    const result = await importText('https://a.test\nhttps://b.test\nhttps://a.test');
    expect(result.source).toBe('urls');
    expect(result.tabs).toBe(2);
  });

  it('importText rejects junk without writing anything', async () => {
    const result = await importText('hello world');
    expect(result.source).toBe('none');
    expect(result.error).toBeTruthy();
    expect(await sessionsRepo.listClosed()).toHaveLength(0);
  });

  it('importSummary matches what a real export contains', async () => {
    await sessionsRepo.create(session({ id: 's' }));
    await tabsRepo.upsertMany([
      tab('s', { url: 'https://a.test', position: 0 }),
      tab('s', { url: 'https://b.test', position: 1 }),
    ]);
    const summary = await exportSummary();
    expect(summary.sessions).toBe(1);
    expect(summary.tabs).toBe(2);
    expect(summary.bytes).toBeGreaterThan(0);
  });
});
