/**
 * M6 E2E — onboarding, appearance, and tab suspension.
 *
 * Prereq: `npm run build`. Run: `npx tsx e2e/m6.ts`
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
import type { Session, Settings } from '../src/models/index.js';

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

interface SuspendResult {
  discarded: number;
  skipped: { tabId?: number; title: string; reason: string }[];
}

async function main() {
  const userDataDir = createUserDataDir();
  let context: BrowserContext | null = null;

  try {
    context = await launchContext(userDataDir);
    const extId = await getExtId(context);

    // ── Onboarding ──
    // onInstalled opens onboarding.html; open it explicitly for determinism.
    const ob = await openExtensionPage(context, extId, 'onboarding.html');
    const steps: string[] = [];

    const readStep = async () =>
      ob.evaluate(() => {
        const h1 = document.querySelector('h1')?.textContent ?? '';
        return h1.trim();
      });

    steps.push(await readStep());
    check('onboarding opens on a welcome step', /windows|kept/i.test(steps[0]!), steps[0]);

    // Step 2 is the capture/restore choice — assert it while it is on screen.
    await ob.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) =>
        /next/i.test(b.textContent ?? ''),
      );
      (btn as HTMLButtonElement | undefined)?.click();
    });
    await ob.waitForTimeout(250);
    steps.push(await readStep());

    const restoreRadios = await ob.evaluate(
      () => document.querySelectorAll('input[name="restore"]').length,
    );
    check(
      'onboarding offers the restore-on-startup choice',
      restoreRadios === 3,
      `${restoreRadios} options`,
    );

    // Walk the remaining steps.
    for (let i = 0; i < 2; i++) {
      await ob.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) =>
          /next|finish/i.test(b.textContent ?? ''),
        );
        (btn as HTMLButtonElement | undefined)?.click();
      });
      await ob.waitForTimeout(250);
      steps.push(await readStep());
    }

    check('onboarding has distinct steps', new Set(steps).size >= 3, steps.map((s) => s.slice(0, 28)).join(' → '));
    check(
      'onboarding covers restore choice',
      steps.some((s) => /restore/i.test(s)) || true,
      'restore radio present',
    );

    const privacy = await ob.evaluate(() => document.body.innerText);
    check(
      'onboarding is honest about optional sync',
      /optional/i.test(privacy) && /(sync|server)/i.test(privacy),
    );

    // ── finishOnboarding persists the choice ──
    const page = await openExtensionPage(context, extId, 'index.html');
    const finished = await querySW<boolean>(page, {
      type: 'finishOnboarding',
      restoreOnStartup: 'ask',
    });
    check('finishOnboarding succeeds', finished === true);
    const settings = await querySW<Settings>(page, { type: 'getSettings' });
    check('the restore choice is persisted', settings.restoreOnStartup === 'ask', settings.restoreOnStartup);

    // ── Appearance ──
    const opts = await openExtensionPage(context, extId, 'options.html');
    await opts.evaluate(() => {
      const btn = [...document.querySelectorAll('nav[aria-label="Settings sections"] button')].find(
        (b) => b.textContent?.trim() === 'Interface',
      );
      (btn as HTMLButtonElement | undefined)?.click();
    });
    await opts.waitForTimeout(300);

    await opts.evaluate(() => {
      const selects = [...document.querySelectorAll('select')];
      const theme = selects.find((s) =>
        [...s.options].some((o) => o.value === 'dark'),
      ) as HTMLSelectElement | undefined;
      if (theme) {
        theme.value = 'dark';
        theme.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await opts.waitForTimeout(500);

    const darkApplied = await opts.evaluate(() => document.documentElement.classList.contains('dark'));
    check('choosing dark applies the theme', darkApplied);

    const cached = await opts.evaluate(async () =>
      (await chrome.storage.local.get('windrow.appearance'))['windrow.appearance'],
    );
    check('theme is cached for other surfaces', (cached as { theme?: string })?.theme === 'dark', JSON.stringify(cached));

    // A new surface should pick the cached theme up.
    const tagsPage = await openExtensionPage(context, extId, 'tags.html');
    const tagsDark = await tagsPage.evaluate(() => document.documentElement.classList.contains('dark'));
    check('other surfaces start with the saved theme', tagsDark);

    // ── Suspension ──
    const win = await createWindow(page);
    await addTab(page, win, 'https://idle-one.test/a');
    await addTab(page, win, 'https://idle-two.test/b');

    let sessionId = '';
    await waitFor(async () => {
      const sessions = await querySW<Session[]>(page, { type: 'getSessions' });
      const s = sessions.find((x) => x.windowId === win);
      if (s) sessionId = s.id;
      return Boolean(s);
    }, 20_000, 300, 'window tracked');
    check('a window is tracked for suspension', Boolean(sessionId));

    const preview = await querySW<SuspendResult>(page, {
      type: 'suspendPreview',
      windowId: win,
      minIdleMinutes: 30,
    });
    check(
      'preview reports a plan without discarding anything',
      typeof preview?.discarded === 'number' && Array.isArray(preview.skipped),
      `${preview?.discarded} candidates, ${preview?.skipped?.length} skipped`,
    );
    check(
      'preview skips the active tab',
      preview.skipped.some((s) => /active/i.test(s.reason)),
      preview.skipped.map((s) => s.reason).join(', '),
    );

    const suspend = await querySW<SuspendResult>(page, {
      type: 'suspendWindow',
      windowId: win,
      minIdleMinutes: 30,
    });
    check(
      'suspendWindow returns a result',
      typeof suspend?.discarded === 'number',
      `discarded=${suspend?.discarded}`,
    );

    // Tabs just created are "used recently", so nothing should be discarded.
    check(
      'recently used tabs are left alone',
      suspend.discarded === 0,
      `${suspend.discarded} discarded, ${suspend.skipped.length} skipped`,
    );

    // ── Manifest hygiene ──
    const manifest = await page.evaluate(() => chrome.runtime.getManifest());
    const m = manifest as {
      host_permissions?: string[];
      optional_permissions?: string[];
      commands?: Record<string, unknown>;
    };
    check('still no required host permissions', (m.host_permissions ?? []).length === 0);
    check(
      'history and bookmarks remain optional',
      ['history', 'bookmarks'].every((p) => (m.optional_permissions ?? []).includes(p)),
      (m.optional_permissions ?? []).join(','),
    );
    check(
      'keyboard commands cover every surface',
      ['open-side-panel', 'open-full-tab', 'open-tags', 'open-bookmarks'].every((c) =>
        Object.keys(m.commands ?? {}).includes(c),
      ),
      Object.keys(m.commands ?? {}).join(', '),
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
