// Sync messages. Kept separate from the local-data messages so the UI can
// feature-detect sync support without importing the engine.

import type { SyncState } from '@/sync/state';

export interface SyncGetStateMessage {
  type: 'syncState';
}

export interface SyncSetupMessage {
  type: 'syncSetup';
  endpoint: string;
  pairingSecret: string;
  passphrase: string;
  deviceName: string;
}

export interface SyncSetupResult {
  ok: boolean;
  error?: string;
  fingerprint?: string;
  recoveryPhrase?: string;
  deviceId?: string;
}

export interface SyncPairMessage {
  type: 'syncPair';
  endpoint: string;
  pairingSecret: string;
  passphrase: string;
  deviceName: string;
}

export interface SyncUnlockMessage {
  type: 'syncUnlock';
  secret: string;
  /** Treat `secret` as a 24-word recovery phrase instead of a passphrase. */
  viaRecovery: boolean;
}

export interface SyncNowMessage {
  type: 'syncNow';
}

export interface SyncVerifyMessage {
  type: 'syncVerify';
}

export interface SyncDisableMessage {
  type: 'syncDisable';
  /** Also revoke the host permission and wipe local sync secrets. */
  forget: boolean;
}

export interface SyncForgetMessage {
  type: 'syncForget';
}

export interface SyncStatus {
  configured: boolean;
  enabled: boolean;
  endpoint: string | null;
  deviceName: string | null;
  fingerprint: string | null;
  lastSyncAt: number | null;
  lastError: string | null;
  cursor: number;
  hasRecovery: boolean;
}

export interface SyncRunResult {
  ok: boolean;
  pushed?: number;
  pulled?: number;
  conflicts?: number;
  errors: string[];
  at: number;
}

export function toSyncStatus(state: SyncState): SyncStatus {
  return {
    configured: Boolean(state.endpoint && state.dataKey),
    enabled: state.enabled,
    endpoint: state.endpoint,
    deviceName: state.deviceName,
    fingerprint: state.fingerprint,
    lastSyncAt: state.lastSyncAt,
    lastError: state.lastError,
    cursor: state.cursor,
    hasRecovery: Boolean(state.wrappedByRecovery),
  };
}

/** Every sync message, for the bus union. */
export type SyncMessage =
  | SyncGetStateMessage
  | SyncSetupMessage
  | SyncPairMessage
  | SyncUnlockMessage
  | SyncNowMessage
  | SyncVerifyMessage
  | SyncDisableMessage
  | SyncForgetMessage;
