// Sync scheduling: periodic pull, and a debounced push after local changes.

import { readSyncState } from './state';
import { settingsRepo } from '@/db';
import { handleSyncNow } from '@/sw/sync-handlers';
import { broadcast } from '@/messaging';

export const SYNC_POLL_ALARM = 'tabbary-sync-poll';

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;

/** Recreate the polling alarm to match the user's configured interval. */
export async function scheduleSyncAlarm(): Promise<void> {
  const state = await readSyncState();
  await chrome.alarms.clear(SYNC_POLL_ALARM);

  if (!state.enabled || !state.dataKey) return;

  // Prefer the explicit Settings value; fall back to the state default.
  const secs = await settingsRepo
    .get()
    .then((s) => s.syncPollIntervalSec || state.pollIntervalSec || 60)
    .catch(() => state.pollIntervalSec || 60);

  // Chrome 120+ allows a 30s minimum; 1 minute is the practical floor for a
  // personal sync server and avoids hammering it.
  const minutes = Math.max(1, Math.round(secs / 60));
  chrome.alarms.create(SYNC_POLL_ALARM, {
    periodInMinutes: minutes,
    delayInMinutes: minutes,
  });
}

/**
 * Ask for a sync shortly after a local change. Debounced so a burst of
 * autosaves results in one push, and skipped when another run is in flight.
 */
export function requestSyncPush(reason = 'change'): void {
  if (pushTimer) clearTimeout(pushTimer);

  pushTimer = setTimeout(() => {
    pushTimer = null;
    void runScheduledSync(reason);
  }, 2_000);
}

async function runScheduledSync(reason: string): Promise<void> {
  if (inFlight) return;

  const state = await readSyncState();
  if (!state.enabled || !state.dataKey || !state.token) return;

  inFlight = true;
  try {
    broadcast({ type: 'syncStatusChanged', status: 'syncing' });
    const result = await handleSyncNow();
    broadcast({
      type: 'syncStatusChanged',
      status: result.ok ? 'synced' : 'error',
    });
    if ((result.conflicts ?? 0) > 0) {
      console.log(`[Tabbary SW] sync (${reason}): ${result.conflicts} conflict(s) resolved by pull`);
    }
  } catch (err) {
    console.warn('[Tabbary SW] scheduled sync failed:', err);
    broadcast({ type: 'syncStatusChanged', status: 'error' });
  } finally {
    inFlight = false;
  }
}

export async function cancelSyncTimers(): Promise<void> {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
}
