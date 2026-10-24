# Windrow

**Rows of tabs, quietly kept.** A local-first tab and session manager for Chrome (MV3).

Windrow treats a browser window as a *session*: it is captured automatically as you browse,
survives crashes and restarts, and can be restored later with its tab groups intact.
Everything lives in your own browser profile. There is no account, no telemetry, and no
paid tier.

> **Status: early (M3).** The service worker, data layer, side panel, full-tab manager,
> drag-and-drop, revision history, settings, import/export, popup, dedicated window, restore
> matching, and tag management are working. Cloud sync and the browser-bookmark UI are not
> implemented yet. See [Roadmap](#roadmap).

## Why

Existing session managers put restoration, history, and cross-device sync behind a
subscription. Windrow's goal is to make the useful parts free and auditable, with
client-side encryption and a sync server you can run yourself.

## Features (working today)

- **Auto-saved sessions** — every window is a session, persisted on tab, group, and window
  events, and marked closed when the window goes away.
- **Tab groups** — Chrome tab groups are captured with the session and restored with it.
- **Full-tab manager** — three panes: tags, session lists, and a detail view with groups,
  tab rows, and per-session tags.
- **Drag and drop** — drag tabs onto another session to move them; merge sessions with
  duplicate detection.
- **Revision history** — per-session snapshots with pruning. Restoring a revision snapshots
  the current state first, so it is reversible.
- **Import / export** — plain JSON (human-readable, no lock-in) or a passphrase-encrypted
  file (PBKDF2-SHA256 600k → AES-GCM-256). Imports Windrow bundles, OneTab exports, and
  plain URL lists; imports are always additive.
- **Popup** — click the toolbar icon for the current window, recent sessions, and search.
- **Dedicated window** — the same manager in a compact two-pane window (Alt+W via the UI).
- **Restore matching** — on startup, windows Chrome reopens are matched back to their recorded
  sessions by URL overlap, so history survives a restart instead of fragmenting.
- **Tags** — real tag management: counts, bulk rename, and bulk delete across sessions.
- **Settings** — startup, capture, theme, density, revision limit, and sync placeholders,
  persisted in IndexedDB.
- **Side panel UI** — live active session, session rows with tab-icon strips, search, tags.
- **Restore on startup** — configurable (`yes` / `no` / `ask`).
- **Native tab discard** — uses `chrome.tabs.discard`, not a URL-rewriting suspender.
- **Least-privilege manifest** — zero host permissions at install; `history`, `bookmarks`
  access is optional and requested only when you turn the feature on.

## Install (development)

```bash
npm install
npm run build
```

Then load `dist/` as an unpacked extension:

1. Open `chrome://extensions` and enable **Developer mode**
2. Choose **Load unpacked**
3. Select the `dist/` directory

Chrome 116 or newer is required.

## Development

```bash
npm run dev        # Vite + CRXJS with HMR; reload the unpacked extension once
npm run build      # type-check + production build → dist/
npm test           # unit tests (Vitest)
npm run test:e2e   # M1 E2E (Playwright)
npm run test:e2e:m2 # M2 E2E (full-tab, DnD, revisions, settings)
npm run test:e2e:m3 # M3 E2E (popup, window, restore matching, tags)
npm run test:e2e:io # import/export E2E (real download + file import)
npm run test:e2e:all
npm run typecheck  # TypeScript only
```

### E2E

The E2E suites launch a persistent Chromium with the built extension and drive the real
message bus. **They run headless by default** using Chromium's new headless shell
(`channel: 'chromium'`), which supports extensions without opening a window. The legacy
headless mode cannot load extensions, so do not remove the channel.

```bash
WINDROW_HEADED=1 npm run test:e2e:m2   # watch it in a real window
```

In a container, use the same headless path (no `xvfb-run` needed):

```bash
docker compose -f docker-compose.e2e.yml run --rm e2e
```

## Architecture

| Path | Responsibility |
|---|---|
| `src/sw/` | MV3 service worker: event router, debounced auto-save, window↔session binding, startup matching |
| `src/db/` | Dexie/IndexedDB schema and repositories (sessions, tabs, groups, tags, bookmarks, versions, import/export) |
| `src/ui/` | React app; one bundle mounted as side panel, full tab, popup, window, options, onboarding, tags |
| `src/messaging/` | Typed service-worker ↔ UI message bus |
| `src/sync/` | Sync connector abstraction (not implemented) |
| `src/lib/` | Favicon, discard, permission helpers |
| `public/` | Icons, locales |

Data never leaves the browser in the current build.

## Permissions

| Permission | Why |
|---|---|
| `tabs` | Read titles/URLs to save sessions and restore them |
| `tabGroups` | Capture and restore Chrome tab groups |
| `storage`, `unlimitedStorage` | Local IndexedDB persistence for session history |
| `sidePanel` | Provide the side-panel surface |
| `alarms`, `idle` | Debounced auto-save and backup scheduling |
| `notifications` | Restore prompts and error notices |
| `offscreen` | Clipboard/export work off the service-worker thread |
| `favicon` | Local favicon rendering for tab rows |

Optional, requested at use: `history`, `bookmarks`, `clipboardWrite`, `downloads`.
No host permissions are requested at install.

## Roadmap

| Milestone | Scope | State |
|---|---|---|
| M1 | Skeleton, service worker, data layer, side panel | ✅ done |
| M2 | Full-tab manager, drag-and-drop, revision history, settings | ✅ done |
| M3 | Popup, dedicated window, restore matching, tags UI | ✅ done |
| M4 | Self-hosted sync server + client-side encryption, recovery key | ⬜ next |
| M5a | Export/import (JSON + encrypted), OneTab and URL-list importers | ✅ done |
| M5b | Browser-bookmark type, session/tag bookmark UI, more importers | ⬜ |
| M6 | Tab suspender polish, onboarding, themes, store release | ⬜ |

Known gaps: cloud sync (`src/sync/` throws `not implemented`) and the settings fields that
configure it are inert until M4; bookmarks exist in the schema but have no UI yet.

### Restore on startup

`yes` (default) works in two passes:

1. **Match** the windows Chrome reopened against recorded sessions by URL overlap
   (`src/lib/restore.ts`, weighted coverage + Jaccard + size closeness, threshold 0.5).
   A match re-binds the existing session, so history survives instead of fragmenting into
   "new" sessions.
2. If nothing matched and no window is open, **restore the most recently closed session**.

`ask` leaves everything alone and shows a prompt in the full-tab manager listing the
candidates and their match confidence. Matching only runs for windows Chrome creates within
20 seconds of startup — outside that window, a new window is treated as new. The decision is
recorded and exposed through `getRestoreReport`.

## Import / export

Settings → **Import & export**.

**Export** produces `windrow-YYYY-MM-DD.json` containing every session with its tab groups,
tabs (title, URL, pinned flag, order), tags, and timestamps. That file is plain, readable
JSON — it is meant to be a backup you can inspect, script against, and keep even if this
project stops being maintained.

**Encrypted export** wraps the same bundle in

```
PBKDF2-SHA256 (600 000 iterations, 16-byte salt) → AES-GCM-256 (12-byte IV)
```

all via WebCrypto on your device. The envelope is self-describing, so a future version can
change the KDF without breaking old files. There is no recovery path: the passphrase is
never stored.

**Import** is additive and never modifies existing sessions. It accepts:

| Format | Notes |
|---|---|
| Windrow JSON | Validated; unknown/newer versions refused |
| Windrow encrypted | Prompts for the passphrase, decrypts locally |
| OneTab export | Both the JSON-array and plain-text forms |
| URL list | One per line; duplicates dropped |

Chrome-internal URLs (`chrome://`, `about:`, `javascript:`, extension pages) are stripped on
export and refused on import, since they cannot be restored elsewhere.

Imported sessions are stored as **closed** with fresh ids and no window binding, so
importing the same file twice creates two copies rather than clobbering live state.

## Contributing

Issues and pull requests are welcome once the repository is public. For anything larger
than a bug fix, open an issue describing the behavior first. Run `npm run build` and
`npm test` before opening a PR.

## License

MIT — see [LICENSE](LICENSE).
