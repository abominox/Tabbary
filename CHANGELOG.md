# Changelog

Notable changes per release. Versions before 0.9 predate this file and are summarised from
the commits.

## 0.9.0 — 2026-10-28

### Import

- **Bookmarks HTML.** Chrome, Edge, Firefox and Safari all export the same Netscape format,
  and tabbary now reads it. Each folder becomes a session; nested folders keep their path
  (`Research / Papers`) so two folders with the same name stay apart. Titles and HTML
  entities are preserved.
- **Bulleted and numbered URL lists import.** Lines like `- https://…` or `1. https://…`
  previously produced nothing, because the parser took the first whitespace token as the URL
  and `-` is not a URL.
- **Markdown links keep their titles.** `[Spec](https://…)` imports as a tab named "Spec".
- **Foreign JSON is explained, not blamed.** A Session Buddy or TabXpert file used to fail
  with "Not a tabbary export (expected format …)", which reads as if the file were broken.
  It now says the JSON is from another app and lists the formats that are supported.

### Fixed

- **Moving a tab between sessions changed its id.** The autosave that followed rebuilt rows
  from Chrome tabs and, because `moveTabs` had cleared `chromeTabId`, minted a new id for the
  moved tab. Any open view holding the old id went stale.
- **Moving one tab reloaded the whole destination window.** The handler rewrote the window
  (reuse one tab, close the rest, recreate them), discarding scroll position and form state
  and churning the identity of tabs that had not moved. It now opens only the tabs that
  moved.
- **The moved tab was never closed in the source window.** The cleanup read `chromeTabId`
  after the move had cleared it, so it always found `null`.

### Added

- `npm run test:e2e:stress` — a load test that opens a window of real tabs, imports a large
  library, then times autosave, render, search and restore. Prints a table, writes
  `stress-results.json`, and exits non-zero when a loose budget is crossed. Measured at 300
  live tabs plus a 1,501-tab library: autosave settles in 815 ms, import of 1,200 tabs takes
  319 ms, the manager renders in 63 ms, search takes 18 ms, and the heap sits at 15.5 MB.
- `server/DEPLOY.md` documents a Docker route alongside systemd, including the volume-name
  difference between `docker run` and compose and a backup recipe that works without a
  `sqlite3` binary in the container.

### Changed

- The website was rewritten and restructured: plain copy in place of aphorisms, a "What's
  missing" section, and real screenshots rather than a drawn diagram.
- The README was rewritten and corrected. It had listed permissions that no longer exist
  (`idle`, `notifications`, `offscreen`, `clipboardWrite`, `downloads`), claimed bookmarks had
  no UI, said data never leaves the browser, and said the repository was not yet public.

## 0.8.0 — 2026-10-27

- Renamed the project to tabbary and styled the wordmark lowercase.
- Exports written before the rename still import: readers accept the old `windrow-export` and
  `windrow-encrypted` tags while writers emit the new ones.
- Site and store pack regenerated under the new name.

## 0.7.0 — 2026-10-24

- Tab groups are rebuilt on restore (`chrome.tabs.group`, then title, colour and collapsed
  state). Previously a session restored as a flat window.
- Local backups: JSON snapshots in extension storage on a rolling daily/weekly/monthly
  scheme, with a settings panel to restore or delete them. Restores are additive.
- Removed unused permissions and wired the settings that were inert.
- Store submission pack: listing copy, permission justifications, privacy policy, five
  screenshots, and a store-readiness E2E suite.
