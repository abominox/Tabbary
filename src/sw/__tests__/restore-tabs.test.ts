import { describe, it, expect } from 'vitest';
import { planRestore } from '@/sw/restore-tabs';
import type { Tab, TabGroup } from '@/models';

const ts = 1_700_000_000_000;

function tab(over: Partial<Tab> = {}): Tab {
  return {
    id: `t-${Math.random().toString(36).slice(2, 7)}`,
    sessionId: 's',
    chromeTabId: 1,
    url: 'https://a.test',
    title: 'A',
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

function group(over: Partial<TabGroup> = {}): TabGroup {
  return {
    id: `g-${Math.random().toString(36).slice(2, 7)}`,
    sessionId: 's',
    chromeGroupId: 9,
    title: 'Specs',
    color: 'blue',
    collapsed: false,
    position: 0,
    createdAt: ts,
    updatedAt: ts,
    deleted: false,
    ...over,
  };
}

describe('planRestore', () => {
  it('keeps saved tab order rather than array order', () => {
    const plan = planRestore(
      [
        tab({ url: 'https://third.test', position: 2 }),
        tab({ url: 'https://first.test', position: 0 }),
        tab({ url: 'https://second.test', position: 1 }),
      ],
      [],
    );
    expect(plan.urls).toEqual([
      'https://first.test',
      'https://second.test',
      'https://third.test',
    ]);
  });

  it('maps each tab to its group and drops dangling references', () => {
    const g = group({ id: 'g1' });
    const plan = planRestore(
      [
        tab({ url: 'https://a.test', position: 0, groupId: 'g1' }),
        tab({ url: 'https://b.test', position: 1, groupId: 'ghost' }),
        tab({ url: 'https://c.test', position: 2, groupId: null }),
      ],
      [g],
    );

    expect(plan.groupForIndex).toEqual(['g1', null, null]);
    expect(plan.groups.map((x) => x.id)).toEqual(['g1']);
  });

  it('skips tabs with no URL but keeps positions aligned', () => {
    const plan = planRestore(
      [
        tab({ url: 'https://a.test', position: 0 }),
        tab({ url: '', position: 1 }),
        tab({ url: 'https://c.test', position: 2 }),
      ],
      [],
    );
    expect(plan.urls).toEqual(['https://a.test', 'https://c.test']);
    expect(plan.groupForIndex).toHaveLength(2);
  });

  it('returns an empty plan for an empty session', () => {
    expect(planRestore([], [])).toEqual({ urls: [], groupForIndex: [], groups: [] });
  });

  it('keeps groups that have no members (they simply produce nothing)', () => {
    const g = group({ id: 'empty' });
    const plan = planRestore([tab({ groupId: null })], [g]);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groupForIndex).toEqual([null]);
  });

  it('handles a realistic mixed session', () => {
    const specs = group({ id: 'gs', title: 'Specs', position: 0 });
    const code = group({ id: 'gc', title: 'Code', position: 1 });

    const plan = planRestore(
      [
        tab({ url: 'https://pinned.test', position: 0, pinned: true }),
        tab({ url: 'https://rfc.test', position: 1, groupId: 'gs' }),
        tab({ url: 'https://pr.test', position: 2, groupId: 'gc' }),
        tab({ url: 'https://other.test', position: 3, groupId: 'gs' }),
        tab({ url: 'https://loose.test', position: 4, groupId: null }),
      ],
      [specs, code],
    );

    expect(plan.urls).toHaveLength(5);
    expect(plan.groupForIndex).toEqual([null, 'gs', 'gc', 'gs', null]);
    expect(plan.groups.map((g) => g.title)).toEqual(['Specs', 'Code']);
  });
});
