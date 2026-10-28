# tabbary

A tab manager for Chrome (MV3). It saves the tabs in each window as a session while you
browse, then reopens them with their tab groups. Everything stays in your browser profile.
There is no account and no paid tier. It does not collect telemetry.

> **Status: 0.9.** Capture, restore, revision history, the four surfaces, tags, bookmarks,
> import/export, suspension and optional self-hosted sync are implemented and tested.
> Publishing still needs a Chrome Web Store developer account, then review. See
> [Roadmap](#roadmap).

## What it does

Sessions save themselves. Chrome fires tab and group events, tabbary waits for the burst to
settle, then writes that window's tabs and groups to IndexedDB. There is no save button, and
an accidentally closed window or a crashed browser leaves the session on disk.

Restoring recreates each group with `chrome.tabs.group`, then reapplies its name, colour and
collapsed state. On startup, the tabs Chrome reopens are matched back to their recorded
session by URL overlap, so history survives a restart instead of splitting into new sessions.

The toolbar popup, the side panel, the full-tab manager and the compact dedicated window all
read the same database.

The rest:

- Tab groups keep their names and colours through a restore.
- Drag a tab onto another session to move it. Merge two sessions with duplicate detection.
- Per-session revision history, pruned to a configurable limit. Restoring an old revision
  snapshots the current one first, so the restore is undoable.
- Tags with counts, bulk rename and bulk delete.
- Bookmarks scoped to a session, a tag, or a browser import. A folder can be opened as a
  session.
- Suspension uses `chrome.tabs.discard` instead of rewriting URLs.
- Export to plain JSON, or an encrypted file with a passphrase. Imports are additive.

## Install

Chrome 116 or newer.

```bash
npm ci
npm run build
```

Then load the built extension:

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Choose **Load unpacked**.
3. Select the `dist/` directory.

## Development

```bash
npm run dev            # Vite + CRXJS with HMR; reload the unpacked extension once
npm run build          # type-check + production build → dist/
npm test               # unit tests (Vitest)
npm run test:server    # sync server tests (node --test, no deps)
npm run typecheck      # TypeScript only
```

End-to-end suites drive the built extension in Chromium:

```bash
npm run test:e2e       # M1: skeleton, autosave, restore on restart
npm run test:e2e:m2    # M2: full-tab, DnD, revisions, settings
npm run test:e2e:m3    # M3: popup, window, restore matching, tags
npm run test:e2e:io    # import/export, including a real file download
npm run test:e2e:sync  # two profiles syncing through a real server
npm run test:e2e:store # store readiness: manifest, icons, every surface
npm run test:e2e:stress # load test, see Performance
npm run test:e2e:all   # everything above except stress
```

### E2E

The suites launch a persistent Chromium with the built extension loaded and drive the real
message bus. They run **headless by default**, using Chromium's new headless shell
(`channel: 'chromium'`), which supports extensions without opening a window. The older
headless mode cannot load them, so leave the channel in place.

```bash
TABBARY_HEADED=1 npm run test:e2e:m2   # watch it in a real window
```

The same path works in a container, with no `xvfb`:

```bash
docker compose -f docker-compose.e2e.yml run --rm e2e
```

## Performance

`npm run test:e2e:stress` opens a window full of real tabs, imports a large library, then
times the operations people notice. It prints a table and writes `stress-results.json`, then
exits non-zero if anything crosses a deliberately loose budget, so a regression shows up in a
diff.

Measured in the Playwright Linux container (`docker run --rm tabbary-e2e npm run
test:e2e:stress`), with 300 live tabs plus a 1,501-tab library across 61 sessions:

| Operation | Time |
|---|---|
| Autosave settles after the 300th tab | 815 ms |
| Import 1,200 tabs in one bundle | 319 ms |
| Manager first render (61 sessions, 1,501 tabs) | 63 ms |
| Search across the whole library | 18 ms |
| Restore a 20-tab session | 632 ms |
| Manager JS heap | 15.5 MB |

These are one machine's numbers. Run it on your own hardware, with `TABBARY_TABS=500` for a
heavier window. macOS opens tabs roughly seven times slower than the
container does, which is a property of `chrome.tabs.create`, not of tabbary.

## Architecture

| Path | Responsibility |
|---|---|
| `src/sw/` | MV3 service worker: event router, debounced auto-save, window↔session binding, startup matching |
| `src/db/` | Dexie/IndexedDB schema and repositories (sessions, tabs, groups, tags, bookmarks, versions, import/export) |
| `src/ui/` | React app; one bundle mounted as side panel, full tab, popup, window, options, onboarding, tags |
| `src/messaging/` | Typed service-worker ↔ UI message bus |
| `src/sync/` | Sync engine: crypto, connector, state, scheduler |
| `server/` | Self-hosted ciphertext-only sync server (Node 22.13+, no deps) |
| `src/lib/` | Favicon, discard, permissions, restore matching, bundle parsing |
| `public/` | Icons, locales |

## Permissions

| Permission | Why |
|---|---|
| `tabs` | Read titles and URLs to save and restore sessions |
| `tabGroups` | Capture and restore Chrome tab groups |
| `storage`, `unlimitedStorage` | IndexedDB persistence for session history |
| `sidePanel` | Provide the side panel |
| `alarms` | Debounced auto-save, backup scheduling, sync polling |
| `favicon` | Local favicon rendering in tab rows |

Optional, requested only when you use the feature: `history`, `bookmarks`.

No host permissions are requested at install. Network access stays off until you enable sync
and configure a server, and sync uploads ciphertext only.

## Roadmap

| Milestone | Scope | State |
|---|---|---|
| M1 | Skeleton, service worker, data layer, side panel | done |
| M2 | Full-tab manager, drag-and-drop, revision history, settings | done |
| M3 | Popup, dedicated window, restore matching, tags UI | done |
| M4 | Self-hosted sync server, client-side encryption, recovery key | done |
| M5a | Export/import (JSON + encrypted), OneTab and URL-list importers | done |
| M5b | Bookmark scopes and UI, bookmarks HTML import | done |
| M6 | Suspension, onboarding, themes, store packaging | code done, listing pending |

Known gaps: one window is one session, so there is no single-window mode. Sync covers
sessions only; tags are stored inside each session blob, so there is no bookmark sync and no
Web Push (the client polls). The optional `history` permission can be granted but no feature
reads it yet.

### Restore on startup

`yes` (the default) works in two passes:

1. **Match** the tabs Chrome reopened against recorded sessions by URL overlap
   (`src/lib/restore.ts`, weighted coverage plus Jaccard plus size closeness, threshold 0.5).
   A match re-binds the existing session, so history survives instead of fragmenting into
   new sessions.
2. If nothing matched and no tabs are open, restore the most recently closed session.

`ask` leaves everything alone and shows a prompt in the full-tab manager listing the
candidates and their confidence. Matching only runs within 20 seconds of startup; after that
a newly opened window is treated as new. The decision is exposed through `getRestoreReport`.

## Sync (optional)

Sync is off by default. It runs against a small server you run yourself: your own VPS, a
homelab box, or localhost. This project operates no hosted instance, and there is no account
either way. `server/DEPLOY.md` is a full deployment runbook.

### What the server can and cannot see

| Stored on the server | Never sent to the server |
|---|---|
| Blob ids, type, revision | Tab URLs and titles |
| AES-GCM ciphertext and IV | Session names and tags |
| SHA-256 hashes of device tokens | The data key and the passphrase |
| Timestamps | The recovery phrase |

### Key model

Setup creates a random 32-byte data key and stores two wrapped copies:

```
passphrase     --PBKDF2-SHA256 (600k)-->  AES-GCM(data key)
24-word phrase --HKDF-SHA256----------->  AES-GCM(data key)
```

Session blobs are encrypted with the data key. Both wrapped copies are stored locally and
uploaded, so
a second device can unlock the same key with the passphrase. The recovery phrase is shown
once at setup and never stored.

### Conflict handling

Each session is one blob, and every write states the revision it was based on:

- If another device wrote first, the server returns `409`. The client stores the server's
  revision and reconciles on the next pull.
- A remote copy is applied only if it is newer than the local one, and never over a session
  that is live in a window (`protectLocal`).

### Running the server

```bash
export TABBARY_PAIRING_SECRET="$(openssl rand -base64 32)"
node server/index.mjs
# or, in the container:
cd server && cp .env.example .env && docker compose up -d --build
```

Point the extension at any instance you control. The server holds ciphertext only, so the
machine it runs on never sees your tabs. See [server/README.md](server/README.md) for the API
and [server/DEPLOY.md](server/DEPLOY.md) for systemd, TLS, backups and monitoring.

## Import / export

Settings → **Import & export**.

**Export** writes every session with its tab groups, tabs (title, URL, pinned flag, order),
tags and timestamps. Plain export is `tabbary-YYYY-MM-DD.json`: readable, diffable, and
usable as a backup even if this project stops being maintained.

**Encrypted export** is `tabbary-YYYY-MM-DD.tabbary`, wrapping the same bundle in

```
PBKDF2-SHA256 (600,000 iterations, 16-byte salt) → AES-GCM-256 (12-byte IV)
```

all through WebCrypto on your device. The envelope is self-describing, so a future version
can change the KDF without breaking old files. There is no recovery path: the passphrase is
never stored.

**Import** is additive and never modifies an existing session. It accepts:

| Format | Notes |
|---|---|
| tabbary JSON | Validated; files from a newer version are refused |
| tabbary encrypted | Prompts for the passphrase, decrypts locally |
| OneTab export | Both the JSON-array and plain-text forms |
| Bookmarks HTML | Chrome, Edge, Firefox or Safari export. Each folder becomes a session; nested folders keep their path, e.g. `Research / Papers` |
| URL list | One per line, bullets and numbering allowed, duplicates dropped |

Chrome-internal URLs (`chrome://`, `about:`, `javascript:`, extension pages) are stripped on
export and refused on import, since they cannot be restored elsewhere.

Imported sessions are stored as **closed**, with fresh ids and no window binding, so
importing the same file twice creates two copies instead of clobbering live state.

## Contributing

Issues and pull requests are welcome. For anything larger than a bug fix, open an issue
describing the behavior first. Run `npm run build`, `npm test` and `npm run test:e2e:all`
before opening a PR.

## License

MIT, see [LICENSE](LICENSE).
