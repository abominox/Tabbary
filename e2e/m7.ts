/**
 * M7 E2E — closed-tab history, search scope, and the manager's keyboard
 * shortcuts.
 *
 * The closed-tab restore path had a bug that only shows up after the autosave
 * that follows it: the restored row was re-created under a new id and dropped
 * back into the closed list. The check below runs past that debounce on
 * purpose.
 *
 * Prereq: `npm run build`. Run: `npx tsx e2e/m7.ts`
 */

import type { BrowserContext } from 'playwright';
import {
  createUserDataDir,
  cleanUserDataDir,
  launchContext,
  getExtId,
  openExtensionPage,
  querySW,
  createWindow,
  addTab,
  closeOnboardingTab,
  waitFor,
} from './helpers.js';
import type { Session, Tab } from '../src/models/index.js';

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main(): Promise<void> {
  const userDataDir = createUserDataDir();
  let context: BrowserContext | null = null;

  try {
    context = await launchContext(userDataDir);
    const extId = await getExtId(context);
    await closeOnboardingTab(context, extId);
    const page = await openExtensionPage(context, extId, 'index.html');

    // ── Seed a window with two tabs ──
    const win = await createWindow(page);
    await addTab(page, win, 'https://m7.test/keep');
    await addTab(page, win, 'https://m7.test/closing');

    let sessionId = '';
    await waitFor(async () => {
      const list = await querySW<Session[]>(page, { type: 'getSessions' });
      const s = list.find((x) => x.windowId === win);
      if (!s) return false;
      sessionId = s.id;
      const tabs = await querySW<Tab[]>(page, { type: 'getSessionTabs', sessionId: s.id });
      return tabs.filter((t) => t.url.includes('m7.test')).length >= 2;
    }, 25_000, 300, 'window seeded');

    // ── Closed-tab history ──
    const before = await querySW<Tab[]>(page, { type: 'getClosedTabs', sessionId });
    check('a fresh session has no closed tabs', before.length === 0, `${before.length} closed`);

    // Close one tab in Chrome and let the autosave observe it.
    const removed = await page.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const t = tabs.find((x) => (x.url ?? '').includes('m7.test/closing'));
      if (t?.id == null) return false;
      await chrome.tabs.remove(t.id);
      return true;
    });
    check('a tab could be closed in Chrome', removed);
    await page.waitForTimeout(1200);

    const closed = await querySW<Tab[]>(page, { type: 'getClosedTabs', sessionId });
    check(
      'closing a tab records it in the session history',
      closed.some((t) => t.url.includes('m7.test/closing')),
      closed.map((t) => t.url).join(', '),
    );

    const stillOpen = await querySW<Tab[]>(page, { type: 'getSessionTabs', sessionId });
    check(
      'the closed tab is no longer counted as open',
      !stillOpen.some((t) => t.url.includes('m7.test/closing')),
      `${stillOpen.length} open`,
    );

    // ── Restore it ──
    const target = closed.find((t) => t.url.includes('m7.test/closing'));
    check('the closed tab has a row to restore', target != null);

    if (target) {
      const ok = await querySW<boolean>(page, { type: 'restoreClosedTab', tabId: target.id });
      check('restoreClosedTab reports success', ok === true);

      // Past the 250 ms save debounce, which is what exposed the id bug.
      await page.waitForTimeout(1500);

      const windowUrls = await page.evaluate(async (wid) => {
        const tabs = await chrome.tabs.query({ windowId: wid });
        return tabs.map((t) => t.url);
      }, win);
      check(
        'the restored tab is open in Chrome again',
        windowUrls.some((u) => u.includes('m7.test/closing')),
        windowUrls.filter((u) => u.includes('m7.test')).join(', '),
      );

      const openAfter = await querySW<Tab[]>(page, { type: 'getSessionTabs', sessionId });
      check(
        'the restored tab keeps its row id through the following save',
        openAfter.some((t) => t.id === target.id),
        `${openAfter.length} open`,
      );

      const closedAfter = await querySW<Tab[]>(page, { type: 'getClosedTabs', sessionId });
      check(
        'a restored tab leaves the closed list',
        !closedAfter.some((t) => t.url.includes('m7.test/closing')),
        closedAfter.map((t) => t.url).join(', ') || 'empty',
      );
    }

    // ── Search scope setting ──
    const defaults = await querySW<{ searchScope: string }>(page, { type: 'getSettings' });
    check('search scope defaults to all', defaults.searchScope === 'all', defaults.searchScope);

    await querySW(page, { type: 'updateSettings', patch: { searchScope: 'tabs' } });
    const updated = await querySW<{ searchScope: string }>(page, { type: 'getSettings' });
    check('search scope persists', updated.searchScope === 'tabs', updated.searchScope);

    await querySW(page, { type: 'updateSettings', patch: { searchScope: 'all' } });

    // ── Keyboard shortcuts ──
    // Focus the document body so the handler sees the keys, then check that
    // Alt+1 selects the first session without a console error.
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press('Alt+Digit1');
    await page.keyboard.press('Alt+KeyJ');
    await page.keyboard.press('Alt+KeyK');
    await page.keyboard.press('Alt+BracketLeft');
    await page.waitForTimeout(400);

    check('shortcut keys raise no page errors', errors.length === 0, errors.join('; ') || 'none');

    const hint = await page.locator('body').innerText();
    check(
      'the manager documents the shortcuts',
      /Alt\+1/.test(hint) && /Alt\+J/.test(hint),
    );
  } finally {
    await context?.close().catch(() => {});
    cleanUserDataDir(userDataDir);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log('Failed:', failed.map((f) => f.name).join('; '));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
