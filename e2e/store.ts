/**
 * Store readiness E2E — backs up, restores groups, and verifies the manifest
 * contract a reviewer will check.
 *
 * Prereq: `npm run build`. Run: `npx tsx e2e/store.ts`
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
import type { Session, Tab, TabGroup } from '../src/models/index.js';

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

interface BackupView {
  enabled: boolean;
  lastRunAt: number | null;
  bytes: number;
  slots: { id: string; tier: string; sessions: number; tabs: number; bytes: number }[];
}

async function main() {
  const userDataDir = createUserDataDir();
  let context: BrowserContext | null = null;

  try {
    context = await launchContext(userDataDir);
    const extId = await getExtId(context);
    await closeOnboardingTab(context, extId);
    const page = await openExtensionPage(context, extId, 'index.html');

    // ── Seed a grouped session ──
    const win = await createWindow(page);
    await addTab(page, win, 'https://group-a.test/1');
    await addTab(page, win, 'https://group-a.test/2');
    await addTab(page, win, 'https://loose.test/3');

    let sessionId = '';
    await waitFor(async () => {
      const sessions = await querySW<Session[]>(page, { type: 'getSessions' });
      const s = sessions.find((x) => x.windowId === win);
      if (!s) return false;
      const tabs = await querySW<Tab[]>(page, { type: 'getSessionTabs', sessionId: s.id });
      sessionId = s.id;
      return tabs.length >= 3;
    }, 20_000, 300, 'session seeded');

    // ── Tab groups ──
    // Chromium's new headless shell accepts chrome.tabs.group but does not
    // persist group membership, so group capture/recreation cannot be observed
    // here. Detect support instead of reporting a false pass or a false fail;
    // the planning logic is covered by unit tests in
    // src/sw/__tests__/restore-tabs.test.ts.
    await waitFor(async () => {
      const tabs = await querySW<Tab[]>(page, { type: 'getSessionTabs', sessionId });
      return tabs.filter((t) => t.url.includes('group-a.test')).length >= 2;
    }, 20_000, 300, 'tabs persisted before grouping');

    const groupSupport = await page.evaluate(async (wid) => {
      const tabs = await chrome.tabs.query({ windowId: wid });
      const ids = tabs
        .filter((t) => (t.url ?? '').includes('group-a.test'))
        .map((t) => t.id!)
        .filter((id) => id != null);
      if (ids.length === 0) return { supported: false, reason: 'no candidate tabs' };

      try {
        const groupId = await chrome.tabs.group({ tabIds: ids });
        await chrome.tabGroups.update(groupId, { title: 'Specs', color: 'blue' });
        const after = await chrome.tabs.query({ windowId: wid });
        const stillGrouped = after.some((t) => (t.groupId ?? 0) > 0);
        return {
          supported: stillGrouped,
          reason: stillGrouped ? null : 'group membership not persisted by this Chromium',
          groupId,
        };
      } catch (err) {
        return { supported: false, reason: (err as Error).message };
      }
    }, win);

    if (groupSupport.supported) {
      await waitFor(async () => {
        const groups = await querySW<TabGroup[]>(page, { type: 'getSessionGroups', sessionId });
        return Array.isArray(groups) && groups.length >= 1;
      }, 20_000, 400, 'group captured');

      const capturedGroups = await querySW<TabGroup[]>(page, {
        type: 'getSessionGroups',
        sessionId,
      });
      check(
        'the group is captured with its title',
        capturedGroups.some((g) => g.title === 'Specs'),
        capturedGroups.map((g) => `${g.title}/${g.color}`).join(', '),
      );

      await closeWindow(page, win);
      await waitFor(async () => {
        const s = await querySW<Session[]>(page, { type: 'getSessions' });
        return s.find((x) => x.id === sessionId)?.state === 'closed';
      }, 15_000, 300, 'session closed');

      await querySW(page, { type: 'openSession', sessionId });
      await page.waitForTimeout(2500);

      const restored = await page.evaluate(async () => {
        const windows = await chrome.windows.getAll({ populate: true });
        const details = [];
        for (const w of windows) {
          for (const t of w.tabs ?? []) {
            if ((t.groupId ?? 0) > 0) {
              const info = await chrome.tabGroups.get(t.groupId).catch(() => null);
              if (info) details.push({ title: info.title, color: info.color });
            }
          }
        }
        return details;
      });

      check(
        'restoring recreates the tab group',
        restored.some((d) => d.title === 'Specs'),
        JSON.stringify(restored),
      );
    } else {
      console.log(
        `SKIP  tab group recreation — ${groupSupport.reason}. Covered by unit tests instead.`,
      );
      // Still prove a plain restore works without groups.
      await closeWindow(page, win);
      await waitFor(async () => {
        const s = await querySW<Session[]>(page, { type: 'getSessions' });
        return s.find((x) => x.id === sessionId)?.state === 'closed';
      }, 15_000, 300, 'session closed');

      await querySW(page, { type: 'openSession', sessionId });
      await page.waitForTimeout(1500);
      const reopened = await page.evaluate(async () => {
        const windows = await chrome.windows.getAll({ populate: true });
        return windows.reduce(
          (n, w) => n + (w.tabs ?? []).filter((t) => (t.url ?? '').includes('group-a.test')).length,
          0,
        );
      });
      check('restoring a session reopens its tabs', reopened >= 2, `${reopened} matching tabs`);
    }

    // ── Backups ──
    const initial = await querySW<BackupView>(page, { type: 'backupList' });
    check('backups are enabled by default', initial?.enabled === true);

    const run = await querySW<{ written: number; skipped: string | null }>(page, {
      type: 'backupRun',
      force: true,
    });
    check('a manual backup writes a snapshot', (run?.written ?? 0) >= 1, `written=${run?.written}`);

    const after = await querySW<BackupView>(page, { type: 'backupList' });
    check('the snapshot is listed', (after?.slots.length ?? 0) >= 1, `${after?.slots.length} slots`);
    check(
      'the snapshot records contents',
      (after?.slots[0]?.sessions ?? 0) >= 1 && (after?.slots[0]?.tabs ?? 0) >= 1,
      `${after?.slots[0]?.sessions} sessions, ${after?.slots[0]?.tabs} tabs`,
    );

    const beforeSessions = (await querySW<Session[]>(page, { type: 'getSessions' })).length;
    const restoreResult = await querySW<{ sessions: number; tabs: number } | null>(page, {
      type: 'backupRestore',
      id: after!.slots[0]!.id,
    });
    check('restoring a snapshot reports what it added', (restoreResult?.sessions ?? 0) >= 1, JSON.stringify(restoreResult));

    const afterSessions = (await querySW<Session[]>(page, { type: 'getSessions' })).length;
    check(
      'restore is additive, not destructive',
      afterSessions > beforeSessions,
      `${beforeSessions} → ${afterSessions}`,
    );

    // ── Manifest contract for review ──
    const manifest = await page.evaluate(() => chrome.runtime.getManifest());
    const m = manifest as {
      name?: string;
      version?: string;
      description?: string;
      manifest_version?: number;
      host_permissions?: string[];
      permissions?: string[];
      optional_permissions?: string[];
      icons?: Record<string, string>;
      action?: { default_popup?: string; default_icon?: Record<string, string> };
    };

    check('manifest v3', m.manifest_version === 3);
    check('has a version', /^\d+\.\d+\.\d+$/.test(m.version ?? ''), m.version);
    check('has a description', (m.description ?? '').length > 20, m.description);
    check('requests no host permissions', (m.host_permissions ?? []).length === 0);
    check(
      'all four icon sizes are declared',
      ['16', '32', '48', '128'].every((s) => Boolean(m.icons?.[s])),
      Object.keys(m.icons ?? {}).join(','),
    );
    check(
      'sensitive permissions are optional',
      ['history', 'bookmarks'].every((p) => (m.optional_permissions ?? []).includes(p)),
    );
    check('the action opens a popup', m.action?.default_popup === 'popup.html');

    // Icons must actually load at the declared size.
    const iconOk = await page.evaluate(async () => {
      const res = await fetch(chrome.runtime.getURL('icons/icon128.png'));
      const blob = await res.blob();
      const bitmap = await createImageBitmap(blob);
      return { w: bitmap.width, h: bitmap.height, bytes: blob.size };
    });
    check(
      'the 128px icon is a real 128px image',
      iconOk.w === 128 && iconOk.h === 128,
      `${iconOk.w}x${iconOk.h}, ${iconOk.bytes}B`,
    );

    // Every surface must load without error.
    for (const surface of ['index.html', 'sidepanel.html', 'popup.html', 'window.html', 'options.html', 'tags.html', 'bookmarks.html', 'onboarding.html']) {
      const p = await openExtensionPage(context, extId, surface);
      const ok = await p.evaluate(() => document.body.innerText.trim().length > 0);
      check(`surface loads: ${surface}`, ok);
      await p.close();
    }

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
