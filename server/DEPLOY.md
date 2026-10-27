# Deploying the tabbary sync server

A complete runbook for one VPS. Target: **15 minutes on a fresh Debian 12 or
Ubuntu 24.04 box**, one HTTPS hostname, automatic certificate renewal, backups.

The server holds ciphertext only. If you follow this guide and someone steals the
disk, they get encrypted blobs and hashed device tokens — not anyone's tabs. The
one secret that matters is `TABBARY_PAIRING_SECRET`; anyone who has it can pair a
new device to your instance.

---

## What you need

- A VPS with a public IPv4 address, root or sudo.
- A DNS **A record** for the hostname you will use, e.g. `sync.example.net`,
  pointing at the VPS. Do this first: certificate issuance fails until it resolves.
- Ports 80 and 443 reachable (Caddy needs 80 for the ACME challenge).

Pick a hostname you are willing to keep. Changing it later means every device
must be re-paired, because the extension stores the origin it syncs to.

---

## Choosing a route

Two ways to run the server. Both give the same result; pick one.

- **A — systemd** (steps 1–4 below). No Docker. Best if you want the smallest
  possible footprint, or you already run other services this way.
- **B — Docker** (step 5). Best if you would rather not install Node on the
  host at all, or you want the service isolated from the rest of the box.

Step 5 also covers Docker; steps 1–4 are specific to route A. Either way you
need Caddy (§6) and the firewall (§7).

## 1. Install Node 22 and Caddy

> **Skip Node if you are using Docker** — you only need Caddy from this step.

```bash
# Node 22 — Debian/Ubuntu's own node is too old for node:sqlite.
# Needs 22.13.0 or newer: before that, node:sqlite is behind --experimental-sqlite.
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Caddy — official repo, so you get automatic HTTPS and renewal
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy

node --version   # expect v22.13.0 or newer
```

> `node:sqlite` is built in from Node 22.13. There is nothing to compile and no
> native module to rebuild on upgrade.

## 2. Create a service user and install the server

```bash
sudo useradd --system --home /opt/tabbary --shell /usr/sbin/nologin tabbary
sudo mkdir -p /opt/tabbary/data
sudo chown -R tabbary:tabbary /opt/tabbary

# Copy index.mjs and package.json from the repo (scp, rsync, or git clone)
sudo cp server/index.mjs server/package.json /opt/tabbary/
sudo chown tabbary:tabbary /opt/tabbary/index.mjs /opt/tabbary/package.json
```

The server has **no dependencies**, so there is no `npm install` step.

## 3. Generate the pairing secret

```bash
sudo -u tabbary tee /opt/tabbary/.env >/dev/null <<EOF
TABBARY_PAIRING_SECRET=$(openssl rand -base64 32)
TABBARY_DB=/opt/tabbary/data/tabbary.db
PORT=8787
HOST=127.0.0.1
TABBARY_PAIR_LIMIT=5
EOF

sudo chmod 600 /opt/tabbary/.env
sudo chown tabbary:tabbary /opt/tabbary/.env
```

Two details that matter:

- `HOST=127.0.0.1` binds to loopback only. Caddy is the only thing that talks to
  it, and port 8787 is never exposed to the internet.
- `chmod 600` keeps the secret readable only by the service user. Back this file
  up somewhere safe — re-pairing every device is the only recovery.

Show the secret when you need it for pairing:

```bash
sudo cat /opt/tabbary/.env | grep PAIRING
```

## 4. Run it under systemd

```bash
sudo tee /etc/systemd/system/tabbary-sync.service >/dev/null <<'EOF'
[Unit]
Description=tabbary sync server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=tabbary
Group=tabbary
WorkingDirectory=/opt/tabbary
EnvironmentFile=/opt/tabbary/.env
ExecStart=/usr/bin/node /opt/tabbary/index.mjs
Restart=always
RestartSec=5

# Hardening: the process only needs its own directory.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/tabbary/data
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
LockPersonality=true

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now tabbary-sync
sudo systemctl status tabbary-sync --no-pager
```

Confirm it is alive on loopback:

```bash
curl -s http://127.0.0.1:8787/health
# {"ok":true,"service":"tabbary-sync","version":"0.1.0","blobs":0}
```

If it fails, `journalctl -u tabbary-sync -n 50 --no-pager` will say why. The most
common cause is a pairing secret shorter than 16 characters — the server refuses
to start rather than run unprotected.

## 5. Run it with Docker (route B)

Skip steps 2–4 if you take this route. The image is `node:22-alpine`; the server
has no dependencies, so there is no build step beyond copying two files.

### Build and run

```bash
# From the repository root.
cd server

# The pairing secret, and a fresh one each time you deploy. compose.yaml
# already sets the DB path and rate limit, so only the secret is needed here.
echo "TABBARY_PAIRING_SECRET=$(openssl rand -base64 32)" > .env
# (`.env.example` has the same thing with comments, if you prefer cp + edit.)
chmod 600 .env        # .env is gitignored; keep it that way

# Build + start, detached.
sudo docker compose up -d --build

sudo docker compose ps
curl -s http://127.0.0.1:8787/health
```

`compose.yaml` binds the port to **127.0.0.1 only**, so Caddy on the host can
reach it while the port stays unreachable from the internet. Do not change that
to `8787:8787` — that would publish the cleartext service on every interface.

Show the secret when pairing devices:

```bash
grep PAIRING .env
```

### Plain docker, without compose

```bash
sudo docker build -t tabbary-sync .
sudo docker run -d --name tabbary-sync \
  --restart unless-stopped \
  -p 127.0.0.1:8787:8787 \
  -e TABBARY_PAIRING_SECRET="$(openssl rand -base64 32)" \
  -v tabbary-data:/data \
  tabbary-sync
```

Note the difference: `docker run` creates a volume named `tabbary-data`, while
compose prefixes it with the project name — from this directory that is
`server_tabbary-data`. Check which one you have before restoring a backup:

```bash
sudo docker volume ls | grep tabbary
```

### Operating it

```bash
sudo docker compose logs -f --tail 50      # follow logs
sudo docker compose restart                # restart
sudo docker compose down                   # stop (the volume survives)
```

To upgrade, from a new checkout:

```bash
cd server
sudo docker compose up -d --build          # rebuilds and recreates the container
```

The database lives in the named volume, so recreating the container does not
touch your data.

### Backups with Docker

The container has no `sqlite3` binary, so run the backup from a throwaway
container against the same volume. Using `sqlite3 .backup` (not `cp`) matters
because WAL mode may have unflushed pages.

```bash
# Adjust the volume name to whatever `docker volume ls` showed.
VOL=server_tabbary-data
sudo mkdir -p /var/backups/tabbary
sudo docker run --rm -v "$VOL":/data -v /var/backups/tabbary:/backup alpine \
  sh -c 'apk add --no-cache sqlite >/dev/null && \
         sqlite3 /data/tabbary.db ".backup /backup/tabbary-$(date +%F).db"'

ls -la /var/backups/tabbary
```

Nightly:

```bash
echo '17 3 * * * root /usr/local/bin/tabbary-backup' | sudo tee /etc/cron.d/tabbary-backup
```

Put the commands above in `/usr/local/bin/tabbary-backup` as a `#!/bin/sh`
script and make it executable.

---

## 6. Put Caddy in front

```bash
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
sync.example.net {
	encode zstd gzip
	reverse_proxy 127.0.0.1:8787
}
EOF

sudo systemctl reload caddy
```

Replace `sync.example.net` with your hostname. Caddy fetches and renews the
certificate automatically; there is no cron job and no manual renew.

Verify from your laptop:

```bash
curl -s https://sync.example.net/health
```

## 7. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

8787 must **not** be open. The bind to `127.0.0.1` already prevents access, and
the firewall is the second layer.

## 8. Pair the extension

1. Open tabbary → **Settings → Sync & backup**.
2. Enter `https://sync.example.net` and the pairing secret.
3. Choose a passphrase. This is separate from the pairing secret and **never
   leaves the device** — it derives the key that encrypts your blobs. The server
   cannot reset it. Lose it and the synced data is unreadable (your local copy
   still works).
4. Repeat on each other device with the same server, secret, and passphrase.

Chrome will ask for permission to reach that one origin. That is the only host
access tabbary ever requests, and it is granted per-origin.

---

## Backups (route A, systemd)

Route B (Docker) has its own backup commands in §5 — the container has no
`sqlite3`, so the invocation differs.

The whole datastore is one SQLite file. A consistent copy needs `.backup`, not
`cp`, because WAL mode may have unflushed pages.

```bash
sudo mkdir -p /var/backups/tabbary
sudo tee /usr/local/bin/tabbary-backup >/dev/null <<'EOF'
#!/bin/sh
set -eu
STAMP=$(date +%F)
# .backup is safe while the server is running.
sqlite3 /opt/tabbary/data/tabbary.db ".backup /var/backups/tabbary/tabbary-$STAMP.db"
# Keep 14 days.
find /var/backups/tabbary -name 'tabbary-*.db' -mtime +14 -delete
EOF
sudo chmod +x /usr/local/bin/tabbary-backup

sudo apt-get install -y sqlite3
sudo /usr/local/bin/tabbary-backup      # prove it works now
```

Schedule it nightly:

```bash
echo '17 3 * * * root /usr/local/bin/tabbary-backup' | sudo tee /etc/cron.d/tabbary-backup
```

Backups are ciphertext, so they are safe to copy off the box — but they are
useless without a device passphrase, by design.

## Upgrading (route A, systemd)

```bash
sudo cp server/index.mjs /opt/tabbary/index.mjs     # from the new checkout
sudo chown tabbary:tabbary /opt/tabbary/index.mjs
sudo systemctl restart tabbary-sync
curl -s https://sync.example.net/health
```

The schema is created with `CREATE TABLE IF NOT EXISTS` at startup. There are no
migration steps between 0.1.x versions.

## Monitoring

`GET /health` is public and cheap; point any uptime checker at it. It returns
`{ ok, service, version, blobs }`, where `blobs` counts live blobs only —
tombstones are excluded.

```bash
# What is actually stored
sqlite3 /opt/tabbary/data/tabbary.db \
  "SELECT COUNT(*) AS devices FROM devices; SELECT COUNT(*) AS blobs FROM blobs;"
```

Useful signals: `blobs` growing without bound (nobody is pruning), or a `devices`
count you do not recognise (someone had the pairing secret).

### Rotating the pairing secret

Rotating it does **not** unpair existing devices — their tokens stay valid. To
cut off a lost device you must remove its row:

```bash
sqlite3 /opt/tabbary/data/tabbary.db "DELETE FROM devices WHERE name = 'old-laptop';"
```

Then change the secret for future pairings:

```bash
sudo -u tabbary sed -i "s|^TABBARY_PAIRING_SECRET=.*|TABBARY_PAIRING_SECRET=$(openssl rand -base64 32)|" /opt/tabbary/.env
sudo systemctl restart tabbary-sync
```

## Troubleshooting

| Symptom | Cause |
|---|---|
| Service exits immediately | `TABBARY_PAIRING_SECRET` missing or under 16 chars. Check `journalctl`. |
| `Cannot find module 'node:sqlite'` / `ERR_UNKNOWN_BUILTIN_MODULE` | Node is older than **22.13.0**. `node:sqlite` sits behind `--experimental-sqlite` before that. Upgrade Node; do not add the flag. |
| Log line: `ExperimentalWarning: SQLite is an experimental feature` | Expected and harmless on Node 22.x/23.x. It is informational, not an error. |
| `curl https://…/health` times out | DNS not pointing at the box, or 80/443 closed. `dig +short your.host`. |
| Certificate error in Chrome | Caddy could not complete ACME. Port 80 must be reachable for the challenge. |
| Extension says it cannot reach the server | The origin must be `https://`, not `http://` (except `localhost`). Check the exact hostname, including any port. |
| `401` after pairing | Device token was deleted from the database. Re-pair. |
| `409` in logs | Normal. Two devices wrote the same blob; the client re-pulls and reconciles. |

## Cost and scale

One small VPS (1 vCPU, 1 GB) is far more than one person needs. The server holds
ciphertext and does no computation beyond hashing a token and comparing a secret.
A few hundred megabytes of disk covers years of sessions.
