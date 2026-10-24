/**
 * Windrow M3 E2E — popup, dedicated window, tags, and restore matching.
 *
 * Restore matching is exercised through the real bus: two sessions are
 * recorded, their windows closed, then a window with identical URLs is opened
 * and `matchWindows` must bind it to the recorded session rather than treating
 * it as new.
 *
 * Prereqs: `npm run build`. Run: `npx tsx e2e/m3.ts`
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
  closeWindow,
  closeOnboardingTab,
  waitFor,
} from './helpers.js';
import type { Session, Tab } from '../src/models/index.js';

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

interface MatchResult {
  sessionId: string;
  windowId: number;
  score: number;
  sharedUrls: number;
}

async function main() {
  const userDataDir = createUserDataDir();
  let context: BrowserContext | null = null;

  try {
    context = await launchContext(userDataDir);
    const extId = await getExtId(context);
    await closeOnboardingTab(context, extId);

    const page = await openExtensionPage(context, extId, 'index.html');

    // ── Seed two sessions ──
    const winA = await createWindow(page);
    await addTab(page, winA, 'https://alpha.test/one');
    await addTab(page, winA, 'https://alpha.test/two');

    const winB = await createWindow(page);
    await addTab(page, winB, 'https://beta.test/one');

    await waitFor(async () => {
      const sessions = await querySW<Session[]>(page, { type: 'getSessions' });
      if (sessions.length < 2) return false;
      const all = await Promise.all(
        sessions.map((s) => querySW<Tab[]>(page, { type: 'getSessionTabs', sessionId: s.id })),
      );
      return all.some((ts) => ts.some((t) => t.url === 'https://alpha.test/two'));
    }, 20000, 400, 'two sessions seeded');

    const seeded = await querySW<Session[]>(page, { type: 'getSessions' });
    const sessA = seeded.find((s) => s.windowId === winA)!;
    const sessB = seeded.find((s) => s.windowId === winB)!;

    // Tag them so the tags surface has data.
    await querySW(page, { type: 'tagSession', sessionId: sessA.id, tags: ['alpha', 'work'] });
    await querySW(page, { type: 'tagSession', sessionId: sessB.id, tags: ['beta', 'work'] });

    // ── Close both windows: sessions become closed ──
    await closeWindow(page, winA);
    await closeWindow(page, winB);
    await waitFor(async () => {
      const s = await querySW<Session[]>(page, { type: 'getSessions' });
      return s.filter((x) => x.state === 'closed').length >= 2;
    }, 20000, 400, 'sessions closed');

    // ── Restore matching: open a window with the same URLs ──
    const reopened = await page.evaluate(async () => {
      const win = await chrome.windows.create({
        url: ['https://alpha.test/one', 'https://alpha.test/two'],
        focused: false,
      });
      return win.id!;
    });
    await page.waitForTimeout(1200);

    const matches = await querySW<MatchResult[]>(page, { type: 'matchWindows' });
    check(
      'matchWindows returns at least one binding',
      Array.isArray(matches) && matches.length >= 1,
      `${matches?.length ?? 0} matches`,
    );

    const alphaMatch = matches?.find((m) => m.sessionId === sessA.id);
    check(
      'match binds the recorded session, not a new one',
      alphaMatch?.windowId === reopened,
      `window ${alphaMatch?.windowId} (expected ${reopened})`,
    );
    check(
      'match score is confident',
      (alphaMatch?.score ?? 0) >= 0.5,
      `score=${alphaMatch?.score}`,
    );

    // ── Restore: bind it and confirm the session becomes active ──
    const beforeState = (await querySW<Session[]>(page, { type: 'getSessions' })).find(
      (s) => s.id === sessA.id,
    )!;
    check(
      'a reopened window auto-binds to its recorded session',
      beforeState.state === 'active' && beforeState.windowId === reopened,
      `state=${beforeState.state} window=${beforeState.windowId} (expected ${reopened})`,
    );

    await querySW(page, { type: 'restoreLastSession' });
    await page.waitForTimeout(1500);

    // ── Startup matching: restart with the window already open ──
    // Chrome reopens windows asynchronously after onStartup, so this exercises
    // the grace-period path in windows.ts: the reopened window must bind to the
    // recorded session instead of creating a new one.
    await context.close();
    context = await launchContext(userDataDir);
    const extId2 = await getExtId(context);
    const page2 = await openExtensionPage(context, extId2, 'index.html');
    await page2.waitForTimeout(1500);

    await waitFor(async () => {
      const s = await querySW<Session[]>(page2, { type: 'getSessions' });
      return s.some((x) => x.state === 'active');
    }, 20000, 500, 'a session is active after restart');

    const afterRestart = await querySW<Session[]>(page2, { type: 'getSessions' });
    const activeAfter = afterRestart.filter((s) => s.state === 'active');

    check(
      'restart does not duplicate a restored window into a new session',
      activeAfter.length === 1,
      `${activeAfter.length} active session(s)`,
    );

    // The original session id must survive the restart (proving the match bound
    // to it rather than creating a fresh row).
    const originalIds = new Set([sessA.id, sessB.id]);
    check(
      'the active session after restart is one of the recorded sessions',
      activeAfter.some((s) => originalIds.has(s.id)),
      activeAfter.map((s) => s.id.slice(0, 8)).join(', '),
    );

    const restored = await querySW<Tab[]>(page2, {
      type: 'getSessionTabs',
      sessionId: activeAfter[0]!.id,
    });
    check(
      'restored session kept its tabs',
      Array.isArray(restored) && restored.length > 0,
      `${restored?.length ?? 0} tabs`,
    );

    // ── Tags surface ──
    const tags = await querySW<{ name: string; count: number }[]>(page2, {
      type: 'getTags',
    });
    check(
      'getTags counts sessions per tag',
      Array.isArray(tags) && tags.find((t) => t.name === 'work')?.count === 2,
      tags?.map((t) => `${t.name}:${t.count}`).join(' '),
    );

    const renamed = await querySW<number>(page2, {
      type: 'renameTag',
      from: 'alpha',
      to: 'alpha-renamed',
    });
    check('renameTag reports affected sessions', renamed === 1, `affected=${renamed}`);

    const afterRename = await querySW<{ name: string; count: number }[]>(page2, {
      type: 'getTags',
    });
    check(
      'renamed tag appears and the old one is gone',
      afterRename.some((t) => t.name === 'alpha-renamed') &&
        !afterRename.some((t) => t.name === 'alpha'),
      afterRename.map((t) => t.name).join(' '),
    );

    const deleted = await querySW<number>(page2, { type: 'deleteTag', name: 'beta' });
    check('deleteTag removes it from sessions', deleted === 1, `affected=${deleted}`);

    const afterDelete = await querySW<{ name: string; count: number }[]>(page2, {
      type: 'getTags',
    });
    check('deleted tag is gone', !afterDelete.some((t) => t.name === 'beta'));

    // ── Popup surface ──
    const popup = await openExtensionPage(context, extId2, 'popup.html');
    const popupUi = await popup.evaluate(() => {
      return {
        hasBrand: document.body.innerText.includes('Windrow'),
        hasSearch: Boolean(document.querySelector('input')),
        hasRestoreAffordance: document.body.innerText.toLowerCase().includes('recently closed'),
        // The popup card is the fixed 380px element; the App wrapper above it is
        // h-full/w-full, and body is the tab viewport. Match on the card's class.
        frameWidth: Math.round(
          (document.querySelector('#app-root .w-\\[380px\\]') as HTMLElement | null)
            ?.getBoundingClientRect().width ?? 0,
        ),
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    check('popup renders', popupUi.hasBrand && popupUi.hasSearch);
    check('popup shows closed sessions', popupUi.hasRestoreAffordance);
    check(
      'popup fits its 380px frame',
      popupUi.frameWidth > 0 && popupUi.frameWidth <= 400 && popupUi.overflowX === 0,
      `frame=${popupUi.frameWidth}px overflowX=${popupUi.overflowX}`,
    );

    // ── Dedicated window surface ──
    const winPage = await openExtensionPage(context, extId2, 'window.html');
    await winPage.setViewportSize({ width: 560, height: 760 });
    await winPage.waitForTimeout(600);
    const winUi = await winPage.evaluate(() => ({
      text: document.body.innerText.toLowerCase(),
      panes: Boolean(document.querySelector('section[aria-label="Sessions"]')),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    check('dedicated window renders the session pane', winUi.panes);
    check(
      'dedicated window has no horizontal overflow at 560px',
      winUi.overflowX === 0,
      `overflowX=${winUi.overflowX}`,
    );

    // ── Tags page surface ──
    const tagsPage = await openExtensionPage(context, extId2, 'tags.html');
    const tagsUi = await tagsPage.evaluate(() => ({
      text: document.body.innerText.toLowerCase(),
      list: Boolean(document.querySelector('section[aria-label="Tags"]')),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    check('tags page renders the tag list', tagsUi.list);
    check('tags page shows the remaining tag', tagsUi.text.includes('alpha-renamed'));
    check('tags page has no horizontal overflow', tagsUi.overflowX === 0);

    // ── Manifest wiring ──
    const manifest = await page2.evaluate(() => chrome.runtime.getManifest());
    check(
      'toolbar action opens the popup',
      (manifest as { action?: { default_popup?: string } }).action?.default_popup === 'popup.html',
    );
    const commands = Object.keys(
      (manifest as { commands?: Record<string, unknown> }).commands ?? {},
    );
    check(
      'side panel has its own command',
      commands.includes('open-side-panel'),
      commands.join(', '),
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
