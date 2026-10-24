# Windrow sync server

A small, ciphertext-only store for **Windrow** session sync. It has no accounts,
no user records, and no ability to read what it stores.

- **Server stores:** blob ids, type, a monotonic revision, ciphertext, IV,
  device-token *hashes*, and timestamps.
- **Server never sees:** tab URLs, titles, session names, tags, or the data key.
- **Dependencies:** none beyond Node 22 (`node:sqlite` is built in).

## Quick start

```bash
# 1. Generate the pairing secret (this is what devices present once)
export WINDROW_PAIRING_SECRET="$(openssl rand -base64 32)"

# 2. Run it
node index.mjs
# → [windrow-sync] listening on http://0.0.0.0:8787
```

Or with Docker:

```bash
docker build -t windrow-sync .
docker run -d --name windrow-sync -p 8787:8787 \
  -e WINDROW_PAIRING_SECRET="$WINDROW_PAIRING_SECRET" \
  -v windrow-data:/data \
  windrow-sync
```

Then in Windrow: **Settings → Sync & backup → Set up a new server**.

> The pairing secret is required. A server with no secret would let the first
> visitor own the instance, so startup refuses to continue without one.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `WINDROW_PAIRING_SECRET` | — (**required**) | Secret devices present to pair. Store only as an env var. |
| `PORT` | `8787` | Listen port. |
| `HOST` | `0.0.0.0` | Listen address. |
| `WINDROW_DB` | `./data/windrow.db` | SQLite file. Use a mounted volume in Docker. |
| `WINDROW_PAIR_LIMIT` | `5` | Pairing attempts per IP per minute. |
| `WINDROW_MAX_BLOB_BYTES` | `5000000` | Reject larger individual blobs. |
| `WINDROW_MAX_BODY_BYTES` | `25000000` | Reject larger request bodies. |

## API

All authenticated routes take `Authorization: Bearer <device token>`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness + blob count. Public. |
| `POST` | `/auth/pair` | `{ pairingSecret, deviceName }` → `{ deviceId, token }`. Rate-limited. |
| `GET` | `/me` | Device identity + current revision. |
| `GET` | `/blobs?since=N` | Blobs changed after revision `N` (max 500, `hasMore`). |
| `POST` | `/blobs` | `{ blob: { id, type, baseRevision, updatedAt, ciphertext, iv, deleted } }`. |
| `GET` | `/blobs/:id` | One blob. |
| `DELETE` | `/blobs/:id` | Tombstone (still syncs). |

### Why `baseRevision`

Each blob carries a server-assigned `revision`. Writes must state the revision
they are based on:

- `baseRevision: 0` means "this blob is new to me" and is only accepted if the
  server has never seen it.
- Any other value must match the current revision, or the write gets `409`.

That is what stops an offline device from silently overwriting newer data. On
`409` the client records the winning revision and reconciles on the next pull.

### Revisions, not timestamps, drive the cursor

`GET /blobs?since=` uses the server's own counter. Client clocks are only used
as the timestamp *inside* the encrypted payload (and as AAD, so it cannot be
changed in transit).

## Privacy notes

- Device tokens are stored as SHA-256 hashes; a database dump does not let you
  impersonate a device.
- The pairing secret is compared in constant time and never stored.
- Blob ciphertext is AES-GCM with the blob id and timestamp as associated data,
  so the server cannot move a blob to another id or replay an old one.
- Deleting the database deletes all synced data. Clients keep their own copy.

## Backups

The database is a single SQLite file. With the volume mounted:

```bash
docker run --rm -v windrow-data:/data -v "$PWD":/backup alpine \
  sh -c 'sqlite3 /data/windrow.db ".backup /backup/windrow-$(date +%F).db"' 
```

Or take a filesystem snapshot while the container is stopped.

## Putting it behind TLS

Any reverse proxy works. Caddy needs three lines:

```caddyfile
sync.example.net {
  reverse_proxy 127.0.0.1:8787
}
```

Do not expose plain HTTP beyond localhost: the traffic is ciphertext, but the
device token is a bearer credential.

## Tests

```bash
node --test server.test.mjs
```

14 tests covering pairing, auth, push/pull, the 409 conflict path, tombstones,
validation, rate limiting, and persistence across a restart.
