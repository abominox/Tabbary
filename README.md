# Windrow

**Rows of tabs, quietly kept.** A local-first tab and session manager for Chrome (MV3).

Windrow treats a browser window as a *session*: it is captured automatically as you browse,
survives crashes and restarts, and can be restored later with its tab groups intact.
Everything lives in your own browser profile. There is no account, no telemetry, and no
paid tier.

> **Status: early (M2 of 6).** The service worker, data layer, side panel, full-tab
> manager, drag-and-drop, revision history, and settings are working. The popup, dedicated
> window, import/export, and sync are not implemented yet. See [Roadmap](#roadmap).

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
| `src/sw/` | MV3 service worker: event router, debounced auto-save, window↔session binding |
| `src/db/` | Dexie/IndexedDB schema and repositories (sessions, tabs, groups, tags, bookmarks, versions) |
| `src/ui/` | React app; one bundle mounted as side panel, full tab, popup, window, options, onboarding |
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
| M3 | Popup, dedicated window, restore matching, duplicate merge UI, tags UI | ⬜ next |
| M4 | Self-hosted sync server + client-side encryption, recovery key | ⬜ |
| M5 | Encrypted export/import, OneTab/generic importers, bookmark types | ⬜ |
| M6 | Tab suspender polish, onboarding, themes, store release | ⬜ |

Known gaps: the popup and dedicated-window surfaces are placeholders; there is no
import/export yet; `src/sync/` throws `not implemented`; the settings page exposes sync
fields that are inert until M4.

## Contributing

Issues and pull requests are welcome once the repository is public. For anything larger
than a bug fix, open an issue describing the behavior first. Run `npm run build` and
`npm test` before opening a PR.

## License

MIT — see [LICENSE](LICENSE).
