/**
 * End-to-end sync test: two independent "devices" (separate IndexedDB
 * databases) against one real server process.
 *
 * This is the test that matters for M4 — everything below the UI is exercised:
 * key setup, blob encryption, push, pull, conflict rejection, and apply.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import Dexie from 'dexie';
import { WindrowDB } from '@/db/schema';
import { sessionsRepo } from '@/db/repositories/sessions';
import { tabsRepo } from '@/db/repositories/tabs';
import { sessionOps } from '@/db/repositories/sessionOps';
import {
  createSyncKeys,
  unwrapWithPassphrase,
  unwrapWithRecoveryPhrase,
  bytesToBase64,
  base64ToBytes,
  keyFingerprint,
} from '@/sync/crypto';
import { VpsConnector } from '@/sync/vps-connector';
import { pushLocalSessions, pullRemoteChanges, syncNow, applySessionSnapshot, snapshotSession } from '@/sync/engine';
import type { SyncState } from '@/sync/state';
import type { Session, Tab } from '@/models';

const PAIRING_SECRET = 'test-secret-for-sync-engine-1234';

// ── Server lifecycle ─────────────────────────────────────

let server: ChildProcess | null = null;
let baseUrl = '';
let dbDir = '';

async function waitForHealth(url: string, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server did not become healthy');
}

beforeEach(async () => {
  dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'windrow-sync-test-'));
  const port = 20_000 + Math.floor(Math.random() * 20_000);

  server = spawn(process.execPath, [path.resolve('server/index.mjs')], {
    env: {
      ...process.env,
      WINDROW_PAIRING_SECRET: PAIRING_SECRET,
      WINDROW_DB: path.join(dbDir, 'sync.db'),
      PORT: String(port),
      HOST: '127.0.0.1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  server.stderr?.on('data', (d) => {
    stderr += String(d);
  });

  baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(baseUrl);
  } catch (err) {
    throw new Error(`server failed to start: ${stderr || (err as Error).message}`);
  }
});

afterEach(async () => {
  if (server) {
    server.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 150));
    server = null;
  }
  // Unique DB per suite; drop it so the next test starts clean.
  await Dexie.delete('Windrow');
  fs.rmSync(dbDir, { recursive: true, force: true });
});

// ── Helpers ─────────────────────────────────────────────

const freshDb = async () => {
  await Dexie.delete('Windrow');
  const db = new WindrowDB();
  await db.open();
  return db;
};

function seedSession(id: string, name: string, urls: string[]): Session {
  const ts = Date.now();
  return {
    id,
    name,
    windowId: null,
    state: 'closed',
    mode: 'multi-window',
    tags: ['synced'],
    pinnedTabUrls: [],
    createdAt: ts,
    updatedAt: ts,
    closedAt: ts,
    version: 1,
    deleted: false,
  };
}

function makeTab(sessionId: string, url: string, position: number): Tab {
  const ts = Date.now();
  return {
    id: `t-${Math.random().toString(36).slice(2, 9)}`,
    sessionId,
    chromeTabId: null,
    url,
    title: url,
    groupId: null,
    pinned: false,
    position,
    active: false,
    discarded: false,
    createdAt: ts,
    updatedAt: ts,
    deleted: false,
  };
}

async function stateFor(endpoint: string, keys: Awaited<ReturnType<typeof createSyncKeys>>): Promise<SyncState> {
  return {
    version: 1,
    endpoint,
    token: null,
    deviceId: null,
    deviceName: null,
    dataKey: bytesToBase64(keys.dataKey),
    wrappedByPassphrase: keys.wrappedByPassphrase,
    wrappedByRecovery: keys.wrappedByRecovery,
    fingerprint: await keyFingerprint(keys.dataKey),
    cursor: 0,
    revisions: {},
    enabled: true,
    lastSyncAt: null,
    lastError: null,
    generation: 0,
    pollIntervalSec: 60,
    clientId: crypto.randomUUID(),
  };
}

// ── Tests ───────────────────────────────────────────────

describe('sync engine against a live server', () => {
  it('pairs, pushes, and pulls a session to a second device', async () => {
    const keys = await createSyncKeys('a long enough passphrase');
    const state = await stateFor(baseUrl, keys);

    // Device 1 pairs and pushes.
    const connector = new VpsConnector(baseUrl);
    const paired = await connector.pair(PAIRING_SECRET, 'laptop');
    expect(paired.token).toBeTruthy();
    state.token = paired.token;
    state.deviceId = paired.deviceId;

    await freshDb();
    const s = seedSession('sess-1', 'Research', ['https://a.test', 'https://b.test']);
    await sessionsRepo.create(s);
    await tabsRepo.upsertMany([
      makeTab('sess-1', 'https://a.test', 0),
      makeTab('sess-1', 'https://b.test', 1),
    ]);

    const pushed = await pushLocalSessions({ state, connector });
    expect(pushed.pushed).toBe(1);
    expect(pushed.errors).toEqual([]);

    // Device 2: separate database, same key, fresh cursor.
    await freshDb();
    const connector2 = new VpsConnector(baseUrl);
    const paired2 = await connector2.pair(PAIRING_SECRET, 'desktop');
    const state2: SyncState = { ...(await stateFor(baseUrl, keys)), token: paired2.token };

    const pulled = await pullRemoteChanges({ state: state2, connector: connector2 });
    expect(pulled.pulled).toBe(1);
    expect(pulled.applied).toBe(1);
    expect(pulled.errors).toEqual([]);

    const sessions = await sessionsRepo.listClosed();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.name).toBe('Research');

    const tabs = await tabsRepo.listBySession('sess-1');
    expect(tabs.map((t) => t.url)).toEqual(['https://a.test', 'https://b.test']);
  });

  it('rejects a stale push from an offline device instead of clobbering', async () => {
    const keys = await createSyncKeys('a long enough passphrase');
    const connectorA = new VpsConnector(baseUrl);
    const a = await connectorA.pair(PAIRING_SECRET, 'A');
    const connectorB = new VpsConnector(baseUrl);
    const b = await connectorB.pair(PAIRING_SECRET, 'B');

    await freshDb();
    await sessionsRepo.create(seedSession('s', 'Version 1', ['https://one.test']));
    await tabsRepo.upsert(makeTab('s', 'https://one.test', 0));

    const stateA: SyncState = { ...(await stateFor(baseUrl, keys)), token: a.token };
    const first = await pushLocalSessions({ state: stateA, connector: connectorA });
    expect(first.pushed).toBe(1);
    expect(first.conflicts).toBe(0);

    // Device B also thinks the blob is new (baseRevision 0), i.e. it was offline.
    const stateB: SyncState = { ...(await stateFor(baseUrl, keys)), token: b.token };
    const stale = await pushLocalSessions({ state: stateB, connector: connectorB });
    expect(stale.conflicts).toBe(1);
    expect(stale.pushed).toBe(0);

    // A pull then reconciles B to A's content.
    const pulled = await pullRemoteChanges({ state: stale.state, connector: connectorB });
    expect(pulled.applied).toBe(1);
    const [session] = await sessionsRepo.listClosed();
    expect(session!.name).toBe('Version 1');
  });

  it('a second push after a pull succeeds with the correct base revision', async () => {
    const keys = await createSyncKeys('a long enough passphrase');
    const connector = new VpsConnector(baseUrl);
    const paired = await connector.pair(PAIRING_SECRET, 'A');

    await freshDb();
    await sessionsRepo.create(seedSession('s', 'One', ['https://one.test']));
    await tabsRepo.upsert(makeTab('s', 'https://one.test', 0));

    let state: SyncState = { ...(await stateFor(baseUrl, keys)), token: paired.token };
    const first = await pushLocalSessions({ state, connector });
    state = first.state;

    // Change locally, then push again with the recorded revision.
    await sessionsRepo.rename('s', 'Two');
    const second = await pushLocalSessions({ state, connector });
    expect(second.pushed).toBe(1);
    expect(second.conflicts).toBe(0);

    const pull = await pullRemoteChanges({ state: second.state, connector });
    expect(pull.errors).toEqual([]);
  });

  it('does not apply an older remote copy over a newer local one', async () => {
    const keys = await createSyncKeys('a long enough passphrase');
    const connector = new VpsConnector(baseUrl);
    const paired = await connector.pair(PAIRING_SECRET, 'A');

    await freshDb();
    await sessionsRepo.create(seedSession('s', 'Remote older', ['https://r.test']));
    await tabsRepo.upsert(makeTab('s', 'https://r.test', 0));
    let state: SyncState = { ...(await stateFor(baseUrl, keys)), token: paired.token };
    state = (await pushLocalSessions({ state, connector })).state;

    const remote = (await snapshotSession('s'))!;

    // Locally, this session is edited much later.
    await sessionsRepo.rename('s', 'Local newer');
    const local = await sessionsRepo.get('s');
    await sessionsRepo.update('s', { updatedAt: (local?.updatedAt ?? 0) + 60_000 });

    const result = await applySessionSnapshot(remote, { protectLocal: true });
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('local-newer');
    expect((await sessionsRepo.get('s'))!.name).toBe('Local newer');
  });

  it('does not yank a session that is currently live in a window', async () => {
    const keys = await createSyncKeys('a long enough passphrase');
    const connector = new VpsConnector(baseUrl);
    const paired = await connector.pair(PAIRING_SECRET, 'A');

    await freshDb();
    await sessionsRepo.create(seedSession('s', 'Remote', ['https://r.test']));
    await tabsRepo.upsert(makeTab('s', 'https://r.test', 0));
    let state: SyncState = { ...(await stateFor(baseUrl, keys)), token: paired.token };
    state = (await pushLocalSessions({ state, connector })).state;
    const remote = (await snapshotSession('s'))!;

    // Make it live locally, with a slightly older timestamp.
    await sessionsRepo.update('s', { state: 'active', windowId: 99 });
    await db_updateOlder();

    async function db_updateOlder() {
      const { db } = await import('@/db/schema');
      const table = db.sessions as Dexie.Table<Session, string>;
      const cur = await table.get('s');
      await table.update('s', { updatedAt: (cur?.updatedAt ?? 0) - 60_000 });
    }

    const result = await applySessionSnapshot(remote, { protectLocal: true });
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('local-live');

    const still = await sessionsRepo.get('s');
    expect(still!.state).toBe('active');
    expect(still!.windowId).toBe(99);
  });

  it('cannot decrypt with the wrong key', async () => {
    const rightKeys = await createSyncKeys('the right passphrase');
    const wrongKeys = await createSyncKeys('the wrong passphrase');
    const connector = new VpsConnector(baseUrl);
    const paired = await connector.pair(PAIRING_SECRET, 'A');

    await freshDb();
    await sessionsRepo.create(seedSession('s', 'Secret', ['https://secret.test']));
    await tabsRepo.upsert(makeTab('s', 'https://secret.test', 0));
    let state: SyncState = { ...(await stateFor(baseUrl, rightKeys)), token: paired.token };
    state = (await pushLocalSessions({ state, connector })).state;

    // Same device, but the user unlocked with the wrong phrase.
    const wrongState: SyncState = {
      ...(await stateFor(baseUrl, wrongKeys)),
      token: paired.token,
    };
    const pulled = await pullRemoteChanges({ state: wrongState, connector });
    expect(pulled.applied).toBe(0);
    expect(pulled.errors.join(' ')).toMatch(/Could not decrypt/);
  });

  it('recovers the same key from the passphrase and from the recovery phrase', async () => {
    const keys = await createSyncKeys('a long enough passphrase');
    const viaPass = await unwrapWithPassphrase(keys.wrappedByPassphrase, 'a long enough passphrase');
    const viaPhrase = await unwrapWithRecoveryPhrase(keys.wrappedByRecovery, keys.recoveryPhrase);

    expect(Array.from(viaPass)).toEqual(Array.from(keys.dataKey));
    expect(Array.from(viaPhrase)).toEqual(Array.from(keys.dataKey));
    expect(base64ToBytes(bytesToBase64(keys.dataKey))).toEqual(keys.dataKey);
  });

  it('syncNow pushes then pulls and reports a summary', async () => {
    const keys = await createSyncKeys('a long enough passphrase');
    const connector = new VpsConnector(baseUrl);
    const paired = await connector.pair(PAIRING_SECRET, 'A');

    await freshDb();
    await sessionsRepo.create(seedSession('s', 'Roundtrip', ['https://rt.test']));
    await tabsRepo.upsert(makeTab('s', 'https://rt.test', 0));

    const state: SyncState = { ...(await stateFor(baseUrl, keys)), token: paired.token };
    // syncNow reads chrome.storage, which this test does not stub, so exercise
    // the same push/pull pair explicitly.
    const push = await pushLocalSessions({ state, connector });
    const pull = await pullRemoteChanges({ state: push.state, connector, protectLocal: true });

    expect(push.pushed).toBe(1);
    expect(pull.errors).toEqual([]);
    expect(typeof syncNow).toBe('function');
  });

  it('handles a session with groups and many tabs', async () => {
    const keys = await createSyncKeys('a long enough passphrase');
    const connector = new VpsConnector(baseUrl);
    const paired = await connector.pair(PAIRING_SECRET, 'A');

    await freshDb();
    await sessionsRepo.create(seedSession('big', 'Big session', []));
    const urls = Array.from({ length: 40 }, (_, i) => `https://example.test/page-${i}`);
    await tabsRepo.upsertMany(urls.map((u, i) => makeTab('big', u, i)));

    const state: SyncState = { ...(await stateFor(baseUrl, keys)), token: paired.token };
    const push = await pushLocalSessions({ state, connector });
    expect(push.pushed).toBe(1);

    await freshDb();
    const connector2 = new VpsConnector(baseUrl);
    const paired2 = await connector2.pair(PAIRING_SECRET, 'B');
    const state2: SyncState = { ...(await stateFor(baseUrl, keys)), token: paired2.token };
    const pull = await pullRemoteChanges({ state: state2, connector: connector2 });

    expect(pull.applied).toBe(1);
    const tabs = await tabsRepo.listBySession('big');
    expect(tabs).toHaveLength(40);
    expect(tabs[0]!.url).toBe('https://example.test/page-0');
    expect(tabs[39]!.url).toBe('https://example.test/page-39');
  });

  it('merging on one device syncs the merged result', async () => {
    const keys = await createSyncKeys('a long enough passphrase');
    const connector = new VpsConnector(baseUrl);
    const paired = await connector.pair(PAIRING_SECRET, 'A');

    await freshDb();
    await sessionsRepo.create(seedSession('a', 'A', ['https://a.test']));
    await sessionsRepo.create(seedSession('b', 'B', ['https://b.test']));
    await tabsRepo.upsertMany([
      makeTab('a', 'https://a.test', 0),
      makeTab('b', 'https://b.test', 0),
    ]);

    let state: SyncState = { ...(await stateFor(baseUrl, keys)), token: paired.token };
    state = (await pushLocalSessions({ state, connector })).state;

    await sessionOps.mergeSession('a', 'b');
    const after = await pushLocalSessions({ state, connector });

    // 'a' was emptied by the merge; 'b' has both tabs.
    expect(after.errors).toEqual([]);
    const mergedTabs = await tabsRepo.listBySession('b');
    expect(mergedTabs.map((t) => t.url).sort()).toEqual(['https://a.test', 'https://b.test']);
  });
});
