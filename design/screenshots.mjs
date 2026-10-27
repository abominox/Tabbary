/**
 * Store screenshots. Headless, 1280x800 (Chrome Web Store requirement).
 *
 * Seeds a realistic library into a throwaway profile, then captures five
 * surfaces. Screenshots must show the real product with real data — no mockups.
 *
 * Run: node design/screenshots.mjs
 */

import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const OUT = path.resolve('design/assets/store');
fs.mkdirSync(OUT, { recursive: true });
const EXT = path.resolve('dist');
const W = 1280;
const H = 800;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabbary-shots-'));

const browser = await chromium.launchPersistentContext(dir, {
  headless: true,
  channel: 'chromium',
  viewport: { width: W, height: H },
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
});

const sw = browser.serviceWorkers()[0] ?? (await browser.waitForEvent('serviceworker'));
const extId = new URL(sw.url()).hostname;

const shot = async (page, name) => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, name), type: 'png' });
  console.log('wrote', name);
};

// ── Seed a believable library ────────────────────────────
const setup = await browser.newPage();
await setup.goto(`chrome-extension://${extId}/index.html`);

await setup.evaluate(async () => {
  const now = Date.now();
  const mk = (id, name, tags, state, hoursAgo) => ({
    id,
    name,
    windowId: null,
    state,
    mode: 'multi-window',
    tags,
    pinnedTabUrls: [],
    createdAt: now - hoursAgo * 3_600_000,
    updatedAt: now - hoursAgo * 3_600_000,
    closedAt: state === 'closed' ? now - hoursAgo * 3_600_000 : null,
    version: 3,
    deleted: false,
  });

  const sessions = [
    mk('demo-1', 'Auth rewrite — OIDC flow', ['dev', 'auth'], 'active', 0.1),
    mk('demo-2', 'Postgres indexing deep dive', ['dev', 'database'], 'active', 26),
    mk('demo-3', 'Design tokens migration', ['design', 'dev'], 'closed', 52),
    mk('demo-4', 'Thesis reading — distributed systems', ['reading', 'research'], 'closed', 120),
    mk('demo-5', 'Kitchen renovation research', ['home'], 'closed', 200),
  ];

  const tab = (sessionId, position, url, title, groupId = null, pinned = false) => ({
    id: `${sessionId}-t${position}`,
    sessionId,
    chromeTabId: null,
    url,
    title,
    groupId,
    pinned,
    position,
    active: false,
    discarded: false,
    createdAt: now,
    updatedAt: now,
    deleted: false,
  });

  const tabs = [
    tab('demo-1', 0, 'https://datatracker.ietf.org/doc/html/rfc6749', 'RFC 6749 — The OAuth 2.0 Authorization Framework', 'demo-1-g1'),
    tab('demo-1', 1, 'https://datatracker.ietf.org/doc/html/rfc7636', 'RFC 7636 — Proof Key for Code Exchange', 'demo-1-g1'),
    tab('demo-1', 2, 'https://openid.net/specs/openid-connect-core-1_0.html', 'OpenID Connect Core 1.0', 'demo-1-g1'),
    tab('demo-1', 3, 'https://github.com/acme/web/pull/482', 'Pull request #482 · move token refresh to server', 'demo-1-g2', true),
    tab('demo-1', 4, 'https://github.com/acme/web/blob/main/auth/session.ts', 'auth/session.ts at main', 'demo-1-g2'),
    tab('demo-1', 5, 'https://web.dev/articles/samesite-cookies-explained', 'SameSite cookies explained', 'demo-1-g3'),
    tab('demo-1', 6, 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie', 'Set-Cookie — HTTP | MDN', 'demo-1-g3'),
    tab('demo-1', 7, 'https://jwt.io/', 'JWT.io — decode and verify', 'demo-1-g3'),

    tab('demo-2', 0, 'https://www.postgresql.org/docs/current/indexes-multicolumn.html', 'Multicolumn indexes — PostgreSQL', 'demo-2-g1'),
    tab('demo-2', 1, 'https://www.postgresql.org/docs/current/sql-explain.html', 'EXPLAIN — PostgreSQL', 'demo-2-g1'),
    tab('demo-2', 2, 'https://use-the-index-luke.com/', 'Use The Index, Luke', 'demo-2-g2'),
    tab('demo-2', 3, 'https://explain.dalibo.com/', 'explain.dalibo.com', 'demo-2-g2'),

    tab('demo-3', 0, 'https://www.w3.org/WAI/WCAG22/quickref/', 'WCAG 2.2 Quick Reference', 'demo-3-g1'),
    tab('demo-3', 1, 'https://amzn.github.io/style-dictionary/', 'Style Dictionary', 'demo-3-g1'),

    tab('demo-4', 0, 'https://raft.github.io/raft.pdf', 'In Search of an Understandable Consensus Algorithm'),
    tab('demo-4', 1, 'https://jepsen.io/analyses', 'Jepsen: analyses'),

    tab('demo-5', 0, 'https://www.ikea.com/gb/en/cat/kitchen-cabinets-ka004/', 'Kitchen cabinets — IKEA'),
  ];

  const groups = [
    { id: 'demo-1-g1', sessionId: 'demo-1', title: 'Specs', color: 'blue', position: 0 },
    { id: 'demo-1-g2', sessionId: 'demo-1', title: 'Code', color: 'orange', position: 1 },
    { id: 'demo-1-g3', sessionId: 'demo-1', title: 'Reference', color: 'purple', position: 2 },
    { id: 'demo-2-g1', sessionId: 'demo-2', title: 'Postgres docs', color: 'green', position: 0 },
    { id: 'demo-2-g2', sessionId: 'demo-2', title: 'Tools', color: 'cyan', position: 1 },
    { id: 'demo-3-g1', sessionId: 'demo-3', title: 'References', color: 'pink', position: 0 },
  ].map((g) => ({
    ...g,
    chromeGroupId: null,
    collapsed: false,
    createdAt: now,
    updatedAt: now,
    deleted: false,
  }));

  await chrome.runtime.sendMessage({ type: 'importData', text: JSON.stringify({
    format: 'tabbary-export', version: 1, exportedAt: now, generator: 'demo',
    counts: { sessions: sessions.length, tabs: tabs.length, groups: groups.length },
    sessions: sessions.map((s) => ({
      id: s.id, name: s.name, state: 'closed', tags: s.tags,
      createdAt: s.createdAt, updatedAt: s.updatedAt, closedAt: s.closedAt,
      groups: groups.filter((g) => g.sessionId === s.id).map((g) => ({
        id: g.id, title: g.title, color: g.color, collapsed: false, position: g.position,
      })),
      tabs: tabs.filter((t) => t.sessionId === s.id).map((t) => ({
        url: t.url, title: t.title, pinned: t.pinned, position: t.position, groupId: t.groupId,
      })),
    })),
  })});

  // Bookmark the session, so the bookmarks screenshot has content.
  await chrome.runtime.sendMessage({
    type: 'bookmarkAdd', scope: 'session', ownerId: 'demo-1',
    title: 'OAuth 2.0 core spec', url: 'https://datatracker.ietf.org/doc/html/rfc6749',
  });
  await chrome.runtime.sendMessage({
    type: 'bookmarkAdd', scope: 'session', ownerId: 'demo-1',
    title: 'PKCE', url: 'https://datatracker.ietf.org/doc/html/rfc7636',
  });
});
await setup.close();

// ── Capture ──────────────────────────────────────────────
const page = await browser.newPage();
await page.setViewportSize({ width: W, height: H });

await page.goto(`chrome-extension://${extId}/index.html`);
await shot(page, '01-full-tab.png');

await page.goto(`chrome-extension://${extId}/sidepanel.html`);
await shot(page, '02-side-panel.png');

const popup = await browser.newPage();
await popup.setViewportSize({ width: 380, height: 520 });
await popup.goto(`chrome-extension://${extId}/popup.html`);
await popup.waitForTimeout(600);
await popup.screenshot({ path: path.join(OUT, '03-popup.png') });
console.log('wrote 03-popup.png');
await popup.close();

await page.goto(`chrome-extension://${extId}/bookmarks.html`);
await shot(page, '04-bookmarks.png');

await page.goto(`chrome-extension://${extId}/options.html`);
await page.waitForTimeout(500);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('nav[aria-label="Settings sections"] button')].find(
    (b) => b.textContent?.trim() === 'Sync & backup',
  );
  if (btn) btn.click();
});
await shot(page, '05-sync.png');

await browser.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log('done');
