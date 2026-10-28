/**
 * Tab-group restore, in a real (headed) Chromium.
 *
 * This is the one path the headless suites cannot prove: Chromium's new
 * headless shell accepts chrome.tabs.group() but does not persist group
 * membership, so e2e/store.ts prints SKIP for it. Here the groups are real,
 * so capture and restore are both observable.
 *
 * Prereq: `npm run build`
 * Run:    TABBARY_HEADED=1 npx tsx e2e/groups-headed.ts
 *
 * A visible window opens for the duration. Screenshots are written to
 * /tmp/tabbary-groups-*.png as evidence that the group came back.
 */

import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { querySW } from './helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = process.env.TABBARY_EXT ?? path.resolve(__dirname, '..', 'dist');

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

const checks: Check[] = [];
function check(name: string, ok: boolean, detail?: string): void {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

interface GroupSnapshot {
  chromeGroupId: number;
  title: string;
  color: string;
  collapsed: boolean;
  tabs: string[];
}

async function main(): Promise<void> {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabbary-groups-'));

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false, // the point of this test
    // Deliberately no `viewport`: a fixed viewport makes Playwright emulate a
    // screen, and under that emulation chrome.windows.create resolves with no
    // window id in headed mode. Sized with --window-size instead.
    args: [
      '--window-size=1280,900',
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  try {
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const extId = new URL(sw.url()).hostname;
    console.log(`extension ${extId}`);

    // Close the onboarding tab Chrome opens on install.
    for (const p of context.pages()) {
      if (p.url().includes('onboarding.html')) await p.close();
    }

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extId}/index.html`);

    const send = <T = unknown>(msg: Record<string, unknown>): Promise<T> =>
      querySW<T>(page, msg);

    // ── Open a window and fill it ──
    const winId = await page.evaluate(async () => {
      const w = await chrome.windows.create({
        url: 'https://example.com/?tab=specs-1',
        focused: true,
      });
      return w.id!;
    });
    console.log(`window ${winId}`);

    const created = await page.evaluate(
      async (args: { wid: number; urls: string[] }) => {
        for (let i = 0; i < args.urls.length; i++) {
          await chrome.tabs.create({ windowId: args.wid, url: args.urls[i], active: false });
        }
        const tabs = await chrome.tabs.query({ windowId: args.wid });
        return tabs.map((t) => t.url ?? '');
      },
      {
        wid: winId,
        urls: [
          'https://example.com/?tab=specs-2',
          'https://example.com/?tab=code-1',
          'https://example.com/?tab=loose',
        ],
      },
    );
    console.log('window tabs:', JSON.stringify(created));

    // Wait for the extension to bind the window and persist its tabs.
    let sessionId = '';
    let lastSeen = '';
    for (let i = 0; i < 80 && !sessionId; i++) {
      const sessions = await send<{ id: string; windowId: number | null }[]>({ type: 'getSessions' });
      const match = sessions.find((s) => s.windowId === winId);
      if (match) {
        const tabs = await send<{ url: string }[]>({ type: 'getSessionTabs', sessionId: match.id });
        const count = tabs.filter((t) => t.url.includes('example.com')).length;
        lastSeen = `${match.id.slice(0, 8)} with ${count} example.com tabs`;
        if (count >= 4) sessionId = match.id;
      } else {
        lastSeen = `no bound session among ${sessions.length}`;
      }
      if (!sessionId) await page.waitForTimeout(250);
    }
    check('session captured the window and its four tabs', Boolean(sessionId), lastSeen);

    // ── Create two real Chrome tab groups ──
    const groups = await page.evaluate(async (wid: number) => {
      const tabs = await chrome.tabs.query({ windowId: wid });
      const specs: number[] = [];
      const code: number[] = [];
      for (const tab of tabs) {
        const url = tab.url ?? '';
        if (tab.id == null) continue;
        if (url.includes('specs-1') || url.includes('specs-2')) specs.push(tab.id);
        if (url.includes('code-1')) code.push(tab.id);
      }
      const specsId = await chrome.tabs.group({ tabIds: specs, createProperties: { windowId: wid } });
      await chrome.tabGroups.update(specsId, { title: 'Specs', color: 'blue' });
      const codeId = await chrome.tabs.group({ tabIds: code, createProperties: { windowId: wid } });
      await chrome.tabGroups.update(codeId, { title: 'Code', color: 'orange', collapsed: true });
      return { specs: specs.length, code: code.length, specsId, codeId };
    }, winId);
    console.log('created groups:', JSON.stringify(groups));
    check('two groups were created with the right membership', groups.specs === 2 && groups.code === 1);

    // Let autosave observe the group events.
    let captured: { title: string; color: string; collapsed: boolean }[] = [];
    for (let i = 0; i < 40; i++) {
      captured = await send<{ title: string; color: string; collapsed: boolean }[]>({
        type: 'getSessionGroups',
        sessionId,
      });
      if (captured.length >= 2) break;
      await page.waitForTimeout(250);
    }
    check(
      'both groups captured into the session',
      captured.length === 2,
      captured.map((g) => `${g.title}/${g.color}`).join(', ') || 'none',
    );
    check(
      'group titles and colours were stored',
      captured.some((g) => g.title === 'Specs' && g.color === 'blue') &&
        captured.some((g) => g.title === 'Code' && g.color === 'orange'),
      JSON.stringify(captured),
    );
    check(
      'collapsed state was stored',
      captured.some((g) => g.title === 'Code' && g.collapsed === true),
      JSON.stringify(captured.map((g) => [g.title, g.collapsed])),
    );

    // Screenshot before closing: the grouped window.
    await page.screenshot({ path: '/tmp/tabbary-groups-1-before.png' });

    // ── Close the window, which closes the session ──
    // The page driving this test lives in that window, so it has to leave
    // first: closing the window would close the page with it.
    await page.evaluate(
      async (args: { from: number }) => {
        const self = await chrome.tabs.getCurrent();
        if (!self?.id) return;
        const target = (await chrome.windows.getAll()).find((w) => w.id !== args.from);
        if (target?.id != null) {
          await chrome.tabs.move(self.id, { windowId: target.id, index: -1 });
        }
      },
      { from: winId },
    );
    await page.waitForTimeout(400);

    await page.evaluate(async (wid: number) => {
      await chrome.windows.remove(wid);
    }, winId);

    let closed = false;
    for (let i = 0; i < 40 && !closed; i++) {
      const sessions = await send<{ id: string; state: string }[]>({ type: 'getSessions' });
      closed = sessions.find((s) => s.id === sessionId)?.state === 'closed';
      if (!closed) await page.waitForTimeout(250);
    }
    check('closing the window closed the session', closed);


    // ── Restore it ──
    await send({ type: 'openSession', sessionId });
    await page.waitForTimeout(3000);

    const restored = await page.evaluate(async () => {
      const windows = await chrome.windows.getAll({ populate: true });
      const out: GroupSnapshot[] = [];
      for (const w of windows) {
        if (!w.tabs?.length) continue;
        const groups = await chrome.tabGroups.query({ windowId: w.id! }).catch(() => []);
        for (const g of groups) {
          out.push({
            chromeGroupId: g.id,
            title: g.title,
            color: g.color,
            collapsed: g.collapsed,
            tabs: (w.tabs ?? [])
              .filter((t) => t.groupId === g.id)
              .map((t) => t.url ?? ''),
          });
        }
      }
      return out;
    });

    check(
      'restore recreated two groups',
      restored.length === 2,
      restored.map((g) => `${g.title}(${g.tabs.length})`).join(', ') || 'none',
    );
    check(
      'group titles came back',
      restored.some((g) => g.title === 'Specs') && restored.some((g) => g.title === 'Code'),
      JSON.stringify(restored.map((g) => g.title)),
    );
    check(
      'group colours came back',
      restored.some((g) => g.title === 'Specs' && g.color === 'blue') &&
        restored.some((g) => g.title === 'Code' && g.color === 'orange'),
      JSON.stringify(restored.map((g) => [g.title, g.color])),
    );
    check(
      'collapsed state came back',
      restored.some((g) => g.title === 'Code' && g.collapsed === true),
      JSON.stringify(restored.map((g) => [g.title, g.collapsed])),
    );

    const specs = restored.find((g) => g.title === 'Specs');
    const code = restored.find((g) => g.title === 'Code');
    check(
      'membership came back with the right tabs',
      specs?.tabs.some((u) => u.includes('specs-1')) === true &&
        specs?.tabs.some((u) => u.includes('specs-2')) === true &&
        code?.tabs.some((u) => u.includes('code-1')) === true &&
        specs?.tabs.some((u) => u.includes('code-1')) === false,
      `specs=${specs?.tabs.length ?? 0} code=${code?.tabs.length ?? 0}`,
    );

    const ungroupedInfo = await page.evaluate(async () => {
      const windows = await chrome.windows.getAll({ populate: true });
      const loose: { url: string; groupId: number }[] = [];
      for (const w of windows) {
        for (const t of w.tabs ?? []) {
          if ((t.url ?? '').includes('loose')) loose.push({ url: t.url ?? '', groupId: t.groupId ?? 0 });
        }
      }
      return loose;
    });
    // Chrome reports -1 for "not in a group"; 0 is not a valid value.
    const ungrouped = ungroupedInfo.filter((x) => x.groupId === -1).map((x) => x.url);
    check(
      'the ungrouped tab stayed ungrouped',
      ungrouped.length >= 1,
      `${ungrouped.length} ungrouped copy/copies of the loose tab`,
    );

    // Screenshot after restore.
    await page.screenshot({ path: '/tmp/tabbary-groups-2-after.png' });

    const failed = checks.filter((c) => !c.ok);
    console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
    console.log('screenshots: /tmp/tabbary-groups-1-before.png, /tmp/tabbary-groups-2-after.png');
    if (failed.length > 0) {
      console.log('Failed:', failed.map((f) => f.name).join('; '));
      process.exitCode = 1;
    }
  } finally {
    await context.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
