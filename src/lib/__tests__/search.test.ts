import { describe, it, expect } from 'vitest';
import { sessionMatchesQuery } from '@/lib/search';
import type { Session, Tab } from '@/models';

const ts = 1_700_000_000_000;

function session(over: Partial<Session> = {}): Session {
  return {
    id: 's1',
    name: 'Postgres indexing',
    windowId: null,
    state: 'closed',
    mode: 'multi-window',
    tags: [],
    pinnedTabUrls: [],
    createdAt: ts,
    updatedAt: ts,
    closedAt: ts,
    version: 1,
    deleted: false,
    ...over,
  };
}

function tab(over: Partial<Tab> = {}): Tab {
  return {
    id: 't1',
    sessionId: 's1',
    chromeTabId: null,
    url: 'https://example.test/docs',
    title: 'Query planner notes',
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

describe('sessionMatchesQuery', () => {
  it('matches everything when the query is empty', () => {
    expect(sessionMatchesQuery(session(), [tab()], '   ', 'tabs')).toBe(true);
  });

  it('matches on the session name', () => {
    expect(sessionMatchesQuery(session(), [tab()], 'index', 'all')).toBe(true);
  });

  it('matches on tab title and URL', () => {
    expect(sessionMatchesQuery(session(), [tab()], 'planner', 'all')).toBe(true);
    expect(sessionMatchesQuery(session(), [tab()], 'example.test', 'all')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(sessionMatchesQuery(session(), [tab()], 'POSTGRES', 'all')).toBe(true);
  });

  it('ignores names when the scope is tabs only', () => {
    // "postgres" is in the session name, not in any tab.
    expect(sessionMatchesQuery(session(), [tab()], 'postgres', 'tabs')).toBe(false);
  });

  it('ignores tabs when the scope is sessions only', () => {
    expect(sessionMatchesQuery(session(), [tab()], 'planner', 'sessions')).toBe(false);
    expect(sessionMatchesQuery(session(), [tab()], 'postgres', 'sessions')).toBe(true);
  });

  it('treats a null session name as empty', () => {
    expect(sessionMatchesQuery(session({ name: null }), [tab()], 'planner', 'all')).toBe(true);
    expect(sessionMatchesQuery(session({ name: null }), [], 'planner', 'all')).toBe(false);
  });

  it('matches nothing when there are no tabs and the name does not match', () => {
    expect(sessionMatchesQuery(session(), [], 'zzz', 'all')).toBe(false);
  });
});
