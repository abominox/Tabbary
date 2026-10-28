/**
 * tabbary M2 E2E suite — full-tab manager, drag-and-drop data path, revisions,
 * and settings. Exercises the real message bus from an extension page against a
 * live service worker, then checks the rendered UI.
 *
 * Prereqs: `npm run build`, `npx playwright install chromium`.
 * Run:     npx tsx e2e/m2.ts
 */

import type { BrowserContext, Page } from 'playwright';
import {
  createUserDataDir,
  cleanUserDataDir,
  launchContext,
  getExtId,
  openExtensionPage,
  querySW,
  createWindow,
  addTab,
  closeWindow,
  closeOnboardingTab,
  waitFor,
} from './helpers.js';
import type { Session, Tab, SessionVersion, Settings } from '../src/models/index.js';

const results: { name: string; ok: boolean; detail?: string }[] = [];

function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const userDataDir = createUserDataDir();
  let context: BrowserContext | null = null;

  try {
    context = await launchContext(userDataDir);
    const extId = await getExtId(context);
    await closeOnboardingTab(context, extId);

    const page = await openExtensionPage(context, extId, 'index.html');

    // ── Seed two windows with tabs ──
    const winA = await createWindow(page);
    await addTab(page, winA, 'https://example.com/a1');
    await addTab(page, winA, 'https://example.com/a2');
    await addTab(page, winA, 'https://github.com/x/y');

    const winB = await createWindow(page);
    await addTab(page, winB, 'https://example.org/b1');
    await addTab(page, winB, 'https://example.org/a1'); // duplicate URL across sessions

    await waitFor(async () => {
      const s = await querySW<Session[]>(page, { type: 'getSessions' });
      const a = s.find((x) => x.windowId === winA);
      const b = s.find((x) => x.windowId === winB);
      if (!a || !b) return false;
      // Wait for the *specific* URLs, not just a non-zero count: saves are
      // debounced and coalesced, so a count check can pass mid-flight.
      const urlsOf = async (id: string) =>
        (await querySW<Tab[]>(page, { type: 'getSessionTabs', sessionId: id })).map((t) => t.url);
      const [urlsA, urlsB] = await Promise.all([urlsOf(a.id), urlsOf(b.id)]);
      const wantA = ['https://example.com/a1', 'https://example.com/a2', 'https://github.com/x/y'];
      // Both windows must be persisted. The move below asserts that the
      // destination keeps its own tabs, which proves nothing if it has none
      // yet, and that gap is what previously made this suite flaky.
      return wantA.every((w) => urlsA.includes(w)) && urlsB.includes('https://example.org/b1');
    }, 25000, 400, 'both sessions fully persisted');

    let sessions = await querySW<Session[]>(page, { type: 'getSessions' });
    const sessA = sessions.find(s => s.windowId === winA)!;
    const sessB = sessions.find(s => s.windowId === winB)!;
    check('two sessions tracked', Boolean(sessA && sessB), `${sessions.length} sessions`);

    const tabsA = await querySW<Tab[]>(page, { type: 'getSessionTabs', sessionId: sessA.id });
    const urlsA = tabsA.map(t => t.url);
    check(
      'tabs captured for session A',
      urlsA.includes('https://example.com/a1') &&
        urlsA.includes('https://example.com/a2') &&
        urlsA.includes('https://github.com/x/y'),
      urlsA.length + ' tabs: ' + urlsA.join(' '),
    );

    // ── M2: move a tab between sessions (the DnD data path) ──
    const tabsBBefore = await querySW<Tab[]>(page, { type: 'getSessionTabs', sessionId: sessB.id });
    const keptUrls = tabsBBefore.map(t => t.url).filter(Boolean);

    const moveTarget = tabsA[0]!;
    const moveResult = await querySW<{ moved: number }>(page, {
      type: 'moveTabs',
      tabIds: [moveTarget.id],
      targetSessionId: sessB.id,
    });
    check('moveTabs moves across sessions', moveResult?.moved === 1, `moved=${moveResult?.moved}`);

    // The destination window's save is debounced by 250ms, so wait past it.
    // This check used to run immediately and could pass while the row was
    // about to be replaced by the save, which is what made it flaky in CI.
    await page.waitForTimeout(700);

    const tabsBAfter = await querySW<Tab[]>(page, { type: 'getSessionTabs', sessionId: sessB.id });
    check(
      'destination holds the moved tab, same row id after the save',
      tabsBAfter.some(t => t.id === moveTarget.id),
      `${tabsBAfter.length} tabs in destination`,
    );
    check(
      "moving a tab leaves the destination's own tabs alone",
      keptUrls.length > 0 && keptUrls.every(u => tabsBAfter.some(t => t.url === u)),
      `kept ${keptUrls.filter(u => tabsBAfter.some(t => t.url === u)).length}/${keptUrls.length}`,
    );

    // ── M2: merge with duplicate detection ──
    const mergeResult = await querySW<{ moved: number; skipped: number }>(page, {
      type: 'mergeSession',
      sourceSessionId: sessA.id,
      targetSessionId: sessB.id,
    });
    check(
      'merge reports moved and skipped',
      typeof mergeResult?.moved === 'number' && typeof mergeResult?.skipped === 'number',
      `moved=${mergeResult?.moved} skipped=${mergeResult?.skipped}`,
    );

    // ── M2: revisions ──
    // Close a window to force a snapshot-producing state, then ask for versions.
    await closeWindow(page, winA).catch(() => {});
    await page.waitForTimeout(1200);

    const versions = await querySW<SessionVersion[]>(page, {
      type: 'getVersions',
      sessionId: sessB.id,
    });
    check(
      'getVersions returns a list (possibly empty)',
      Array.isArray(versions),
      `${Array.isArray(versions) ? versions.length : 'not an array'} revisions`,
    );

    if (Array.isArray(versions) && versions.length > 0) {
      const v = versions[0]!;
      const one = await querySW<SessionVersion | null>(page, {
        type: 'getVersion',
        versionId: v.id,
      });
      check('getVersion returns the snapshot', one?.id === v.id);

      const before = await querySW<Tab[]>(page, { type: 'getSessionTabs', sessionId: v.sessionId });
      await querySW(page, { type: 'restoreVersion', versionId: v.id });
      const after = await querySW<Tab[]>(page, { type: 'getSessionTabs', sessionId: v.sessionId });
      check(
        'restoreVersion rewrites the tab set',
        after.length === v.snapshot.tabs.length,
        `before=${before.length} after=${after.length} snapshot=${v.snapshot.tabs.length}`,
      );
    }

    // ── M2: settings round-trip ──
    const defaults = await querySW<Settings>(page, { type: 'getSettings' });
    check('getSettings returns defaults', defaults?.versionHistoryLimit === 10);

    const patched = await querySW<Settings>(page, {
      type: 'updateSettings',
      patch: { theme: 'dark', versionHistoryLimit: 25, restoreOnStartup: 'ask' },
    });
    check(
      'updateSettings persists the patch',
      patched?.theme === 'dark' && patched?.versionHistoryLimit === 25 && patched?.restoreOnStartup === 'ask',
      `theme=${patched?.theme} limit=${patched?.versionHistoryLimit}`,
    );

    const reread = await querySW<Settings>(page, { type: 'getSettings' });
    check('settings survive a re-read', reread?.versionHistoryLimit === 25);

    const reset = await querySW<Settings>(page, { type: 'resetSettings' });
    check('resetSettings restores defaults', reset?.versionHistoryLimit === 10 && reset?.theme === 'system');

    // ── M2: rendered full-tab UI ──
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    const ui = await page.evaluate(() => {
      // innerText applies CSS text-transform, so compare case-insensitively.
      const text = document.body.innerText.toLowerCase();
      return {
        hasBrand: text.includes('tabbary'),
        hasActiveHeading: text.includes('active sessions'),
        hasClosedHeading: text.includes('closed sessions'),
        hasSearch: Boolean(document.querySelector('input')),
        hasDetail: text.includes('history') || text.includes('no session selected'),
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        // Count the letter tiles rendered in the rail (aria-hidden spans w/ inline bg)
        markTiles: document.querySelectorAll('span[aria-hidden="true"] > span[title]').length,
      };
    });
    check('full-tab renders the session panes', ui.hasActiveHeading && ui.hasClosedHeading);
    check('full-tab renders session detail or empty state', ui.hasDetail);
    check('rail renders tab mark tiles', ui.markTiles > 0, `${ui.markTiles} tiles`);
    check('no horizontal overflow', ui.overflowX === 0, `overflowX=${ui.overflowX}`);

    // ── Layout sanity (we can't eyeball a headless run) ──
    // Passed as source text: tsx/esbuild rewrites function expressions with a
    // `__name` helper that does not exist inside the page.
    const layout = await page.evaluate(`(() => {
      const rect = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      };
      const spilling = [...document.querySelectorAll('header *, section[aria-label="Sessions"] *')]
        .filter((el) => {
          const cs = getComputedStyle(el);
          if (cs.overflowX === 'hidden' || cs.overflowX === 'auto' || cs.overflowX === 'scroll') return false;
          return el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0;
        })
        .map((el) => el.tagName.toLowerCase() + '.' + String(el.className || '').split(' ')[0])
        .slice(0, 5);
      return {
        header: rect('header'),
        aside: rect('aside'),
        sessions: rect('section[aria-label="Sessions"]'),
        main: rect('main'),
        viewport: { w: window.innerWidth, h: window.innerHeight },
        spilling,
      };
    })()`);
    check(
      'three panes have sane geometry',
      Boolean(layout.header && layout.sessions && layout.main) &&
        layout.sessions!.w > 150 &&
        layout.main!.w > 200 &&
        layout.header!.h > 30 &&
        layout.header!.h < 90,
      `sessions=${layout.sessions?.w}px main=${layout.main?.w}px header=${layout.header?.h}px`,
    );
    check('no visible element spills its box', layout.spilling.length === 0, layout.spilling.join(', '));

    // ── M2: options page renders all sections ──
    const opts = await openExtensionPage(context, extId, 'options.html');
    const optUi = await opts.evaluate(() => {
      const text = document.body.innerText;
      return {
        sections: ['General', 'Interface', 'Sessions', 'Tabs', 'Sync & backup', 'Storage & history', 'Account']
          .filter(s => text.includes(s)),
        switches: document.querySelectorAll('[role="switch"]').length,
        hasPrivacyStrip: text.includes('No ads, no account'),
      };
    });
    check('options lists all sections', optUi.sections.length === 7, optUi.sections.join(', '));
    check('options renders switches', optUi.switches > 0, `${optUi.switches} switches`);
    check('options shows the FOSS strip', optUi.hasPrivacyStrip);

    // Toggle a switch and confirm it reaches the store/SW.
    await opts.evaluate(() => {
      const sw = document.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Auto-save sessions"]');
      sw?.click();
    });
    await opts.waitForTimeout(800);
    const afterToggle = await querySW<Settings>(opts, { type: 'getSettings' });
    check('toggling a setting persists', afterToggle?.autosave === false, `autosave=${afterToggle?.autosave}`);

  } finally {
    await context?.close().catch(() => {});
    cleanUserDataDir(userDataDir);
  }

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log('Failed:', failed.map(f => f.name).join('; '));
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
