/**
 * M4 E2E — two independent browser profiles syncing through a real server.
 *
 * Driven through the actual Settings UI, because host-permission grants require
 * a user gesture and therefore cannot be triggered by a bare message call.
 *
 * Profile A creates the account and pushes a session; profile B joins with the
 * passphrase and pulls it; B edits and pushes; A pulls the edit.
 *
 * Prereqs: `npm run build`. Run: `npx tsx e2e/sync.ts`
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import { buildE2EExtension } from './build-ext.js';
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
  closeWindow,
  waitFor,
} from './helpers.js';
import type { Session, Tab } from '../src/models/index.js';

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const PAIRING_SECRET = 'e2e-pairing-secret-please-change';
const PASSPHRASE = 'correct horse battery staple';
const PORT = 30_000 + Math.floor(Math.random() * 10_000);
const BASE = `http://127.0.0.1:${PORT}`;

let server: ChildProcess | null = null;
let serverLog = '';

async function startServer(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'windrow-sync-e2e-'));
  server = spawn(process.execPath, [path.resolve('server/index.mjs')], {
    env: {
      ...process.env,
      WINDROW_PAIRING_SECRET: PAIRING_SECRET,
      WINDROW_DB: path.join(dir, 'sync.db'),
      PORT: String(PORT),
      HOST: '127.0.0.1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', (d) => (serverLog += String(d)));
  server.stderr?.on('data', (d) => (serverLog += String(d)));

  const start = Date.now();
  while (Date.now() - start < 15_000) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return dir;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`server failed to start: ${serverLog}`);
}

async function seedSession(page: Page, name: string, urls: string[]): Promise<string> {
  const win = await createWindow(page);
  for (const url of urls) await addTab(page, win, url);

  let sessionId = '';
  await waitFor(async () => {
    const sessions = await querySW<Session[]>(page, { type: 'getSessions' });
    const s = sessions.find((x) => x.windowId === win);
    if (!s) return false;
    const tabs = await querySW<Tab[]>(page, { type: 'getSessionTabs', sessionId: s.id });
    sessionId = s.id;
    return urls.every((u) => tabs.some((t) => t.url === u));
  }, 20_000, 300, 'session seeded');

  await querySW(page, { type: 'renameSession', sessionId, name });
  await closeWindow(page, win);
  await waitFor(async () => {
    const sessions = await querySW<Session[]>(page, { type: 'getSessions' });
    return sessions.find((s) => s.id === sessionId)?.state === 'closed';
  }, 15_000, 300, 'session closed');

  return sessionId;
}

/** Open Settings → Sync & backup in a page. */
async function openSyncSettings(page: Page) {
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('nav[aria-label="Settings sections"] button')].find(
      (b) => b.textContent?.trim() === 'Sync & backup',
    );
    (btn as HTMLButtonElement | undefined)?.click();
  });
  await page.waitForTimeout(400);
}

/** Fill a labelled input inside the sync panel by its visible label text. */
async function fillField(page: Page, label: string, value: string) {
  const labelArg = JSON.stringify(label);
  const valueArg = JSON.stringify(value);
  await page.evaluate(`(() => {
    const label = ${labelArg};
    const value = ${valueArg};
    const clean = (s) => (s || '')
      .replace(/[\\u200B-\\u200D\\uFEFF\\u00AD]/g, '')
      .replace(/\\s+/g, ' ')
      .trim();
    const labels = Array.from(document.querySelectorAll('label'));
    const match = labels.find((l) => clean(l.textContent).startsWith(label));
    const input = match && match.querySelector('input, textarea');
    if (!input) throw new Error('field not found: ' + label);
    const proto = input.tagName === 'TEXTAREA'
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await page.waitForTimeout(80);
}

/** Click a button by its exact visible text. */
// Passed as source text: tsx/esbuild injects a `__name` helper into function
// expressions, which does not exist in the page.
async function clickButton(page: Page, text: string) {
  const arg = JSON.stringify(text);
  await page.evaluate(`(() => {
    const text = ${arg};
    // Strip zero-width and soft-hyphen characters too: React inserts comment
    // nodes between text spans, which can leave invisible separators behind.
    const norm = (s) => (s || '')
      .replace(/[\\u200B-\\u200D\\uFEFF\\u00AD]/g, '')
      .replace(/\\s+/g, ' ')
      .trim();
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn =
      buttons.find((b) => norm(b.textContent) === text) ||
      buttons.find((b) => norm(b.textContent).startsWith(text));
    if (!btn) {
      throw new Error('button not found: ' + text + ' — saw: ' +
        '(' + buttons.map((b) => norm(b.textContent)).filter(Boolean).join(' | ') + ')');
    }
    btn.click();
  })()`);
  await page.waitForTimeout(400);
}

async function syncState(page: Page) {
  return querySW<{
    configured: boolean;
    enabled: boolean;
    cursor: number;
    fingerprint: string | null;
    endpoint: string | null;
    lastError: string | null;
  }>(page, { type: 'syncState' });
}

async function main() {
  const dbDir = await startServer();
  // Headless Chromium cannot show a permission prompt, so the test extension
  // has the sync origin as a required permission (the state a user reaches
  // after accepting it once). The shipped manifest keeps it optional.
  const extPath = buildE2EExtension(BASE);
  const dirA = createUserDataDir();
  const dirB = createUserDataDir();
  let ctxA: BrowserContext | null = null;
  let ctxB: BrowserContext | null = null;

  try {
    // ══ Profile A: create via the UI ══
    ctxA = await launchContext(dirA, extPath);
    const extA = await getExtId(ctxA);
    // (service-worker logs are surfaced on failure below)
    await closeOnboardingTab(ctxA, extA);
    const pageA = await openExtensionPage(ctxA, extA, 'index.html');

    await seedSession(pageA, 'Alpha research', [
      'https://alpha.test/one',
      'https://alpha.test/two',
    ]);

    const optsA = await openExtensionPage(ctxA, extA, 'options.html');
    await openSyncSettings(optsA);
    await clickButton(optsA, 'Set up a new server');

    await fillField(optsA, 'Server URL', BASE);
    await fillField(optsA, 'Pairing secret', PAIRING_SECRET);
    await fillField(optsA, 'Encryption passphrase', PASSPHRASE);
    await fillField(optsA, 'Device name', 'Profile A');
    await clickButton(optsA, 'Create sync account');
    // Setup derives a 600k-iteration key and pushes the existing library.
    try {
      await optsA.waitForFunction(
        () => document.body.innerText.includes('Save your recovery phrase'),
        undefined,
        { timeout: 30_000 },
      );
    } catch {
      const dbg = await optsA.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button')).map((b) => ({
          text: (b.textContent || '').replace(/\s+/g, ' ').trim(),
          disabled: b.disabled,
        }));
        return { btns, url: location.href };
      });
      console.log('DEBUG state A:', JSON.stringify(await syncState(pageA)));
      console.log('DEBUG UI logs:', uiLogs.slice(-10).join('\n'));
    }

    const phraseText = await optsA.evaluate(() => document.body.innerText);
    const hasPhraseScreen = phraseText.includes('Save your recovery phrase');
    check('setup reaches the recovery-phrase screen', hasPhraseScreen);

    // Count the words actually rendered.
    const wordCount = await optsA.evaluate(() => {
      const list = document.querySelectorAll('ol li');
      return list.length;
    });
    check('recovery screen lists 24 words', wordCount === 24, `${wordCount} words`);

    // Confirm the checkbox and continue (required before sync is "done").
    await optsA.evaluate(() => {
      const box = document.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      box?.click();
    });
    await optsA.waitForTimeout(150);
    await clickButton(optsA, 'Continue');
    await optsA.waitForTimeout(800);

    const statusA = await syncState(pageA);
    check('profile A reports configured and enabled', statusA.configured && statusA.enabled);
    check('profile A advanced past revision 0', statusA.cursor > 0, `cursor=${statusA.cursor}`);
    check('profile A has a key fingerprint', Boolean(statusA.fingerprint), statusA.fingerprint ?? '');

    const health = (await (await fetch(`${BASE}/health`)).json()) as { ok: boolean; blobs: number };
    check('server received blobs', health.ok && health.blobs >= 2, `${health.blobs} blobs`);

    // ══ Profile B: join via the UI ══
    ctxB = await launchContext(dirB, extPath);
    const extB = await getExtId(ctxB);
    await closeOnboardingTab(ctxB, extB);
    const pageB = await openExtensionPage(ctxB, extB, 'index.html');

    check(
      'profile B starts empty',
      (await querySW<Session[]>(pageB, { type: 'getSessions' })).length === 0,
    );

    const optsB = await openExtensionPage(ctxB, extB, 'options.html');
    await openSyncSettings(optsB);
    await clickButton(optsB, 'Join an existing one');

    await fillField(optsB, 'Server URL', BASE);
    await fillField(optsB, 'Pairing secret', PAIRING_SECRET);
    await fillField(optsB, 'Existing passphrase', PASSPHRASE);
    await fillField(optsB, 'Device name', 'Profile B');
    await clickButton(optsB, 'Connect this device');
    await optsB.waitForFunction(
      () => !document.body.innerText.includes('Working…'),
      undefined,
      { timeout: 30_000 },
    );

    const statusB = await syncState(pageB);
    check('profile B joins successfully', statusB.configured && statusB.enabled, statusB.lastError ?? '');
    check(
      'both devices derive the same key',
      Boolean(statusB.fingerprint) && statusB.fingerprint === statusA.fingerprint,
      `${statusB.fingerprint} vs ${statusA.fingerprint}`,
    );

    const pulled = (await querySW<Session[]>(pageB, { type: 'getSessions' })).find(
      (s) => s.name === 'Alpha research',
    );
    check('profile B pulled the session', Boolean(pulled), pulled?.name);

    const pulledTabs = pulled
      ? await querySW<Tab[]>(pageB, { type: 'getSessionTabs', sessionId: pulled.id })
      : [];
    check(
      'pulled session kept its tabs',
      pulledTabs.some((t) => t.url === 'https://alpha.test/one') &&
        pulledTabs.some((t) => t.url === 'https://alpha.test/two'),
      `${pulledTabs.length} tabs`,
    );

    // ══ B edits → A pulls ══
    if (pulled) {
      await querySW(pageB, { type: 'renameSession', sessionId: pulled.id, name: 'Renamed on B' });
      await querySW(pageB, { type: 'tagSession', sessionId: pulled.id, tags: ['from-b'] });

      const pushB = await querySW<{ ok: boolean; pushed?: number; errors?: string[] }>(pageB, {
        type: 'syncNow',
      });
      check('profile B pushes its edit', pushB?.ok === true, pushB?.errors?.join('; '));

      const pullA = await querySW<{ ok: boolean; pulled?: number; errors?: string[] }>(pageA, {
        type: 'syncNow',
      });
      check('profile A syncs', pullA?.ok === true, pullA?.errors?.join('; '));

      const onA = (await querySW<Session[]>(pageA, { type: 'getSessions' })).find(
        (s) => s.id === pulled.id,
      );
      check('the rename propagated back to A', onA?.name === 'Renamed on B', onA?.name ?? '(missing)');
      check(
        'the tag propagated back to A',
        (onA?.tags ?? []).includes('from-b'),
        (onA?.tags ?? []).join(',') || '(none)',
      );
    }

    // ══ Rejections ══
    const dirC = createUserDataDir();
    let ctxC: BrowserContext | null = null;
    try {
      ctxC = await launchContext(dirC, extPath);
      const extC = await getExtId(ctxC);
      await closeOnboardingTab(ctxC, extC);
      const optsC = await openExtensionPage(ctxC, extC, 'options.html');
      await openSyncSettings(optsC);
      await clickButton(optsC, 'Join an existing one');

      await fillField(optsC, 'Server URL', BASE);
      await fillField(optsC, 'Pairing secret', PAIRING_SECRET);
      await fillField(optsC, 'Existing passphrase', 'definitely the wrong passphrase');
      await clickButton(optsC, 'Connect this device');
      await optsC.waitForFunction(
        () => /wrong passphrase/i.test(document.body.innerText) || !document.body.innerText.includes('Working…'),
        undefined,
        { timeout: 30_000 },
      );

      const textC = await optsC.evaluate(() => document.body.innerText);
      check(
        'a wrong passphrase is rejected in the UI',
        /wrong passphrase/i.test(textC),
        textC.match(/[^\n]*wrong passphrase[^\n]*/i)?.[0] ?? '',
      );
      check(
        'profile C stays unconfigured',
        (await syncState(await openExtensionPage(ctxC, extC, 'index.html'))).configured === false,
      );
    } finally {
      await ctxC?.close().catch(() => {});
      cleanUserDataDir(dirC);
    }

    // ══ Server DB holds no plaintext ══
    const raw = fs.readFileSync(path.join(dbDir, 'sync.db'), 'latin1');
    const leaks = ['alpha.test', 'Alpha research', 'from-b'].filter((n) => raw.includes(n));
    check('server database contains no plaintext', leaks.length === 0, leaks.join(', '));

  } finally {
    await ctxA?.close().catch(() => {});
    await ctxB?.close().catch(() => {});
    cleanUserDataDir(dirA);
    cleanUserDataDir(dirB);
    if (server) {
      server.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 200));
    }
    fs.rmSync(dbDir, { recursive: true, force: true });
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
  if (serverLog) console.error(serverLog);
  process.exitCode = 1;
});
