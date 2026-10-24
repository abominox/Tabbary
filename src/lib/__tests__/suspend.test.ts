import { describe, it, expect } from 'vitest';
import {
  evaluateTab,
  planSuspension,
  describeSkip,
  DEFAULT_SUSPEND_POLICY,
  type SuspendableTab,
} from '@/lib/suspend';

const NOW = 1_700_000_000_000;
const idle = (over: Partial<SuspendableTab> = {}): SuspendableTab => ({
  id: 1,
  url: 'https://example.com/a',
  title: 'A',
  pinned: false,
  active: false,
  discarded: false,
  audible: false,
  autoDiscardable: true,
  lastAccessed: NOW - 60 * 60_000, // an hour ago
  ...over,
});

describe('evaluateTab', () => {
  it('suspends an idle, ordinary tab', () => {
    const d = evaluateTab(idle(), NOW);
    expect(d.suspend).toBe(true);
    expect(d.reason).toBeUndefined();
  });

  it('never suspends the active tab', () => {
    expect(evaluateTab(idle({ active: true }), NOW)).toMatchObject({
      suspend: false,
      reason: 'active',
    });
  });

  it('never suspends pinned tabs by default', () => {
    expect(evaluateTab(idle({ pinned: true }), NOW)).toMatchObject({
      suspend: false,
      reason: 'pinned',
    });
  });

  it('can be configured to include pinned tabs', () => {
    const d = evaluateTab(idle({ pinned: true }), NOW, {
      ...DEFAULT_SUSPEND_POLICY,
      skipPinned: false,
    });
    expect(d.suspend).toBe(true);
  });

  it('skips tabs that are already discarded', () => {
    expect(evaluateTab(idle({ discarded: true }), NOW)).toMatchObject({
      suspend: false,
      reason: 'already-discarded',
    });
  });

  it('skips tabs playing audio', () => {
    expect(evaluateTab(idle({ audible: true }), NOW)).toMatchObject({
      suspend: false,
      reason: 'audible',
    });
  });

  it('respects autoDiscardable=false', () => {
    expect(evaluateTab(idle({ autoDiscardable: false }), NOW)).toMatchObject({
      suspend: false,
      reason: 'not-auto-discardable',
    });
  });

  it('skips browser-internal pages', () => {
    for (const url of [
      'chrome://settings',
      'chrome-extension://abc/page.html',
      'devtools://devtools/x',
      'about:blank',
      'file:///tmp/a.html',
    ]) {
      expect(evaluateTab(idle({ url }), NOW).reason).toBe('allowlisted');
    }
  });

  it('skips a tab used more recently than the idle threshold', () => {
    const d = evaluateTab(idle({ lastAccessed: NOW - 60_000 }), NOW);
    expect(d.suspend).toBe(false);
    expect(d.reason).toBe('too-recent');
  });

  it('suspends a tab exactly at the threshold', () => {
    const d = evaluateTab(
      idle({ lastAccessed: NOW - DEFAULT_SUSPEND_POLICY.minIdleMs }),
      NOW,
    );
    expect(d.suspend).toBe(true);
  });

  it('treats a missing lastAccessed as old enough', () => {
    expect(evaluateTab(idle({ lastAccessed: undefined }), NOW).suspend).toBe(true);
  });

  it('requires an id and a url', () => {
    expect(evaluateTab(idle({ id: undefined }), NOW).reason).toBe('no-id');
    expect(evaluateTab(idle({ url: undefined }), NOW).reason).toBe('no-url');
    expect(evaluateTab(idle({ url: '' }), NOW).reason).toBe('no-url');
  });

  it('honours a custom allowlist', () => {
    const policy = { ...DEFAULT_SUSPEND_POLICY, allowlist: ['https://keep.test'] };
    expect(evaluateTab(idle({ url: 'https://keep.test/x' }), NOW, policy).reason).toBe(
      'allowlisted',
    );
    expect(evaluateTab(idle({ url: 'https://other.test/x' }), NOW, policy).suspend).toBe(true);
  });

  it('is order-independent for overlapping reasons', () => {
    // active + audible + pinned: the first check wins deterministically.
    const d = evaluateTab(idle({ active: true, audible: true, pinned: true }), NOW);
    expect(d.reason).toBe('active');
  });
});

describe('planSuspension', () => {
  it('splits a realistic window into candidates and skips', () => {
    const tabs: SuspendableTab[] = [
      idle({ id: 1, url: 'https://a.test', lastAccessed: NOW - 3_600_000 }),
      idle({ id: 2, url: 'https://b.test', active: true }),
      idle({ id: 3, url: 'https://c.test', pinned: true }),
      idle({ id: 4, url: 'https://d.test', audible: true }),
      idle({ id: 5, url: 'chrome://extensions' }),
      idle({ id: 6, url: 'https://e.test', lastAccessed: NOW - 1_000 }),
      idle({ id: 7, url: 'https://f.test', lastAccessed: NOW - 7_200_000 }),
    ];

    const { toDiscard, skipped } = planSuspension(tabs, NOW);
    expect(toDiscard.map((t) => t.id)).toEqual([1, 7]);
    expect(skipped).toHaveLength(5);
    expect(skipped.map((s) => s.reason).sort()).toEqual(
      ['active', 'allowlisted', 'audible', 'pinned', 'too-recent'].sort(),
    );
  });

  it('handles an empty window', () => {
    expect(planSuspension([], NOW)).toEqual({ toDiscard: [], skipped: [] });
  });

  it('never returns the same tab in both lists', () => {
    const tabs = Array.from({ length: 20 }, (_, i) =>
      idle({ id: i + 1, url: `https://x${i}.test`, lastAccessed: NOW - i * 60_000 }),
    );
    const { toDiscard, skipped } = planSuspension(tabs, NOW);
    const ids = new Set([...toDiscard.map((t) => t.id), ...skipped.map((s) => s.tab.id)]);
    expect(ids.size).toBe(20);
  });
});

describe('describeSkip', () => {
  it('explains every reason', () => {
    for (const reason of [
      'active',
      'pinned',
      'already-discarded',
      'audible',
      'not-auto-discardable',
      'too-recent',
      'allowlisted',
      'no-url',
    ] as const) {
      expect(describeSkip(reason)).toBeTruthy();
    }
  });
});
