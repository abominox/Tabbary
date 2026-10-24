/**
 * Sync engine.
 *
 * Model: one blob per session (session row + its tabs + its groups). The blob
 * is encrypted locally with the data key, so the server stores ciphertext with
 * no structure it can read. Blobs are pushed with compare-and-swap, so a device
 * that has been offline cannot silently clobber a newer copy.
 */

import Dexie from 'dexie';
import { db } from '@/db/schema';
import { sessionsRepo, tabsRepo, tabGroupsRepo } from '@/db';
import type { Session, Tab, TabGroup } from '@/models';
import {
  decryptBlob,
  encryptBlob,
  keyFingerprint,
  base64ToBytes,
  bytesToBase64,
} from './crypto';
import { VpsConnector } from './vps-connector';
import { SyncHttpError, type WireBlob } from './connector';
import { readSyncState, writeSyncState, type SyncState } from './state';

export interface SyncSnapshot {
  session: Session;
  tabs: Tab[];
  groups: TabGroup[];
  schema: 1;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  conflicts: number;
  errors: string[];
  at: number;
}

// ── Serialisation ────────────────────────────────────────

export async function snapshotSession(sessionId: string): Promise<SyncSnapshot | null> {
  const session = await sessionsRepo.get(sessionId);
  if (!session) return null;
  const [tabs, groups] = await Promise.all([
    tabsRepo.listBySession(sessionId),
    tabGroupsRepo.listBySession(sessionId),
  ]);
  return {
    schema: 1,
    session,
    tabs: tabs.map((t) => ({ ...t })),
    groups: groups.map((g) => ({ ...g })),
  };
}

/** Timestamp that seeds the AAD; must match what the server stores. */
export function syncUpdatedAt(session: Session): number {
  return Math.max(session.updatedAt || 0, session.closedAt || 0, 1);
}

// ── Applying remote state ────────────────────────────────

export interface ApplyOptions {
  /** Keep this device's copy when it is strictly newer. */
  protectLocal?: boolean;
  /** Window id to preserve for the session that is live on this device. */
  liveWindowId?: number | null;
}

export interface ApplyResult {
  applied: boolean;
  reason?: 'local-newer' | 'missing' | 'local-live';
  tabs: number;
}

/**
 * Replace a local session with a decrypted remote snapshot.
 *
 * Local ids are regenerated for tabs and groups; nothing references them
 * across devices, and regenerating avoids collisions with rows that already
 * exist in this database.
 */
export async function applySessionSnapshot(
  snapshot: SyncSnapshot,
  opts: ApplyOptions = {},
): Promise<ApplyResult> {
  const incoming = snapshot.session;
  const local = await sessionsRepo.get(incoming.id);

  if (local && opts.protectLocal) {
    const localUpdated = local.updatedAt || 0;
    const remoteUpdated = incoming.updatedAt || 0;
    // Equal timestamps are not a reason to overwrite: keep local.
    if (localUpdated >= remoteUpdated) {
      return { applied: false, reason: 'local-newer', tabs: 0 };
    }
    // Never yank a session that is currently bound to a live window.
    if (local.state === 'active' && local.windowId != null) {
      return { applied: false, reason: 'local-live', tabs: 0 };
    }
  }

  const ts = Date.now();
  const sessionId = incoming.id;

  await db.transaction(
    'rw',
    db.sessions,
    db.tabs,
    db.tabGroups,
    async () => {
      const merged: Session = {
        ...incoming,
        id: sessionId,
        // Remote sessions are never live on this device.
        windowId: null,
        state: 'closed',
        // A live window keeps its binding if we were told to preserve it.
        ...(opts.liveWindowId != null
          ? { windowId: opts.liveWindowId, state: 'active' as const }
          : {}),
        updatedAt: incoming.updatedAt || ts,
        version: Math.max(1, incoming.version || 1),
        deleted: false,
      };
      await db.sessions.put(merged);

      // Clear whatever is there now, then insert the snapshot.
      // Dexie types the key as the literal 'id'; at runtime these are strings.
      const tabsTable = db.tabs as Dexie.Table<Tab, string>;
      const groupsTable = db.tabGroups as Dexie.Table<TabGroup, string>;

      const existingTabs = await tabsTable.where('sessionId').equals(sessionId).toArray();
      if (existingTabs.length > 0) {
        await tabsTable.bulkDelete(existingTabs.map((t) => t.id));
      }
      const existingGroups = await groupsTable.where('sessionId').equals(sessionId).toArray();
      if (existingGroups.length > 0) {
        await groupsTable.bulkDelete(existingGroups.map((g) => g.id));
      }

      const groupMap = new Map<string, string>();
      for (const group of snapshot.groups ?? []) {
        const id = crypto.randomUUID();
        groupMap.set(group.id, id);
        await db.tabGroups.put({
          ...group,
          id,
          sessionId,
          chromeGroupId: null,
          createdAt: group.createdAt || ts,
          updatedAt: ts,
          deleted: false,
        });
      }

      let position = 0;
      for (const tab of snapshot.tabs ?? []) {
        await db.tabs.put({
          ...tab,
          id: crypto.randomUUID(),
          sessionId,
          chromeTabId: null,
          groupId: tab.groupId ? (groupMap.get(tab.groupId) ?? null) : null,
          position: Number.isFinite(tab.position) ? tab.position : position++,
          active: false,
          createdAt: tab.createdAt || ts,
          updatedAt: ts,
          deleted: false,
        });
      }
    },
  );

  return { applied: true, tabs: snapshot.tabs?.length ?? 0 };
}

// ── Push ─────────────────────────────────────────────────

export interface PushOptions {
  /** Only these sessions; default: everything non-deleted. */
  sessionIds?: string[];
  state?: SyncState;
  connector?: VpsConnector;
}

/** Push local sessions as encrypted blobs. Returns the updated sync state. */
export async function pushLocalSessions(opts: PushOptions = {}): Promise<{
  pushed: number;
  conflicts: number;
  errors: string[];
  state: SyncState;
}> {
  const state = opts.state ?? (await readSyncState());
  if (!state.dataKey || !state.endpoint) {
    return { pushed: 0, conflicts: 0, errors: ['Sync is not configured'], state };
  }

  const connector = opts.connector ?? new VpsConnector(state.endpoint, state.token);
  const dataKey = base64ToBytes(state.dataKey);

  const ids =
    opts.sessionIds ??
    (await db.sessions.toArray()).filter((s) => !s.deleted).map((s) => s.id);

  const revisions = { ...state.revisions };
  let pushed = 0;
  let conflicts = 0;
  const errors: string[] = [];

  for (const sessionId of ids) {
    const snapshot = await snapshotSession(sessionId);
    if (!snapshot) continue;

    const blobId = `session:${sessionId}`;
    const updatedAt = syncUpdatedAt(snapshot.session);

    try {
      const { ciphertext, iv } = await encryptBlob(dataKey, blobId, snapshot, updatedAt);
      const res = await connector.push({
        id: blobId,
        type: 'session',
        baseRevision: revisions[blobId] ?? 0,
        updatedAt,
        ciphertext,
        iv,
        deleted: snapshot.session.deleted,
      });
      revisions[blobId] = res.revision;
      pushed++;
    } catch (err) {
      if (err instanceof SyncHttpError && err.status === 409) {
        // Another device wrote first. Record the winning revision and move on;
        // the next pull reconciles the content.
        const body = err.body as { revision?: number } | null;
        if (typeof body?.revision === 'number') revisions[blobId] = body.revision;
        conflicts++;
        continue;
      }
      errors.push(`${sessionId}: ${(err as Error).message}`);
    }
  }

  // Injected callers own persistence (the UI passes a live state it manages);
  // the service worker passes nothing and gets the stored copy written back.
  const next = opts.state
    ? { ...state, revisions, lastError: errors[0] ?? null }
    : await writeSyncState({ revisions, lastError: errors[0] ?? null });

  return { pushed, conflicts, errors, state: next };
}

// ── Pull ─────────────────────────────────────────────────

export interface PullOptions {
  state?: SyncState;
  connector?: VpsConnector;
  protectLocal?: boolean;
}

export async function pullRemoteChanges(opts: PullOptions = {}): Promise<{
  pulled: number;
  applied: number;
  skipped: number;
  errors: string[];
  state: SyncState;
}> {
  const state = opts.state ?? (await readSyncState());
  if (!state.dataKey || !state.endpoint) {
    return { pulled: 0, applied: 0, skipped: 0, errors: ['Sync is not configured'], state };
  }

  const connector = opts.connector ?? new VpsConnector(state.endpoint, state.token);
  const dataKey = base64ToBytes(state.dataKey);

  let cursor = state.cursor || 0;
  const revisions = { ...state.revisions };
  let pulled = 0;
  let applied = 0;
  let skipped = 0;
  const errors: string[] = [];

  // The server pages at 500 blobs; follow hasMore until caught up.
  for (let page = 0; page < 20; page++) {
    let batch;
    try {
      batch = await connector.pull(cursor);
    } catch (err) {
      errors.push((err as Error).message);
      break;
    }

    for (const blob of batch.blobs) {
      pulled++;
      cursor = Math.max(cursor, blob.revision);
      revisions[blob.id] = blob.revision;

      if (blob.deleted) {
        skipped++;
        continue;
      }
      if (blob.type !== 'session') {
        skipped++;
        continue;
      }

      try {
        const snapshot = await decryptBlob<SyncSnapshot>(
          dataKey,
          blob.id,
          blob.updatedAt,
          blob.ciphertext,
          blob.iv,
        );
        if (!snapshot?.session?.id) {
          skipped++;
          continue;
        }
        const result = await applySessionSnapshot(snapshot, {
          protectLocal: opts.protectLocal,
        });
        if (result.applied) applied++;
        else skipped++;
      } catch (err) {
        errors.push(`${blob.id}: ${(err as Error).message}`);
      }
    }

    if (!batch.hasMore) break;
  }

  const next = opts.state
    ? { ...state, cursor, revisions, lastSyncAt: Date.now(), lastError: errors[0] ?? null }
    : await writeSyncState({
        cursor,
        revisions,
        lastSyncAt: Date.now(),
        lastError: errors[0] ?? null,
      });

  return { pulled, applied, skipped, errors, state: next };
}

// ── Full cycle ───────────────────────────────────────────

/**
 * Push then pull. Push first so this device's edits are not immediately
 * overwritten by an older remote copy of the same session.
 */
export async function syncNow(): Promise<SyncResult> {
  const state = await readSyncState();
  const errors: string[] = [];

  if (!state.enabled || !state.dataKey) {
    return { pushed: 0, pulled: 0, conflicts: 0, errors: ['Sync is off'], at: Date.now() };
  }

  const connector = new VpsConnector(state.endpoint ?? '', state.token);

  // Pass the freshly-updated state through: pull must use the cursor this push
  // just learned, not a stale copy re-read from storage.
  const push = await pushLocalSessions({ state, connector });
  const pull = await pullRemoteChanges({ state: push.state, connector, protectLocal: true });

  // push/pull do not persist when an explicit state is supplied, so write the
  // final state back here — this is the single storage write per cycle.
  await writeSyncState({
    revisions: pull.state.revisions,
    cursor: pull.state.cursor,
    lastSyncAt: pull.state.lastSyncAt,
    lastError: pull.state.lastError,
  });

  errors.push(...push.errors, ...pull.errors);

  return {
    pushed: push.pushed,
    pulled: pull.applied,
    conflicts: push.conflicts,
    errors,
    at: Date.now(),
  };
}

/** Verify the endpoint + token + key all agree. */
export async function verifyConnection(): Promise<{
  ok: boolean;
  error?: string;
  fingerprint?: string;
  revision?: number;
  device?: string;
}> {
  const state = await readSyncState();
  if (!state.endpoint) return { ok: false, error: 'No endpoint configured' };

  try {
    const connector = new VpsConnector(state.endpoint, state.token);
    const health = await connector.ping();
    if (!health?.ok) return { ok: false, error: 'Server did not report healthy' };
    const me = await connector.me();
    return {
      ok: true,
      revision: me.revision,
      device: me.name,
      fingerprint: state.fingerprint ?? undefined,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Fingerprint for the currently stored key ('' when not set up). */
export async function currentFingerprint(): Promise<string> {
  const state = await readSyncState();
  if (!state.dataKey) return '';
  return keyFingerprint(base64ToBytes(state.dataKey));
}

/** Store the data key + wrapped copies after setup or unlock. */
export async function persistKeys(params: {
  dataKey: Uint8Array;
  wrappedByPassphrase: SyncState['wrappedByPassphrase'];
  wrappedByRecovery: SyncState['wrappedByRecovery'];
  endpoint?: string;
}): Promise<SyncState> {
  const fingerprint = await keyFingerprint(params.dataKey);
  return writeSyncState({
    dataKey: bytesToBase64(params.dataKey),
    wrappedByPassphrase: params.wrappedByPassphrase,
    wrappedByRecovery: params.wrappedByRecovery,
    fingerprint,
    ...(params.endpoint ? { endpoint: params.endpoint } : {}),
    lastError: null,
  });
}
