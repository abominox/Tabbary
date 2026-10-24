/**
 * Local automatic backups.
 *
 * Writes a JSON snapshot of the whole library into extension storage on a
 * rolling daily/weekly/monthly scheme. Deliberately not a cloud feature: this
 * is the "you can always get your data back" floor that does not require a
 * server, an account, or a passphrase.
 *
 * Snapshots are uncompressed JSON (see src/lib/bundle.ts). They are stored in
 * chrome.storage.local under one key per slot, so a corrupt write can only
 * damage one slot.
 */

import { exportAll } from '@/db/io';
import { readSyncState } from '@/sync/state';

export const BACKUP_ALARM = 'windrow-backup';
export const BACKUP_INDEX_KEY = 'windrow.backups.index';
export const BACKUP_SLOT_PREFIX = 'windrow.backups.slot.';

export interface BackupSlot {
  id: string;
  /** 'daily' | 'weekly' | 'monthly' */
  tier: 'daily' | 'weekly' | 'monthly';
  createdAt: number;
  sessions: number;
  tabs: number;
  bytes: number;
}

export interface BackupIndex {
  enabled: boolean;
  lastRunAt: number | null;
  slots: BackupSlot[];
}

export const EMPTY_BACKUP_INDEX: BackupIndex = {
  enabled: true,
  lastRunAt: null,
  slots: [],
};

/** Retention per tier. Kept small: storage.local is not a filesystem. */
export const RETENTION = { daily: 7, weekly: 4, monthly: 6 } as const;

/** Total bytes we are willing to spend on backups. */
export const BUDGET_BYTES = 20 * 1024 * 1024;

export async function readBackupIndex(): Promise<BackupIndex> {
  const stored = await chrome.storage.local.get(BACKUP_INDEX_KEY);
  const raw = stored[BACKUP_INDEX_KEY] as BackupIndex | undefined;
  return { ...EMPTY_BACKUP_INDEX, ...(raw ?? {}) };
}

async function writeIndex(index: BackupIndex): Promise<void> {
  await chrome.storage.local.set({ [BACKUP_INDEX_KEY]: index });
}

/**
 * Which tier a snapshot belongs to, given the previous one.
 * The first run of a day is daily; the first of a week is weekly; the first of
 * a month is monthly. A single run can produce several tiers at once.
 */
export function tiersFor(now: Date, lastRunAt: number | null): ('daily' | 'weekly' | 'monthly')[] {
  if (lastRunAt == null) return ['daily', 'weekly', 'monthly'];

  const last = new Date(lastRunAt);
  const tiers: ('daily' | 'weekly' | 'monthly')[] = [];

  const sameDay =
    last.getFullYear() === now.getFullYear() &&
    last.getMonth() === now.getMonth() &&
    last.getDate() === now.getDate();
  if (!sameDay) tiers.push('daily');

  // Week boundary: ISO-ish, comparing the Monday of each week.
  if (weekStart(last).getTime() !== weekStart(now).getTime()) tiers.push('weekly');

  if (
    last.getFullYear() !== now.getFullYear() ||
    last.getMonth() !== now.getMonth()
  ) {
    tiers.push('monthly');
  }

  return tiers;
}

function weekStart(d: Date): Date {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (copy.getDay() + 6) % 7; // Monday = 0
  copy.setDate(copy.getDate() - day);
  return copy;
}

/**
 * Drop the oldest slots beyond retention, then beyond the byte budget.
 * Returns the surviving index.
 */
export function prune(index: BackupIndex, now = Date.now()): BackupIndex {
  const kept: BackupSlot[] = [];

  for (const tier of ['daily', 'weekly', 'monthly'] as const) {
    const ofTier = index.slots
      .filter((s) => s.tier === tier)
      .sort((a, b) => b.createdAt - a.createdAt);
    kept.push(...ofTier.slice(0, RETENTION[tier]));
  }

  // Enforce the byte budget oldest-first.
  let total = kept.reduce((n, s) => n + s.bytes, 0);
  const byAge = kept.slice().sort((a, b) => a.createdAt - b.createdAt);
  const removed = new Set<string>();

  for (const slot of byAge) {
    if (total <= BUDGET_BYTES) break;
    removed.add(slot.id);
    total -= slot.bytes;
  }

  return { ...index, slots: kept.filter((s) => !removed.has(s.id)) };
}

/** Take a snapshot now. Safe to call repeatedly; tiers are resolved internally. */
export async function runBackup(
  opts: { force?: boolean; now?: number } = {},
): Promise<{ written: BackupSlot[]; skipped: string | null }> {
  const index = await readBackupIndex();
  if (!index.enabled && !opts.force) {
    return { written: [], skipped: 'backups are disabled' };
  }

  const now = opts.now ?? Date.now();
  const tiers = opts.force ? (['daily'] as const) : tiersFor(new Date(now), index.lastRunAt);
  if (tiers.length === 0) return { written: [], skipped: 'already backed up today' };

  const exported = await exportAll();
  const json = exported.json;

  // Avoid storing a snapshot identical to the newest one: autosave means most
  // runs would otherwise duplicate unchanged data.
  const newest = index.slots.slice().sort((a, b) => b.createdAt - a.createdAt)[0];
  if (newest) {
    const prev = await chrome.storage.local.get(BACKUP_SLOT_PREFIX + newest.id);
    const prevJson = (prev[BACKUP_SLOT_PREFIX + newest.id] as string | undefined) ?? '';
    if (prevJson === json) {
      await writeIndex({ ...index, lastRunAt: now });
      return { written: [], skipped: 'no changes since the last backup' };
    }
  }

  const written: BackupSlot[] = [];
  const writes: Record<string, unknown> = {};

  for (const tier of tiers) {
    const slot: BackupSlot = {
      id: `${tier}-${now}-${Math.random().toString(36).slice(2, 6)}`,
      tier,
      createdAt: now,
      sessions: exported.bundle.counts.sessions,
      tabs: exported.bundle.counts.tabs,
      bytes: exported.bytes,
    };
    writes[BACKUP_SLOT_PREFIX + slot.id] = json;
    written.push(slot);
  }

  await chrome.storage.local.set(writes as Record<string, string>);

  const next = prune({ ...index, lastRunAt: now, slots: [...written, ...index.slots] }, now);

  // Delete the payloads of pruned slots.
  const surviving = new Set(next.slots.map((s) => s.id));
  const toDelete = [...index.slots, ...written]
    .map((s) => s.id)
    .filter((id) => !surviving.has(id))
    .map((id) => BACKUP_SLOT_PREFIX + id);
  if (toDelete.length > 0) await chrome.storage.local.remove(toDelete);

  await writeIndex(next);
  return { written, skipped: null };
}

/** Read one snapshot's JSON. */
export async function readBackup(id: string): Promise<string | null> {
  const stored = await chrome.storage.local.get(BACKUP_SLOT_PREFIX + id);
  return (stored[BACKUP_SLOT_PREFIX + id] as string | undefined) ?? null;
}

export async function deleteBackup(id: string): Promise<void> {
  const index = await readBackupIndex();
  await chrome.storage.local.remove(BACKUP_SLOT_PREFIX + id);
  await writeIndex({ ...index, slots: index.slots.filter((s) => s.id !== id) });
}

export async function setBackupsEnabled(enabled: boolean): Promise<BackupIndex> {
  const index = await readBackupIndex();
  const next = { ...index, enabled };
  await writeIndex(next);
  return next;
}

/** Schedule the daily check. Chrome clamps periods; 12h is a safe cadence. */
export async function scheduleBackupAlarm(): Promise<void> {
  await chrome.alarms.clear(BACKUP_ALARM);
  const index = await readBackupIndex();
  if (!index.enabled) return;
  chrome.alarms.create(BACKUP_ALARM, { periodInMinutes: 12 * 60, delayInMinutes: 2 });
}

/** Storage used by backups, for the settings panel. */
export async function backupUsage(): Promise<{ bytes: number; count: number }> {
  const index = await readBackupIndex();
  return {
    bytes: index.slots.reduce((n, s) => n + s.bytes, 0),
    count: index.slots.length,
  };
}

/** The sync key is not needed for local backups; this keeps the import tidy. */
export async function backupMeta(): Promise<{ syncConfigured: boolean }> {
  const state = await readSyncState();
  return { syncConfigured: Boolean(state.endpoint) };
}
