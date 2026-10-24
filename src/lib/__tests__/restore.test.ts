import { describe, it, expect } from 'vitest';
import {
  normalizeUrl,
  scoreMatch,
  matchWindowsToSessions,
  unmatchedWindows,
  unmatchedSessions,
  MATCH_THRESHOLD,
  type MatchSession,
  type MatchWindow,
} from '@/lib/restore';

const tab = (url: string) => ({ url });

function session(id: string, urls: string[]): MatchSession {
  return { id, name: id, tabs: urls.map(tab) };
}
function win(windowId: number, urls: string[]): MatchWindow {
  return { windowId, tabs: urls.map(tab) };
}

describe('normalizeUrl', () => {
  it('lower-cases the host but keeps the path case', () => {
    expect(normalizeUrl('https://GitHub.com/User/Repo')).toBe('https://github.com/User/Repo');
  });

  it('drops trailing slashes', () => {
    expect(normalizeUrl('https://a.test/path/')).toBe('https://a.test/path');
    expect(normalizeUrl('https://a.test/')).toBe('https://a.test');
  });

  it('keeps query strings, since they often identify the page', () => {
    expect(normalizeUrl('https://a.test/s?q=1')).toBe('https://a.test/s?q=1');
  });

  it('tolerates junk', () => {
    expect(normalizeUrl('')).toBe('');
    expect(normalizeUrl('not a url')).toBe('not a url');
  });
});

describe('scoreMatch', () => {
  it('scores an identical window at 1', () => {
    const r = scoreMatch(
      session('s', ['https://a.test', 'https://b.test']),
      win(1, ['https://a.test', 'https://b.test']),
    );
    expect(r.score).toBe(1);
    expect(r.coverage).toBe(1);
    expect(r.sharedUrls).toBe(2);
  });

  it('is order-insensitive and trailing-slash insensitive', () => {
    const r = scoreMatch(
      session('s', ['https://a.test/', 'https://b.test']),
      win(1, ['https://b.test', 'https://a.test']),
    );
    expect(r.score).toBe(1);
  });

  it('scores zero when nothing overlaps', () => {
    const r = scoreMatch(session('s', ['https://a.test']), win(1, ['https://z.test']));
    expect(r.score).toBe(0);
    expect(r.sharedUrls).toBe(0);
  });

  it('penalises a window that also contains unrelated tabs', () => {
    const exact = scoreMatch(session('s', ['https://a.test']), win(1, ['https://a.test']));
    const noisy = scoreMatch(
      session('s', ['https://a.test']),
      win(2, ['https://a.test', 'https://x.test', 'https://y.test']),
    );
    expect(noisy.score).toBeLessThan(exact.score);
  });

  it('penalises size mismatch', () => {
    const close = scoreMatch(
      session('s', ['https://a.test', 'https://b.test']),
      win(1, ['https://a.test', 'https://b.test']),
    );
    const far = scoreMatch(
      session('s', ['https://a.test', 'https://b.test']),
      win(2, ['https://a.test', 'https://b.test', 'https://c.test', 'https://d.test']),
    );
    expect(far.score).toBeLessThan(close.score);
  });

  it('returns zero for empty inputs', () => {
    expect(scoreMatch(session('s', []), win(1, ['https://a.test'])).score).toBe(0);
    expect(scoreMatch(session('s', ['https://a.test']), win(1, [])).score).toBe(0);
  });
});

describe('matchWindowsToSessions', () => {
  it('binds an identical window to its session', () => {
    const sessions = [session('s1', ['https://a.test', 'https://b.test'])];
    const windows = [win(10, ['https://a.test', 'https://b.test'])];
    const matches = matchWindowsToSessions(sessions, windows);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.sessionId).toBe('s1');
    expect(matches[0]!.windowId).toBe(10);
  });

  it('refuses weak evidence below the threshold', () => {
    // 1 of 4 tabs shared → coverage 0.25 → well below 0.5
    const sessions = [session('s1', ['https://a.test', 'https://b.test', 'https://c.test', 'https://d.test'])];
    const windows = [win(10, ['https://a.test', 'https://x.test', 'https://y.test', 'https://z.test'])];
    expect(matchWindowsToSessions(sessions, windows)).toHaveLength(0);
  });

  it('does not bind one window to two sessions', () => {
    const sessions = [
      session('s1', ['https://a.test', 'https://b.test']),
      session('s2', ['https://a.test', 'https://b.test']),
    ];
    const windows = [win(10, ['https://a.test', 'https://b.test'])];
    const matches = matchWindowsToSessions(sessions, windows);
    expect(matches).toHaveLength(1);
  });

  it('does not bind one session to two windows', () => {
    const sessions = [session('s1', ['https://a.test', 'https://b.test'])];
    const windows = [
      win(10, ['https://a.test', 'https://b.test']),
      win(11, ['https://a.test', 'https://b.test']),
    ];
    const matches = matchWindowsToSessions(sessions, windows);
    expect(matches).toHaveLength(1);
  });

  it('picks the strongest pairing when several are plausible', () => {
    const sessions = [session('s1', ['https://a.test', 'https://b.test', 'https://c.test'])];
    const windows = [
      win(10, ['https://a.test', 'https://zzz.test']), // weak
      win(11, ['https://a.test', 'https://b.test', 'https://c.test']), // exact
    ];
    const matches = matchWindowsToSessions(sessions, windows);
    expect(matches[0]!.windowId).toBe(11);
  });

  it('handles multiple independent pairs', () => {
    const sessions = [
      session('s1', ['https://a.test', 'https://b.test']),
      session('s2', ['https://c.test', 'https://d.test']),
    ];
    const windows = [
      win(10, ['https://a.test', 'https://b.test']),
      win(11, ['https://c.test', 'https://d.test']),
    ];
    const matches = matchWindowsToSessions(sessions, windows);
    expect(matches).toHaveLength(2);
    const bySession = Object.fromEntries(matches.map((m) => [m.sessionId, m.windowId]));
    expect(bySession).toEqual({ s1: 10, s2: 11 });
  });

  it('exposes the threshold as a constant', () => {
    expect(MATCH_THRESHOLD).toBeGreaterThan(0);
    expect(MATCH_THRESHOLD).toBeLessThanOrEqual(1);
  });
});

describe('unmatched helpers', () => {
  it('reports leftovers on both sides', () => {
    const sessions = [session('s1', ['https://a.test']), session('s2', ['https://b.test'])];
    const windows = [win(10, ['https://a.test']), win(11, ['https://q.test'])];
    const matches = matchWindowsToSessions(sessions, windows);

    expect(unmatchedSessions(sessions, matches).map((s) => s.id)).toEqual(['s2']);
    expect(unmatchedWindows(windows, matches).map((w) => w.windowId)).toEqual([11]);
  });
});

describe('realistic restore scenario', () => {
  it('matches two of three windows and leaves one to be captured fresh', () => {
    const sessions = [
      session('work', [
        'https://github.com/acme/web/pull/482',
        'https://github.com/acme/web/blob/main/auth.ts',
        'https://datatracker.ietf.org/doc/html/rfc6749',
      ]),
      session('reading', [
        'https://example.com/longread',
        'https://arxiv.org/abs/2401.00001',
      ]),
      session('trip', ['https://www.airbnb.com/lisbon', 'https://seat61.com/portugal']),
    ];
    const windows = [
      win(101, [
        'https://github.com/acme/web/pull/482',
        'https://github.com/acme/web/blob/main/auth.ts',
        'https://datatracker.ietf.org/doc/html/rfc6749',
      ]),
      win(102, ['https://example.com/longread', 'https://arxiv.org/abs/2401.00001']),
      // A brand-new window the user opened after the restart.
      win(103, ['https://news.ycombinator.com']),
    ];

    const matches = matchWindowsToSessions(sessions, windows);
    expect(matches).toHaveLength(2);
    expect(unmatchedWindows(windows, matches).map((w) => w.windowId)).toEqual([103]);
    expect(unmatchedSessions(sessions, matches).map((s) => s.id)).toEqual(['trip']);
  });
});
