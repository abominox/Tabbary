/**
 * Server tests. Uses node:test (built in), no dependencies.
 * Each test file run gets an in-memory database.
 *
 * Run: node --test server/server.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.WINDROW_PAIRING_SECRET = 'test-pairing-secret-long-enough';
process.env.WINDROW_PAIR_LIMIT = '100';

const { createSyncServer } = await import('./index.mjs');

const SECRET = 'test-pairing-secret-long-enough';

/** Start a server on an ephemeral port, return helpers. */
async function startServer(dbPath = ':memory:', options = {}) {
  const app = createSyncServer({ dbPath, ...options });
  const port = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${port}`;

  return {
    base,
    app,
    async close() {
      await app.close();
    },
    async req(path, { method = 'GET', token, body, headers = {} } = {}) {
      const res = await fetch(base + path, {
        method,
        headers: {
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      let payload = null;
      try {
        payload = await res.json();
      } catch {
        /* empty body */
      }
      return { status: res.status, body: payload };
    },
    async pair(name = 'Test device', secret = SECRET) {
      const r = await this.req('/auth/pair', {
        method: 'POST',
        body: { pairingSecret: secret, deviceName: name },
      });
      return r;
    },
  };
}

test('health is public and reports the service', async (t) => {
  const s = await startServer();
  t.after(() => s.close());

  const r = await s.req('/health');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.service, 'windrow-sync');
});

test('pairing requires the configured secret', async (t) => {
  const s = await startServer();
  t.after(() => s.close());

  const bad = await s.pair('x', 'wrong-secret');
  assert.equal(bad.status, 401);

  const missing = await s.req('/auth/pair', { method: 'POST', body: { deviceName: 'x' } });
  assert.equal(missing.status, 401);

  const ok = await s.pair();
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
  assert.ok(ok.body.deviceId);
});

test('pairing stores only a hash of the token', async (t) => {
  const s = await startServer();
  t.after(() => s.close());

  const { body } = await s.pair();
  const row = s.app.db().prepare('SELECT token_hash FROM devices').get();
  assert.ok(row.token_hash);
  assert.notEqual(row.token_hash, body.token);
  // The raw token must not be recoverable from the row.
  assert.ok(!JSON.stringify(row).includes(body.token));
});

test('blast: 401 without a token', async (t) => {
  const s = await startServer();
  t.after(() => s.close());

  assert.equal((await s.req('/blobs')).status, 401);
  assert.equal((await s.req('/blobs', { method: 'POST', body: {} })).status, 401);
  assert.equal((await s.req('/me')).status, 401);
});

test('push then pull round-trips a blob', async (t) => {
  const s = await startServer();
  t.after(() => s.close());
  const { body } = await s.pair();

  const put = await s.req('/blobs', {
    method: 'POST',
    token: body.token,
    body: {
      blob: {
        id: 'blob-1',
        type: 'session',
        baseRevision: 0,
        updatedAt: 1000,
        ciphertext: 'Y2lwaGVy',
        iv: 'aXY=',
      },
    },
  });
  assert.equal(put.status, 200);
  assert.equal(put.body.revision, 1);

  const pull = await s.req('/blobs?since=0', { token: body.token });
  assert.equal(pull.status, 200);
  assert.equal(pull.body.blobs.length, 1);
  assert.equal(pull.body.blobs[0].id, 'blob-1');
  assert.equal(pull.body.blobs[0].ciphertext, 'Y2lwaGVy');
  assert.equal(pull.body.blobs[0].revision, 1);
  assert.equal(pull.body.revision, 1);
});

test('revisions increase and drive the since cursor', async (t) => {
  const s = await startServer();
  t.after(() => s.close());
  const { body } = await s.pair();

  const push = async (id, baseRevision) =>
    s.req('/blobs', {
      method: 'POST',
      token: body.token,
      body: { blob: { id, type: 'session', baseRevision, updatedAt: 1, ciphertext: 'x', iv: 'y' } },
    });

  const a = await push('a', 0);
  const b = await push('b', 0);
  assert.ok(b.body.revision > a.body.revision);

  const after = await s.req(`/blobs?since=${a.body.revision}`, { token: body.token });
  assert.deepEqual(after.body.blobs.map((x) => x.id), ['b']);
});

test('stale write is rejected with 409 and the current revision', async (t) => {
  const s = await startServer();
  t.after(() => s.close());
  const { body } = await s.pair();
  const token = body.token;
  const push = (baseRevision) =>
    s.req('/blobs', {
      method: 'POST',
      token,
      body: {
        blob: { id: 'x', type: 'session', baseRevision, updatedAt: 1, ciphertext: 'c', iv: 'i' },
      },
    });

  const first = await push(0);
  assert.equal(first.status, 200);

  // A second device that still thinks the blob is new (baseRevision 0).
  const stale = await push(0);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.revision, first.body.revision);

  // With the correct base revision it succeeds and the revision advances.
  const fresh = await push(first.body.revision);
  assert.equal(fresh.status, 200);
  assert.ok(fresh.body.revision > first.body.revision);
});

test('a non-zero baseRevision for an unknown blob is rejected', async (t) => {
  const s = await startServer();
  t.after(() => s.close());
  const { body } = await s.pair();

  const r = await s.req('/blobs', {
    method: 'POST',
    token: body.token,
    body: { blob: { id: 'ghost', baseRevision: 5, ciphertext: 'c', iv: 'i' } },
  });
  assert.equal(r.status, 409);
});

test('delete is a tombstone that still syncs', async (t) => {
  const s = await startServer();
  t.after(() => s.close());
  const { body } = await s.pair();
  const token = body.token;

  await s.req('/blobs', {
    method: 'POST',
    token,
    body: { blob: { id: 'gone', baseRevision: 0, updatedAt: 1, ciphertext: 'c', iv: 'i' } },
  });
  const rev = (await s.req('/blobs?since=0', { token })).body.revision;

  const del = await s.req('/blobs/gone', { method: 'DELETE', token });
  assert.equal(del.status, 200);
  assert.equal(del.body.deleted, true);

  const pull = await s.req(`/blobs?since=${rev}`, { token });
  assert.equal(pull.body.blobs.length, 1);
  assert.equal(pull.body.blobs[0].deleted, true);
});

test('deleting a missing blob is a 404', async (t) => {
  const s = await startServer();
  t.after(() => s.close());
  const { body } = await s.pair();

  const r = await s.req('/blobs/nope', { method: 'DELETE', token: body.token });
  assert.equal(r.status, 404);
});

test('validation rejects malformed pushes', async (t) => {
  const s = await startServer();
  t.after(() => s.close());
  const { body } = await s.pair();

  const noBlob = await s.req('/blobs', { method: 'POST', token: body.token, body: {} });
  assert.equal(noBlob.status, 400);

  const noCipher = await s.req('/blobs', {
    method: 'POST',
    token: body.token,
    body: { blob: { id: 'x' } },
  });
  assert.equal(noCipher.status, 400);

  const badJson = await fetch(`${s.base}/blobs`, {
    method: 'POST',
    headers: { authorization: `Bearer ${body.token}`, 'content-type': 'application/json' },
    body: '{not json',
  });
  assert.equal(badJson.status, 400);
});

test('unknown routes are 404 and CORS preflight is allowed', async (t) => {
  const s = await startServer();
  t.after(() => s.close());
  const { body } = await s.pair();

  assert.equal((await s.req('/nope', { token: body.token })).status, 404);

  const preflight = await fetch(`${s.base}/blobs`, { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
});

test('rate-limits pairing per IP', async (t) => {
  const s = await startServer(':memory:', { pairLimit: 3 });
  t.after(() => s.close());

  let sawRateLimit = false;
  for (let i = 0; i < 10; i++) {
    const r = await s.pair('spam', 'wrong');
    if (r.status === 429) {
      sawRateLimit = true;
      break;
    }
  }
  assert.ok(sawRateLimit, 'expected a 429 after repeated failures');
});

test('data survives a restart (file-backed database)', async (t) => {
  const dir = await import('node:fs').then((fs) =>
    fs.mkdtempSync('/tmp/windrow-server-test-'),
  );
  const dbPath = `${dir}/sync.db`;

  const first = await startServer(dbPath);
  const { body } = await first.pair('laptop');
  await first.req('/blobs', {
    method: 'POST',
    token: body.token,
    body: { blob: { id: 'persisted', baseRevision: 0, updatedAt: 1, ciphertext: 'c', iv: 'i' } },
  });
  await first.close();

  const second = await startServer(dbPath);
  t.after(async () => {
    await second.close();
    await import('node:fs').then((fs) => fs.rmSync(dir, { recursive: true, force: true }));
  });

  // The device token still works after a restart.
  const me = await second.req('/me', { token: body.token });
  assert.equal(me.status, 200);

  const pull = await second.req('/blobs?since=0', { token: body.token });
  assert.equal(pull.body.blobs.length, 1);
  assert.equal(pull.body.blobs[0].id, 'persisted');
});
