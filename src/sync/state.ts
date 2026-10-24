/**
 * Local sync state.
 *
 * Everything here lives under one chrome.storage.local key so a single write
 * is atomic. There is no account: the "identity" is a device token from the
 * server plus a data key the user can unlock two ways.
 */

import type { WrappedKey } from './crypto';

export const SYNC_STORAGE_KEY = 'windrow.sync.v1';
export const SYNC_ALARM = 'windrow-sync-poll';
export const HEARTBEAT_ALARM = 'windrow-sync-heartbeat';

export interface SyncState {
  /** Schema version so a future migration can branch. */
  version: 1;

  /** Server endpoint, normalised to an origin + optional path. */
  endpoint: string | null;
  /** Device token. Bearer credential — treat as a secret. */
  token: string | null;
  /** Server-assigned id for this device. */
  deviceId: string | null;
  deviceName: string | null;

  /** Data key, base64. Never leaves this device. */
  dataKey: string | null;
  /** Encrypted copies of the data key (one per unlock method). */
  wrappedByPassphrase: WrappedKey | null;
  wrappedByRecovery: WrappedKey | null;
  /** Human-checkable fingerprint of the data key. */
  fingerprint: string | null;

  /** Highest server revision this device has applied. */
  cursor: number;
  /**
   * Server revision per blob id, used as baseRevision on the next push so the
   * server can reject writes based on stale state.
   */
  revisions: Record<string, number>;

  enabled: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
  /** Bumped by the UI after a settings change to force a reconcile. */
  generation: number;
  /** How often to pull, in seconds (clamped by the scheduler). */
  pollIntervalSec: number;
  /** Machine id so two profiles on one machine are distinguishable. */
  clientId: string;
}

export const EMPTY_SYNC_STATE: SyncState = {
  version: 1,
  endpoint: null,
  token: null,
  deviceId: null,
  deviceName: null,
  dataKey: null,
  wrappedByPassphrase: null,
  wrappedByRecovery: null,
  fingerprint: null,
  cursor: 0,
  revisions: {},
  enabled: false,
  lastSyncAt: null,
  lastError: null,
  generation: 0,
  pollIntervalSec: 60,
  clientId: '',
};

export async function readSyncState(): Promise<SyncState> {
  const stored = await chrome.storage.local.get(SYNC_STORAGE_KEY);
  const raw = stored[SYNC_STORAGE_KEY] as Partial<SyncState> | undefined;
  if (!raw) return { ...EMPTY_SYNC_STATE, clientId: crypto.randomUUID() };
  return { ...EMPTY_SYNC_STATE, ...raw };
}

export async function writeSyncState(patch: Partial<SyncState>): Promise<SyncState> {
  const current = await readSyncState();
  const next: SyncState = { ...current, ...patch, version: 1 };
  if (!next.clientId) next.clientId = crypto.randomUUID();
  await chrome.storage.local.set({ [SYNC_STORAGE_KEY]: next });
  return next;
}

/**
 * Clear credentials but keep the endpoint so re-pairing is one click.
 * Used by "disconnect".
 */
export async function clearSyncCredentials(): Promise<SyncState> {
  const current = await readSyncState();
  return writeSyncState({
    ...EMPTY_SYNC_STATE,
    endpoint: current.endpoint,
    clientId: current.clientId,
    generation: current.generation + 1,
  });
}
