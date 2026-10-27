# Chrome Web Store submission pack

Everything a reviewer needs, in the order the dashboard asks for it.

**Status:** assets complete. Name clearance recorded in `store/NAME-CLEARANCE.md`. Remaining before submitting: create the developer account,
host the privacy policy at a public URL, and paste the justifications below.

---

## Listing

**Name**
> tabbary — tab manager

**Short description (132 chars max)**
> Save the tabs you are working on as sessions, restore them with tab groups intact. Local-first, no account, MIT licensed.

**Category**
> Productivity → Workflow & Planning

**Language**
> English (United States)

**Detailed description**

> Tabbary is a tab manager that saves the tabs you are working on as sessions, continuously
> and without a save button. Close a window by accident, or crash, and your work is still
> there — with its tab groups.
>
> **Tabs, not windows.** tabbary captures tabs across groups and windows and organises them
> into sessions. Windows are just where the tabs happened to be.
>
> **What you get**
> - Sessions save themselves as you browse; no save button to forget.
> - Tab groups come back with their names and colours.
> - Search every saved tab, session, and bookmark.
> - Four views: popup, side panel, a dedicated window, and a full-tab manager.
> - Tags, bookmarks, and per-session revision history you can restore.
> - Tab suspension that uses Chrome's native discard, with a preview before it acts.
> - Import from OneTab, or export to plain JSON or an encrypted file.
>
> **Private by default**
> - No account. No analytics. No third-party services.
> - Requests no access to the sites you visit.
> - Everything is stored in your own browser profile.
> - Optional sync is end-to-end encrypted and points at a server you choose. Run it
>   yourself with the included server (a step-by-step deploy guide is in `server/DEPLOY.md`),
>   or host it wherever you like. The operator holds ciphertext they cannot read.
>
> **Open source**
> MIT licensed. Every claim above can be checked in the source at
> github.com/abominox/Tabbary.

**Homepage**
> https://abominox.github.io/tabbary/

**Support URL**
> https://github.com/abominox/Tabbary/issues

**Privacy policy URL**
> https://abominox.github.io/tabbary/privacy.html
> (file lives at `site/privacy.html`; deploys with Pages)

---

## Graphics

| Asset | File | Spec |
|---|---|---|
| Extension icon | `public/icons/icon128.png` | 128×128 ✓ |
| Toolbar icons | `public/icons/icon{16,32,48}.png` | ✓ |
| Store icon | `public/icons/icon128.png` | 128×128 ✓ |
| Screenshot 1 | `design/assets/store/01-full-tab.png` | 1280×800 ✓ |
| Screenshot 2 | `design/assets/store/02-side-panel.png` | 1280×800 ✓ |
| Screenshot 3 | `design/assets/store/03-popup.png` | 380×520 ✓ |
| Screenshot 4 | `design/assets/store/04-bookmarks.png` | 1280×800 ✓ |
| Screenshot 5 | `design/assets/store/05-sync.png` | 1280×800 ✓ |
| Small promo tile | `design/assets/promo-440x280.png` | 440×280 ✓ |
| Marquee promo tile | `design/assets/promo-1280x800.png` | 1280×800 ✓ |

Regenerate screenshots with `node design/screenshots.mjs` (headless; seeds a demo
library into a throwaway profile). Regenerate icons with `node design/icons/build.mjs`.

---

## Permission justifications

Paste each into the dashboard's per-permission field.

**`tabs`**
> Core function. A tab manager must read tab titles and URLs to save them as a session and
> reopen them later. Tabbary does not read page content; no host permissions are requested.

**`tabGroups`**
> Sessions must preserve Chrome tab groups. This API is used to read group names and colours
> when saving, and to recreate them on restore.

**`storage`, `unlimitedStorage`**
> Session history and automatic local backups are stored in extension storage. `unlimitedStorage`
> is requested because a long session history with revisions can exceed the default quota.

**`sidePanel`**
> One of the four product surfaces. The side panel shows the current window's tabs beside the
> page, which is the primary way users reach the manager.

**`alarms`**
> Used to schedule autosave coalescing, the twice-daily local backup check, and (only if the
> user enables sync) the polling interval.

**`favicon`**
> Renders each tab's own favicon in the tab list using Chrome's local favicon cache, so the
> list is scannable. No network request is made for this.

**`history`** *(optional)*
> Only requested if the user turns on history-based features. Not requested at install.

**`bookmarks`** *(optional)*
> Only requested when the user presses “Import from Chrome”. Tabbary imports the bookmark
> tree into its own store and never writes back to Chrome's bookmarks.

**Host permissions** *(optional)*
> None requested at install. When the user configures sync, the extension requests only the
> single origin they typed, so it can reach their sync server.

---

## Single purpose statement

> tabbary saves the tabs in a browser window as a session and restores them later with their
> tab groups intact.

---

## Reviewer notes

Paste into “Notes for the reviewer”.

> **What to test**
> 1. Install, then open a few tabs and close the window. The session appears under “Sessions”
>    in the manager (toolbar icon → Open manager).
> 2. Press “Restore” on that session: the tabs reopen.
> 3. Settings → Import & export → Export JSON produces a file; importing it adds sessions.
> 4. Settings → Sync & backup is **off by default** and requires a server the user runs or
>    controls; the repository ships a dependency-free reference server and a deploy guide
>    (`server/`, `server/DEPLOY.md`). No hosted instance is operated by this project. Sync is
>    not needed to evaluate any other feature.
>
> **Permissions**
> No host permissions are requested at install. `history` and `bookmarks` are optional and
> only requested when the corresponding feature is used.
>
> **Data**
> No account, no analytics, no remote code. With sync disabled the extension makes no
> network requests at all. This can be verified in DevTools → Network.
>
> **Source**
> MIT, public: https://github.com/abominox/Tabbary — the store build is `npm ci && npm run build`.

---

## Pre-submission checklist

- [x] Manifest V3
- [x] Name, description, category, language
- [x] Icons at 16/32/48/128
- [x] Five screenshots at the required sizes
- [x] Small and marquee promo tiles
- [x] Privacy policy written (`site/privacy.html`)
- [x] Permission justifications written
- [x] Single purpose statement
- [x] Reviewer notes
- [x] No remote code, no eval, no analytics
- [x] Privacy policy reachable at a public URL — verified 27 Oct 2026:
      https://abominox.github.io/tabbary/privacy.html (HTTP 200)
- [ ] Chrome Web Store developer account ($5 one-time) and payout/tax details
- [ ] Trademark check on the name before publishing — mechanical checks done, all clear
      (`store/NAME-CLEARANCE.md`); USPTO/EUIPO database search still to do by hand, as both
      block automated access
- [x] Sync hosting described accurately (user-run server; no hosted instance operated by the project)
