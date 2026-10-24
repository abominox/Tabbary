import { describe, it, expect } from 'vitest';
import { tiersFor, prune, RETENTION, BUDGET_BYTES, type BackupSlot, type BackupIndex } from '@/sw/backup-service';

function slot(over: Partial<BackupSlot> = {}): BackupSlot {
  return {
    id: `s-${Math.random().toString(36).slice(2, 8)}`,
    tier: 'daily',
    createdAt: Date.UTC(2026, 4, 1),
    sessions: 3,
    tabs: 20,
    bytes: 10_000,
    ...over,
  };
}

function index(slots: BackupSlot[], over: Partial<BackupIndex> = {}): BackupIndex {
  return { enabled: true, lastRunAt: null, slots, ...over };
}

describe('tiersFor', () => {
  it('produces every tier on the first run', () => {
    expect(tiersFor(new Date('2026-05-01T10:00:00Z'), null)).toEqual([
      'daily',
      'weekly',
      'monthly',
    ]);
  });

  it('produces nothing on a second run the same day', () => {
    const last = Date.UTC(2026, 4, 1, 8);
    const now = new Date(Date.UTC(2026, 4, 1, 20));
    expect(tiersFor(now, last)).toEqual([]);
  });

  it('produces daily on the next day within the same week', () => {
    // 2026-05-01 is a Friday; 2026-05-02 is Saturday (same week, same month).
    const last = Date.UTC(2026, 4, 1, 8);
    const now = new Date(Date.UTC(2026, 4, 2, 8));
    expect(tiersFor(now, last)).toEqual(['daily']);
  });

  it('produces weekly across a week boundary', () => {
    // Friday 2026-05-01 → Monday 2026-05-04 is a new week.
    const last = Date.UTC(2026, 4, 1, 8);
    const now = new Date(Date.UTC(2026, 4, 4, 8));
    expect(tiersFor(now, last)).toEqual(['daily', 'weekly']);
  });

  it('produces monthly across a month boundary', () => {
    const last = Date.UTC(2026, 4, 30, 8);
    const now = new Date(Date.UTC(2026, 5, 1, 8));
    const tiers = tiersFor(now, last);
    expect(tiers).toContain('monthly');
    expect(tiers).toContain('daily');
  });

  it('can produce all three at once after a long gap', () => {
    const last = Date.UTC(2026, 0, 1, 8);
    const now = new Date(Date.UTC(2026, 3, 1, 8));
    const tiers = tiersFor(now, last);
    expect(tiers.sort()).toEqual(['daily', 'monthly', 'weekly']);
  });
});

describe('prune', () => {
  it('keeps at most the retention per tier', () => {
    const slots = [
      ...Array.from({ length: 12 }, (_, i) =>
        slot({ tier: 'daily', createdAt: Date.UTC(2026, 4, 1) - i * 86_400_000 }),
      ),
      ...Array.from({ length: 8 }, (_, i) =>
        slot({ tier: 'weekly', createdAt: Date.UTC(2026, 3, 1) - i * 604_800_000 }),
      ),
      ...Array.from({ length: 9 }, (_, i) =>
        slot({ tier: 'monthly', createdAt: Date.UTC(2025, 11, 1) - i * 2_592_000_000 }),
      ),
    ];

    const pruned = prune(index(slots));
    const byTier = (t: string) => pruned.slots.filter((s) => s.tier === t).length;

    expect(byTier('daily')).toBe(RETENTION.daily);
    expect(byTier('weekly')).toBe(RETENTION.weekly);
    expect(byTier('monthly')).toBe(RETENTION.monthly);
  });

  it('keeps the newest of each tier', () => {
    const old = slot({ tier: 'daily', createdAt: Date.UTC(2026, 0, 1) });
    const mid = slot({ tier: 'daily', createdAt: Date.UTC(2026, 2, 1) });
    const recent = slot({ tier: 'daily', createdAt: Date.UTC(2026, 4, 1) });
    const filler = Array.from({ length: RETENTION.daily - 1 }, (_, i) =>
      slot({ tier: 'daily', createdAt: Date.UTC(2026, 3, 1) - i * 1000 }),
    );

    const pruned = prune(index([old, mid, recent, ...filler]));
    expect(pruned.slots.some((s) => s.id === recent.id)).toBe(true);
    expect(pruned.slots.some((s) => s.id === old.id)).toBe(false);
  });

  it('enforces the byte budget oldest-first', () => {
    const big = BUDGET_BYTES / 3 + 1;
    const slots = Array.from({ length: 6 }, (_, i) =>
      slot({ tier: 'monthly', createdAt: Date.UTC(2026, 0, 1) + i * 1000, bytes: big }),
    );

    const pruned = prune(index(slots));
    const total = pruned.slots.reduce((n, s) => n + s.bytes, 0);
    expect(total).toBeLessThanOrEqual(BUDGET_BYTES);
    // The newest survive, the oldest go.
    const newest = slots[slots.length - 1]!;
    expect(pruned.slots.some((s) => s.id === newest.id)).toBe(true);
  });

  it('never exceeds the per-tier cap even when under budget', () => {
    const slots = Array.from({ length: 30 }, (_, i) =>
      slot({ tier: 'weekly', createdAt: Date.UTC(2026, 0, 1) + i * 1000, bytes: 1 }),
    );
    expect(prune(index(slots)).slots.length).toBe(RETENTION.weekly);
  });

  it('handles an empty index', () => {
    expect(prune(index([])).slots).toEqual([]);
  });
});
