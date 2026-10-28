/**
 * Stress test: is the product usable at a realistic library size?
 *
 * Everything here is measured against the real extension in a real Chromium,
 * not simulated. Three loads:
 *
 *   1. A live window with many open tabs, which is what autosave has to keep
 *      up with while someone works.
 *   2. A large imported library, which is what the manager list, search and
 *      restore have to cope with after months of use.
 *   3. A restore of a big session, which is the operation people notice most.
 *
 * Numbers are printed as a table and written to stress-results.json so a
 * regression is visible in a diff. Budgets are deliberately loose: they are a
 * tripwire for an order-of-magnitude regression, not a benchmark score.
 *
 * Run:  npx tsx e2e/stress.ts
 *       TABBARY_TABS=500 npx tsx e2e/stress.ts      (default 300)
 *       docker run --rm tabbary-e2e npm run test:e2e:stress
 */

import fs from 'node:fs';
import path from 'node:path';
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
  closeOnboardingTab,
  waitFor,
} from './helpers.js';
import type { Session, Tab } from '../src/models/index.js';

const LIVE_TABS = Number(process.env.TABBARY_TABS ?? 300);
const LIBRARY_SESSIONS = 60;
const LIBRARY_TABS_PER_SESSION = 20;

interface Measurement {
  name: string;
  value: number;
  unit: string;
  budget: number;
  note: string;
}

const results: Measurement[] = [];

function record(name: string, value: number, unit: string, budget: number, note: string): void {
  results.push({ name, value, unit, budget, note });
  const verdict = value <= budget ? 'ok  ' : 'OVER';
  console.log(
    `${verdict} ${name.padEnd(38)} ${value.toFixed(1).padStart(9)} ${unit.padEnd(4)} (budget ${budget} ${unit})`,
  );
}

/** Build a bundle in the shape the exporter produces. */
function syntheticLibrary(sessions: number, tabsPerSession: number): string {
  const now = Date.now();
  const pad = (n: number) => String(n).padStart(3, '0');

  const bundle = {
    format: 'tabbary-export',
    version: 1,
    exportedAt: now,
    generator: 'stress',
    counts: { sessions, tabs: sessions * tabsPerSession, groups: 0 },
    sessions: Array.from({ length: sessions }, (_, s) => ({
      id: `stress-s${s}`,
      name: `Stress session ${pad(s)}`,
      state: 'closed' as const,
      tags: s % 5 === 0 ? ['stress', 'work'] : ['stress'],
      createdAt: now - s * 60_000,
      updatedAt: now - s * 60_000,
      closedAt: now - s * 60_000,
      groups: [],
      tabs: Array.from({ length: tabsPerSession }, (_, t) => ({
        url: `https://site${t % 12}.test/s${s}/t${t}?q=needle${t}`,
        title: `Session ${pad(s)} tab ${pad(t)} — needle${t % 7}`,
        pinned: false,
        position: t,
        groupId: null,
      })),
    })),
  };

  return JSON.stringify(bundle);
}

async function openTabs(windowId: number, page: Page, count: number): Promise<void> {
  // Add in batches; chrome.tabs.create is the bottleneck and each call is a
  // real navigation, so this is genuinely the worst case for the capture path.
  for (let i = 0; i < count; i++) {
    await addTab(page, windowId, `https://load.test/page-${i}`);
  }
}

async function main(): Promise<void> {
  const userDataDir = createUserDataDir();
  let context: BrowserContext | null = null;

  try {
    context = await launchContext(userDataDir);
    const extId = await getExtId(context);
    await closeOnboardingTab(context, extId);
    const page = await openExtensionPage(context, extId, 'index.html');

    // ── 1. Live window with many tabs ──────────────────────
    console.log(`\nLive capture: opening ${LIVE_TABS} real tabs in one window\n`);
    const win = await createWindow(page);

    const openStart = Date.now();
    await openTabs(win, page, LIVE_TABS);
    const openMs = Date.now() - openStart;
    record('open N tabs (test harness cost)', openMs, 'ms', LIVE_TABS * 250, 'not a product metric; context for the rows below');

    // Time from the last tab event to the moment the session is fully persisted.
    const captureStart = Date.now();
    let sessionId = '';
    await waitFor(async () => {
      const sessions = await querySW<Session[]>(page, { type: 'getSessions' });
      const s = sessions.find((x) => x.windowId === win);
      if (!s) return false;
      sessionId = s.id;
      const tabs = await querySW<Tab[]>(page, { type: 'getSessionTabs', sessionId: s.id });
      return tabs.filter((t) => t.url.includes('load.test/page-')).length >= LIVE_TABS;
    }, 120_000, 250, `all ${LIVE_TABS} tabs persisted`);
    const captureMs = Date.now() - captureStart;
    record('autosave settles after last tab', captureMs, 'ms', 5000, `${LIVE_TABS} live tabs`);

    const liveTabs = await querySW<Tab[]>(page, { type: 'getSessionTabs', sessionId });
    const persisted = liveTabs.filter((t) => t.url.includes('load.test/page-')).length;
    record('tabs persisted (count)', persisted, 'tabs', LIVE_TABS, 'must equal the tabs opened');

    // ── 2. Large imported library ──────────────────────────
    const libraryTabs = LIBRARY_SESSIONS * LIBRARY_TABS_PER_SESSION;
    console.log(`\nLibrary: importing ${LIBRARY_SESSIONS} sessions / ${libraryTabs} tabs\n`);

    const importStart = Date.now();
    const imported = await querySW<{ sessions: number; tabs: number }>(page, {
      type: 'importData',
      text: syntheticLibrary(LIBRARY_SESSIONS, LIBRARY_TABS_PER_SESSION),
    });
    const importMs = Date.now() - importStart;
    record('import session bundle', importMs, 'ms', 15_000, `${libraryTabs} tabs in one call`);
    record('imported tabs (count)', imported?.tabs ?? 0, 'tabs', libraryTabs, 'must equal the bundle');

    const totalSessions = (await querySW<Session[]>(page, { type: 'getSessions' })).length;
    const totalTabs = totalSessions > 0
      ? (await Promise.all(
          (await querySW<Session[]>(page, { type: 'getSessions' })).map(async (s) =>
            (await querySW<Tab[]>(page, { type: 'getSessionTabs', sessionId: s.id })).length,
          ),
        )).reduce((a, b) => a + b, 0)
      : 0;
    console.log(`     library now holds ${totalSessions} sessions, ${totalTabs} tabs`);

    // ── 3. Manager render with that library ────────────────
    const navStart = Date.now();
    await page.goto(`chrome-extension://${extId}/index.html`, { waitUntil: 'load' });
    await page.waitForSelector('[aria-label="Sessions"] [role="button"]', { timeout: 30_000 });
    const renderMs = Date.now() - navStart;
    record('manager first render', renderMs, 'ms', 4000, `${totalSessions} sessions listed`);

    // Row count tells us it rendered the list, not just a shell.
    const rows = await page.locator('[aria-label="Sessions"] [role="button"]').count();
    record('session rows rendered', rows, 'rows', totalSessions, 'must match the library');

    // ── 4. Search over the whole library ───────────────────
    // Type into the manager's search box and wait for the list to shrink.
    const searchStart = Date.now();
    await page.locator('input[placeholder^="Search"]').first().fill('needle3');
    await page.waitForFunction(
      (n) => document.querySelectorAll('[aria-label="Sessions"] [role="button"]').length < n,
      totalSessions,
      { timeout: 20_000 },
    );
    const searchMs = Date.now() - searchStart;
    const hits = await page.locator('[aria-label="Sessions"] [role="button"]').count();
    record('search across library', searchMs, 'ms', 1500, `"needle3" → ${hits} sessions`);

    // ── 5. Restore a large session ─────────────────────────
    // Restore the biggest stress session and time until its tabs exist.
    const stressSession = (await querySW<Session[]>(page, { type: 'getSessions' }))
      .find((s) => s.name === 'Stress session 000')!;

    const restoreStart = Date.now();
    await querySW(page, { type: 'openSession', sessionId: stressSession.id });
    await waitFor(async () => {
      const count = await page.evaluate(async () => {
        const windows = await chrome.windows.getAll({ populate: true });
        return windows.reduce((n, w) => n + (w.tabs ?? []).length, 0);
      });
      return count >= LIBRARY_TABS_PER_SESSION;
    }, 60_000, 250, 'restored tabs exist');
    const restoreMs = Date.now() - restoreStart;
    record('restore a session', restoreMs, 'ms', 10_000, `${LIBRARY_TABS_PER_SESSION} tabs`);

    // ── 6. Memory ──────────────────────────────────────────
    const heapMb = await page.evaluate(() => {
      const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      return m ? m.usedJSHeapSize / (1024 * 1024) : null;
    });
    if (heapMb != null) {
      record('manager JS heap', heapMb, 'MB', 400, 'renderer only');
    }

    // ── Summary ────────────────────────────────────────────
    const over = results.filter((r) => r.value > r.budget);
    const out = {
      ranAt: new Date().toISOString(),
      liveTabs: LIVE_TABS,
      library: { sessions: LIBRARY_SESSIONS, tabs: libraryTabs },
      totals: { sessions: totalSessions, tabs: totalTabs },
      results,
      overBudget: over.map((r) => r.name),
    };
    fs.writeFileSync(
      path.resolve('stress-results.json'),
      JSON.stringify(out, null, 2) + '\n',
    );

    console.log(`\n${results.length - over.length}/${results.length} within budget`);
    console.log('wrote stress-results.json');
    if (over.length > 0) {
      console.log('Over budget:', over.map((r) => `${r.name} (${r.value.toFixed(0)}${r.unit} > ${r.budget}${r.unit})`).join('; '));
      process.exitCode = 1;
    }
  } finally {
    await context?.close().catch(() => {});
    cleanUserDataDir(userDataDir);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
