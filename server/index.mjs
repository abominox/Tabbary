/**
 * Windrow sync server.
 *
 * Holds ciphertext only. It authenticates *devices* against one operator-set
 * pairing secret; it has no accounts, no user records, and no way to decrypt a
 * blob. Delete this database and the data is gone — the client keeps its own
 * copy, which is the point.
 *
 * Run:  WINDROW_PAIRING_SECRET=... node server/index.mjs
 */

import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const VERSION = '0.1.0';

// ── Configuration ────────────────────────────────────────

const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath: process.env.WINDROW_DB ?? './data/windrow.db',
  // Operator sets this once at deploy time. Required: a server that accepts
  // any pairing key would let the first visitor own the instance.
  pairingSecret: process.env.WINDROW_PAIRING_SECRET ?? '',
  // Requests per IP per minute for /auth/pair.
  pairLimit: Number(process.env.WINDROW_PAIR_LIMIT ?? 5),
  // Optional: reject oversized pushes instead of filling the disk.
  maxBlobBytes: Number(process.env.WINDROW_MAX_BLOB_BYTES ?? 5_000_000),
  maxBodyBytes: Number(process.env.WINDROW_MAX_BODY_BYTES ?? 25_000_000),
};

if (config.pairingSecret.length < 16) {
  console.error(
    'WINDROW_PAIRING_SECRET must be set to at least 16 characters.\n' +
      'Generate one with:  openssl rand -base64 32',
  );
  process.exit(1);
}

// ── Database ─────────────────────────────────────────────

function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const handle = new DatabaseSync(path);

  handle.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      last_seen INTEGER
    );

    CREATE TABLE IF NOT EXISTS blobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      -- Server-side monotonic revision. Clients use it as a pull cursor, so it
      -- can never collide the way a per-device counter would.
      revision INTEGER NOT NULL,
      -- Client-supplied timestamp, bound into the ciphertext AAD.
      updated_at INTEGER NOT NULL,
      ciphertext TEXT NOT NULL,
      iv TEXT NOT NULL,
      device_id TEXT,
      deleted INTEGER NOT NULL DEFAULT 0,
      CHECK (deleted IN (0, 1))
    );

    CREATE INDEX IF NOT EXISTS blobs_revision ON blobs(revision);
    CREATE INDEX IF NOT EXISTS blobs_type ON blobs(type);

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return handle;
}

function getRevision(db) {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'revision'`).get();
  return row ? Number(row.value) : 0;
}

function nextRevision(db) {
  const row = db
    .prepare(
      `INSERT INTO meta (key, value) VALUES ('revision', '1')
       ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1
       RETURNING value`,
    )
    .get();
  return Number(row.value);
}

// ── Utilities ────────────────────────────────────────────

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

function json(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

function readBody(req, limit) {
  return new Promise((resolveBody, rejectBody) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        rejectBody(Object.assign(new Error('Body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rejectBody);
  });
}

async function readJson(req, limit) {
  const raw = await readBody(req, limit);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('Body must be JSON'), { status: 400 });
  }
}

/** Bearer token → device row, or null. */
function authenticate(db, req) {
  const header = req.headers.authorization ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  const hash = hashToken(match[1].trim());
  const row = db.prepare(`SELECT * FROM devices WHERE token_hash = ?`).get(hash);
  if (!row) return null;
  db.prepare(`UPDATE devices SET last_seen = ? WHERE id = ?`).run(Date.now(), row.id);
  return row;
}

// ── Pairing rate limit (in-memory; resets on restart) ────

const pairAttempts = new Map();

function pairAllowed(ip, limit) {
  const now = Date.now();
  const windowStart = Math.floor(now / 60_000);
  const key = `${ip}:${windowStart}`;
  const count = (pairAttempts.get(key) ?? 0) + 1;
  pairAttempts.set(key, count);

  // Opportunistic cleanup so the map cannot grow without bound.
  if (pairAttempts.size > 1000) {
    for (const k of pairAttempts.keys()) {
      if (!k.endsWith(`:${windowStart}`)) pairAttempts.delete(k);
    }
  }

  return count <= limit;
}

function clientIp(req) {
  // Trust the proxy header only if the operator runs behind one; harmless
  // otherwise since it only affects a per-IP rate limit.
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function secretMatches(candidate) {
  const a = Buffer.from(hashToken(String(candidate)));
  const b = Buffer.from(hashToken(config.pairingSecret));
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Routes ───────────────────────────────────────────────

async function handle(db, cfg, req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'access-control-max-age': '86400',
    });
    return res.end();
  }

  res.setHeader('access-control-allow-origin', '*');

  // ── Public ──
  if (path === '/health' && req.method === 'GET') {
    return json(res, 200, {
      ok: true,
      service: 'windrow-sync',
      version: VERSION,
      blobs: db.prepare(`SELECT COUNT(*) AS n FROM blobs WHERE deleted = 0`).get().n,
    });
  }

  if (path === '/auth/pair' && req.method === 'POST') {
    const ip = clientIp(req);
    if (!pairAllowed(ip, cfg.pairLimit)) {
      return json(res, 429, { error: 'Too many pairing attempts; try again shortly' });
    }

    const body = await readJson(req, 10_000);
    if (!secretMatches(body.pairingSecret)) {
      return json(res, 401, { error: 'Invalid pairing secret' });
    }

    const name = String(body.deviceName ?? 'Unnamed device').slice(0, 100);
    const id = randomBytes(8).toString('hex');
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();

    db.prepare(
      `INSERT INTO devices (id, name, token_hash, created_at, last_seen)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(id, name, hashToken(token), now, now);

    return json(res, 200, { deviceId: id, token, serverVersion: VERSION });
  }

  // ── Authenticated ──
  const device = authenticate(db, req);
  if (!device) {
    return json(res, 401, { error: 'Missing or invalid device token' });
  }

  if (path === '/me' && req.method === 'GET') {
    return json(res, 200, {
      deviceId: device.id,
      name: device.name,
      serverVersion: VERSION,
      revision: getRevision(db),
    });
  }

  if (path === '/blobs' && req.method === 'GET') {
    const since = Number(url.searchParams.get('since') ?? '0');
    if (!Number.isFinite(since) || since < 0) {
      return json(res, 400, { error: 'since must be a non-negative number' });
    }

    const rows = db
      .prepare(
        `SELECT id, type, revision, updated_at, ciphertext, iv, device_id, deleted
         FROM blobs WHERE revision > ? ORDER BY revision ASC LIMIT 500`,
      )
      .all(since);

    return json(res, 200, {
      blobs: rows.map((r) => ({
        id: r.id,
        type: r.type,
        revision: r.revision,
        updatedAt: r.updated_at,
        ciphertext: r.ciphertext,
        iv: r.iv,
        deviceId: r.device_id,
        deleted: r.deleted === 1,
      })),
      revision: getRevision(db),
      hasMore: rows.length === 500,
    });
  }

  if (path === '/blobs' && req.method === 'POST') {
    const body = await readJson(req, cfg.maxBodyBytes);
    const blob = body?.blob;
    if (!blob || typeof blob.id !== 'string' || typeof blob.ciphertext !== 'string') {
      return json(res, 400, { error: 'Expected { blob: { id, ciphertext, ... } }' });
    }

    // Compare-and-swap. 0 means "I have never seen this blob" and is only
    // valid for a first insert; anything else must match the server's current
    // revision, which prevents an offline device from silently overwriting a
    // newer copy.
    const baseRevision = Number(blob.baseRevision ?? 0);
    if (!Number.isFinite(baseRevision) || baseRevision < 0) {
      return json(res, 400, { error: 'baseRevision must be a non-negative number' });
    }

    if (Buffer.byteLength(blob.ciphertext) > cfg.maxBlobBytes) {
      return json(res, 413, { error: 'Blob too large' });
    }

    const existing = db.prepare(`SELECT revision FROM blobs WHERE id = ?`).get(blob.id);

    if (existing && existing.revision !== baseRevision) {
      return json(res, 409, {
        error: 'Stale write',
        id: blob.id,
        revision: existing.revision,
      });
    }
    if (!existing && baseRevision !== 0) {
      return json(res, 409, { error: 'Unknown blob with non-zero baseRevision', id: blob.id });
    }

    const revision = nextRevision(db);
    const updatedAt = Number(blob.updatedAt ?? Date.now());

    db.prepare(
      `INSERT INTO blobs (id, type, revision, updated_at, ciphertext, iv, device_id, deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         type = excluded.type,
         revision = excluded.revision,
         updated_at = excluded.updated_at,
         ciphertext = excluded.ciphertext,
         iv = excluded.iv,
         device_id = excluded.device_id,
         deleted = excluded.deleted`,
    ).run(
      blob.id,
      String(blob.type ?? 'session'),
      revision,
      updatedAt,
      blob.ciphertext,
      String(blob.iv ?? ''),
      device.id,
      blob.deleted ? 1 : 0,
    );

    return json(res, 200, { id: blob.id, revision });
  }

  const blobId = path.startsWith('/blobs/') ? decodeURIComponent(path.slice(7)) : null;
  if (blobId && req.method === 'DELETE') {
    const existing = db.prepare(`SELECT revision FROM blobs WHERE id = ?`).get(blobId);
    if (!existing) return json(res, 404, { error: 'No such blob' });

    const revision = nextRevision(db);
    db.prepare(`UPDATE blobs SET deleted = 1, revision = ?, device_id = ? WHERE id = ?`).run(
      revision,
      device.id,
      blobId,
    );
    return json(res, 200, { id: blobId, revision, deleted: true });
  }

  if (blobId && req.method === 'GET') {
    const row = db.prepare(`SELECT * FROM blobs WHERE id = ?`).get(blobId);
    if (!row) return json(res, 404, { error: 'No such blob' });
    return json(res, 200, {
      id: row.id,
      type: row.type,
      revision: row.revision,
      updatedAt: row.updated_at,
      ciphertext: row.ciphertext,
      iv: row.iv,
      deviceId: row.device_id,
      deleted: row.deleted === 1,
    });
  }

  return json(res, 404, { error: 'Unknown route' });
}

// ── Server ───────────────────────────────────────────────

export function createSyncServer(options = {}) {
  // Instance-scoped overrides. Never mutate the module-level defaults here:
  // two servers in one process would otherwise leak settings into each other.
  const cfg = {
    ...config,
    ...(options.dbPath ? { dbPath: options.dbPath } : {}),
    ...(options.pairLimit != null ? { pairLimit: options.pairLimit } : {}),
  };
  // Per-instance handle: two servers (e.g. two DBs in tests) must not share a
  // connection, or closing one closes the other's database.
  const db = openDatabase(cfg.dbPath);

  const server = createServer((req, res) => {
    handle(db, cfg, req, res).catch((err) => {
      const status = err?.status ?? 500;
      if (status === 500) console.error('[windrow-sync]', err);
      if (!res.headersSent) json(res, status, { error: err?.message ?? 'Internal error' });
      else res.end();
    });
  });

  return {
    server,
    listen(port = 0, host = '127.0.0.1') {
      return new Promise((resolveListen) => {
        server.listen(port, host, () => resolveListen(server.address().port));
      });
    },
    close() {
      return new Promise((resolveClose) => {
        server.close(() => {
          try {
            db.close();
          } catch {
            /* already closed */
          }
          resolveClose();
        });
      });
    },
    db: () => db,
  };
}

// Only start when executed directly, so tests can import createSyncServer.
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const app = createSyncServer();
  app.listen(config.port, config.host).then((port) => {
    console.log(`[windrow-sync] listening on http://${config.host}:${port}`);
    console.log(`[windrow-sync] database: ${config.dbPath}`);
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      console.log(`\n[windrow-sync] ${signal} — shutting down`);
      app.close().then(() => process.exit(0));
    });
  }
}
