/**
 * tabbary import/export E2E.
 *
 * Exercises the real path a user takes:
 *   seed sessions → Settings → Export JSON (actual browser download) →
 *   read the saved file → import it back through the file picker → verify
 *   additive rows → OneTab/URL text imports → encrypted-mode UI.
 *
 * Prereqs: `npm run build`. Run: `npx tsx e2e/io.ts`
 */

import path from 'path';
import fs from 'fs';
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

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

interface ExportResult {
  bundle: { format: string; counts: { sessions: number; tabs: number; groups: number } };
  bytes: number;
  json: string;
}
interface ImportResult {
  source: string;
  sessions: number;
  tabs: number;
  groups: number;
  error?: string;
}

/** Click the sidebar section whose label matches, in the options page. */
async function openSection(page: Page, label: string) {
  await page.evaluate((text) => {
    const btn = [...document.querySelectorAll('nav[aria-label="Settings sections"] button')].find(
      (b) => b.textContent?.trim() === text,
    );
    (btn as HTMLButtonElement | undefined)?.click();
  }, label);
  await page.waitForTimeout(400);
}

async function main() {
  const userDataDir = createUserDataDir();
  const downloadDir = fs.mkdtempSync(path.join(userDataDir, 'dl-'));
  let context: BrowserContext | null = null;

  try {
    context = await launchContext(userDataDir);
    const extId = await getExtId(context);
    await closeOnboardingTab(context, extId);

    const page = await openExtensionPage(context, extId, 'index.html');

    // ── Seed a session with two tabs ──
    const win = await createWindow(page);
    await addTab(page, win, 'https://example.com/one');
    await addTab(page, win, 'https://example.com/two');

    const sessions0 = await querySW<Session[]>(page, { type: 'getSessions' });

    // The window handler waits briefly for Chrome to populate tabs before
    // creating the session (so restore matching can run), so poll for it.
    let seedSession = sessions0.find((s) => s.windowId === win);
    await waitFor(async () => {
      const list = await querySW<Session[]>(page, { type: 'getSessions' });
      seedSession = list.find((s) => s.windowId === win);
      return Boolean(seedSession);
    }, 15000, 300, 'session created for the new window');

    await waitFor(async () => {
      const tabs = await querySW<Tab[]>(page, {
        type: 'getSessionTabs',
        sessionId: seedSession!.id,
      });
      return (
        Array.isArray(tabs) &&
        tabs.some((t) => t.url === 'https://example.com/one') &&
        tabs.some((t) => t.url === 'https://example.com/two')
      );
    }, 20000, 400, 'seed tabs persisted');

    // ── Export via the bus (contract check) ──
    const exported = await querySW<ExportResult>(page, { type: 'exportData' });
    check(
      'exportData returns a valid bundle',
      exported?.bundle?.format === 'tabbary-export' && exported.bundle.counts.tabs >= 2,
      `sessions=${exported?.bundle?.counts.sessions} tabs=${exported?.bundle?.counts.tabs} bytes=${exported?.bytes}`,
    );

    // ── Export through the UI: a real browser download ──
    const opts = await openExtensionPage(context, extId, 'options.html');
    await openSection(opts, 'Import & export');

    const [download] = await Promise.all([
      opts.waitForEvent('download', { timeout: 15000 }),
      opts.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) =>
          b.textContent?.includes('Export JSON'),
        );
        (btn as HTMLButtonElement | undefined)?.click();
      }),
    ]);

    const saved = path.join(downloadDir, download.suggestedFilename());
    await download.saveAs(saved);

    const stat = fs.statSync(saved);
    check(
      'Export JSON downloads a file',
      stat.size > 0 && saved.endsWith('.json'),
      `${download.suggestedFilename()} (${stat.size} bytes)`,
    );

    const onDisk = JSON.parse(fs.readFileSync(saved, 'utf8')) as {
      format: string;
      counts: { tabs: number };
      sessions: { tabs: { url: string }[] }[];
    };
    check(
      'downloaded file is a tabbary bundle',
      onDisk.format === 'tabbary-export' && onDisk.counts.tabs >= 2,
      `tabs=${onDisk.counts.tabs}`,
    );
    check(
      'downloaded file contains the seeded URLs',
      JSON.stringify(onDisk).includes('https://example.com/two'),
    );

    // ── Import that file back through the file input ──
    const before = await querySW<Session[]>(page, { type: 'getSessions' });
    await opts.setInputFiles('input[type="file"]', saved);
    await opts.waitForTimeout(1800);

    const after = await querySW<Session[]>(page, { type: 'getSessions' });
    check(
      'importing the file is additive',
      after.length > before.length,
      `${before.length} → ${after.length} sessions`,
    );

    const imported = after.find((s) => !before.some((b) => b.id === s.id));
    check('imported session exists', Boolean(imported));
    check(
      'imported session is closed and unbound',
      imported?.state === 'closed' && imported?.windowId === null,
      `state=${imported?.state} windowId=${imported?.windowId}`,
    );

    const importedTabs = imported
      ? await querySW<Tab[]>(page, { type: 'getSessionTabs', sessionId: imported.id })
      : [];
    check(
      'imported tabs keep their URLs',
      importedTabs.some((t) => t.url === 'https://example.com/one') &&
        importedTabs.some((t) => t.url === 'https://example.com/two'),
      `${importedTabs.length} tabs`,
    );

    const panelText = await opts.evaluate(() => document.body.innerText);
    check(
      'UI reports a successful import',
      /Imported \d+ sessions/.test(panelText),
      panelText.match(/Imported \d+ sessions[^\n]*/)?.[0],
    );

    // ── Foreign formats over the bus ──
    const oneTab = await querySW<ImportResult>(page, {
      type: 'importData',
      text: 'https://a.test\tTitle A\nhttps://b.test\tTitle B',
    });
    check(
      'OneTab text imports',
      oneTab?.source === 'onetab' && oneTab.tabs === 2,
      `source=${oneTab?.source} tabs=${oneTab?.tabs}`,
    );

    const urls = await querySW<ImportResult>(page, {
      type: 'importData',
      text: 'https://c.test\nhttps://d.test\nhttps://c.test',
    });
    check(
      'plain URL list imports and de-duplicates',
      urls?.source === 'urls' && urls.tabs === 2,
      `source=${urls?.source} tabs=${urls?.tabs}`,
    );

    const junk = await querySW<ImportResult>(page, { type: 'importData', text: 'hello world' });
    check('junk input is rejected cleanly', Boolean(junk?.error), junk?.error);

    // ── Encrypted-mode UI ──
    await openSection(opts, 'Import & export');
    await opts.evaluate(() => {
      const radios = [
        ...document.querySelectorAll<HTMLInputElement>('input[name="export-format"]'),
      ];
      radios.find((r) => r.value === 'encrypted')?.click();
    });
    await opts.waitForTimeout(400);

    const encUi = await opts.evaluate(() => {
      const text = document.body.innerText;
      return {
        hasPassphrase: Boolean(document.querySelector('input[type="password"]')),
        mentionsKdf: text.includes('PBKDF2'),
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    check('encrypted mode reveals the passphrase field', encUi.hasPassphrase);
    check('encrypted mode documents the KDF', encUi.mentionsKdf);
    check('panel has no horizontal overflow', encUi.overflowX === 0, `overflowX=${encUi.overflowX}`);

  } finally {
    await context?.close().catch(() => {});
    fs.rmSync(downloadDir, { recursive: true, force: true });
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
