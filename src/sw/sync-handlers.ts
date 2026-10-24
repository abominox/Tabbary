// Sync message handlers, run inside the service worker.

import {
  createSyncKeys,
  persistKeys,
  readSyncState,
  writeSyncState,
  clearSyncCredentials,
  syncNow,
  verifyConnection,
  unwrapWithPassphrase,
  unwrapWithRecoveryPhrase,
  currentFingerprint,
  base64ToBytes,
  bytesToBase64,
  VpsConnector,
  pullRemoteChanges,
  type SyncSnapshot,
  type WrappedKey,
} from '@/sync';
import { toSyncStatus, type SyncSetupResult, type SyncRunResult } from '@/messaging/sync';
import { removeHostPermission } from '@/lib/permissions';
import { broadcast } from '@/messaging';

function newDeviceName(): string {
  const platform =
    // navigator.userAgentData is not in the SW typings; fall back safely.
    (globalThis as { navigator?: { platform?: string } }).navigator?.platform ?? 'Chrome';
  return `${platform} · ${new Date().toLocaleDateString()}`.slice(0, 100);
}

/**
 * First-time setup: create the data key, pair with the server, and push the
 * existing library so the user does not have to wait for a second pass.
 */
export async function handleSyncSetup(msg: {
  endpoint: string;
  pairingSecret: string;
  passphrase: string;
  deviceName: string;
}): Promise<SyncSetupResult> {
  try {
    const endpoint = msg.endpoint.trim();
    if (!endpoint) return { ok: false, error: 'Enter a server URL' };

    // Ask for just this origin. The user gesture is the click that submitted
    // the form, which the UI performs synchronously before awaiting.
    await ensureHostPermission(endpoint);

    const connector = new VpsConnector(endpoint);
    const health = await connector.ping().catch(() => null);
    if (!health?.ok) {
      return { ok: false, error: `No Windrow sync server responded at ${connector.origin}` };
    }

    const paired = await connector.pair(
      msg.pairingSecret,
      msg.deviceName.trim() || newDeviceName(),
    );
    const keys = await createSyncKeys(msg.passphrase);

    await writeSyncState({
      endpoint: connector.origin,
      token: paired.token,
      deviceId: paired.deviceId,
      deviceName: msg.deviceName.trim() || newDeviceName(),
      enabled: true,
      cursor: 0,
      revisions: {},
      generation: Date.now(),
    });
    await persistKeys({
      dataKey: keys.dataKey,
      wrappedByPassphrase: keys.wrappedByPassphrase,
      wrappedByRecovery: keys.wrappedByRecovery,
    });

    // Upload the wrapped key copies so another device can unlock the same data
    // without knowing this device's passphrase.
    const keyUpdatedAt = Date.now();
    await connector.push({
      id: 'keys',
      type: 'keys',
      baseRevision: 0,
      updatedAt: keyUpdatedAt,
      ciphertext: JSON.stringify({
        wrappedByPassphrase: keys.wrappedByPassphrase,
        wrappedByRecovery: keys.wrappedByRecovery,
        fingerprint: await currentFingerprint(),
      }),
      iv: '',
    });

    // Push what already exists locally.
    await syncNow();

    return {
      ok: true,
      fingerprint: await currentFingerprint(),
      recoveryPhrase: keys.recoveryPhrase,
      deviceId: paired.deviceId,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Join an existing sync account from a second device: pair, then fetch the
 * wrapped keys from the server and unlock them with the passphrase.
 */
export async function handleSyncPair(msg: {
  endpoint: string;
  pairingSecret: string;
  passphrase: string;
  deviceName: string;
}): Promise<SyncSetupResult> {
  try {
    await ensureHostPermission(msg.endpoint.trim());
    const connector = new VpsConnector(msg.endpoint.trim());
    const health = await connector.ping().catch(() => null);
    if (!health?.ok) return { ok: false, error: 'No sync server responded at that address' };

    const paired = await connector.pair(
      msg.pairingSecret,
      msg.deviceName.trim() || newDeviceName(),
    );

    const pull = await connector.pull(0);
    const keysBlob = pull.blobs.find((b) => b.type === 'keys' && !b.deleted);
    if (!keysBlob) {
      return {
        ok: false,
        error: 'That server has no key material yet — set up sync on your first device instead',
      };
    }

    let material: KeyMaterial;
    try {
      material = JSON.parse(keysBlob.ciphertext) as KeyMaterial;
    } catch {
      return { ok: false, error: 'The key material on the server is unreadable' };
    }
    if (!material?.wrappedByPassphrase || !material?.wrappedByRecovery) {
      return { ok: false, error: 'The key material on the server is incomplete' };
    }

    let dataKey: Uint8Array;
    try {
      dataKey = await unwrapWithPassphrase(material.wrappedByPassphrase, msg.passphrase);
    } catch {
      return { ok: false, error: 'Wrong passphrase for this sync account' };
    }

    await writeSyncState({
      endpoint: connector.origin,
      token: paired.token,
      deviceId: paired.deviceId,
      deviceName: msg.deviceName.trim() || newDeviceName(),
      enabled: true,
      cursor: 0,
      revisions: {},
      generation: Date.now(),
    });
    await persistKeys({
      dataKey,
      wrappedByPassphrase: material.wrappedByPassphrase,
      wrappedByRecovery: material.wrappedByRecovery,
    });

    await syncNow();

    return { ok: true, fingerprint: await currentFingerprint(), deviceId: paired.deviceId };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Ensure this extension may talk to the user's server.
 *
 * Host access is optional, so without this fetch fails with a CORS/blocked
 * error. Requesting it here (rather than at install) is what keeps the
 * install prompt free of "read data on all sites".
 */
async function ensureHostPermission(endpoint: string): Promise<void> {
  const connector = new VpsConnector(endpoint);
  const origin = connector.origin;
  const pattern = `${origin}/*`;

  const already = await chrome.permissions.contains({ origins: [pattern] });
  if (already) return;

  const granted = await chrome.permissions.request({ origins: [pattern] });
  if (!granted) {
    throw new Error('Windrow needs permission to reach that server to sync');
  }
}

/** Shape of the `keys` blob uploaded by the first device. */
interface KeyMaterial {
  wrappedByPassphrase: WrappedKey;
  wrappedByRecovery: WrappedKey;
  fingerprint?: string;
}

/** Unlock with a passphrase or recovery phrase after a restart. */
export async function handleSyncUnlock(msg: {
  secret: string;
  viaRecovery: boolean;
}): Promise<{ ok: boolean; error?: string; fingerprint?: string }> {
  try {
    const state = await readSyncState();
    const wrapped = msg.viaRecovery ? state.wrappedByRecovery : state.wrappedByPassphrase;
    if (!wrapped) return { ok: false, error: 'This device has no stored key material' };

    const dataKey = msg.viaRecovery
      ? await unwrapWithRecoveryPhrase(wrapped, msg.secret)
      : await unwrapWithPassphrase(wrapped, msg.secret);

    await writeSyncState({ dataKey: bytesToBase64(dataKey), enabled: true, lastError: null });
    return { ok: true, fingerprint: await currentFingerprint() };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function handleSyncNow(): Promise<SyncRunResult> {
  try {
    const result = await syncNow();
    broadcast({ type: 'sessionsChanged' });
    broadcast({
      type: 'syncStatusChanged',
      status: result.errors.length > 0 ? 'error' : 'synced',
    });
    return {
      ok: result.errors.length === 0,
      pushed: result.pushed,
      pulled: result.pulled,
      conflicts: result.conflicts,
      errors: result.errors,
      at: result.at,
    };
  } catch (err) {
    return { ok: false, errors: [(err as Error).message], at: Date.now() };
  }
}

export async function handleSyncState(): Promise<ReturnType<typeof toSyncStatus>> {
  return toSyncStatus(await readSyncState());
}

export async function handleSyncVerify() {
  return verifyConnection();
}

export async function handleSyncDisable(msg: { forget: boolean }) {
  const state = await readSyncState();
  if (msg.forget && state.endpoint) {
    try {
      await removeHostPermission(state.endpoint);
    } catch {
      /* permission may not be granted */
    }
  }
  if (msg.forget) await clearSyncCredentials();
  else await writeSyncState({ enabled: false });
  return toSyncStatus(await readSyncState());
}

export async function handleSyncForget() {
  const state = await readSyncState();
  if (state.endpoint) {
    try {
      await removeHostPermission(state.endpoint);
    } catch {
      /* ignore */
    }
  }
  await clearSyncCredentials();
  return toSyncStatus(await readSyncState());
}

/** Pull-only helper used by the engine tests and future "restore from server". */
export async function pullOnce(): Promise<{ applied: number; errors: string[] }> {
  const r = await pullRemoteChanges({ protectLocal: true });
  return { applied: r.applied, errors: r.errors };
}

export type { SyncSnapshot, base64ToBytes, bytesToBase64 };
