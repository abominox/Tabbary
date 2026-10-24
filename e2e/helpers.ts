import { chromium, type BrowserContext, type Page, type Worker } from 'playwright';
import path from 'path';
import fs from 'fs';
import os from 'os';

const EXTENSION_PATH = path.resolve('dist');

/**
 * Create a temporary user data directory for a test.
 * Each test gets its own to simulate a clean profile.
 */
export function createUserDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'windrow-e2e-'));
}

/** Clean up a user data directory after a test (best-effort). */
export function cleanUserDataDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch { /* macOS .DS_Store may cause EPERM */ }
}

/**
 * Launch a persistent context with the unpacked extension loaded.
 *
 * Runs headless by default using Chromium's *new* headless shell
 * (`channel: 'chromium'`), which supports extensions. The old headless mode
 * (`headless: true` without a channel) does not load extensions at all.
 *
 * Set WINDROW_HEADED=1 to watch the run in a real window (useful when debugging).
 */
export async function launchContext(
  userDataDir: string,
  extensionPath: string = EXTENSION_PATH,
): Promise<BrowserContext> {
  const headed = process.env.WINDROW_HEADED === '1';

  return chromium.launchPersistentContext(userDataDir, {
    ...(headed ? { headless: false } : { headless: true, channel: 'chromium' }),
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
}

/**
 * Wait for the extension's service worker to come alive.
 * Throws if no service worker appears within the timeout.
 */
export async function waitForSW(context: BrowserContext, timeout = 15000): Promise<Worker> {
  const existing = context.serviceWorkers();
  if (existing.length > 0) return existing[0]!;
  return context.waitForEvent('serviceworker', { timeout });
}

/**
 * Get the extension ID from the service worker URL.
 */
export async function getExtId(context: BrowserContext): Promise<string> {
  const sw = await waitForSW(context);
  const url = sw.url(); // chrome-extension://<id>/service-worker-loader.js
  const hostname = new URL(url).hostname;
  if (!hostname || hostname === 'chrome-error') {
    throw new Error(`Could not parse extension ID from SW URL: ${url}`);
  }
  return hostname;
}

/**
 * Open an extension page (side panel, full-tab, or any extension HTML file).
 * Extension pages can use `chrome.runtime.sendMessage` to communicate with the SW.
 */
export async function openExtensionPage(
  context: BrowserContext,
  extId: string,
  pageName = 'sidepanel.html',
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/${pageName}`, { waitUntil: 'networkidle' });
  // Wait for React hydration + store's hydrate() bus call
  await page.waitForTimeout(2000);
  return page;
}

/**
 * Send a typed message to the service worker via `chrome.runtime.sendMessage`
 * from an extension page context. This tests the actual bus contract.
 */
export async function querySW<T = unknown>(page: Page, message: Record<string, unknown>): Promise<T> {
  return page.evaluate(async (msg) => {
    return await chrome.runtime.sendMessage(msg);
  }, message) as Promise<T>;
}

/**
 * Perform tasks inside the extension page context using `page.evaluate`.
 * This is a typed wrapper for extension-specific operations.
 */
export function extEval<T>(page: Page, fn: (...args: unknown[]) => T, ...args: unknown[]): Promise<T> {
  return page.evaluate(fn, args) as Promise<T>;
}

/**
 * Create a new browser window from an extension page context.
 * This triggers `windows.onCreated` in the SW, which creates a new Session
 * and binds it to the new window — essential since Playwright's existing window
 * pre-dates the SW listener registration.
 * Returns the window ID (chrome.windows.Window.id).
 */
export async function createWindow(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const win = await chrome.windows.create({ url: 'about:blank', state: 'minimized' });
    return win.id!;
  });
}

/**
 * Add tabs to a specific window from an extension page context.
 * This triggers `tabs.onCreated` → `requestSaveSession` → session persists tabs.
 */
export async function addTab(page: Page, windowId: number, url: string): Promise<void> {
  await page.evaluate(async ({ wid, tabUrl }) => {
    await chrome.tabs.create({ windowId: wid, url: tabUrl, active: false });
  }, { wid: windowId, tabUrl: url });
}

/**
 * Close a specific browser window (by window ID) from an extension page context.
 * Triggers `windows.onRemoved` in the SW → session marked closed.
 */
export async function closeWindow(page: Page, windowId: number): Promise<void> {
  await page.evaluate(async (wid: number) => {
    await chrome.windows.remove(wid);
  }, windowId);
}

/**
 * Query chrome.tabs in a specific window from an extension page context.
 */
export async function getWindowTabCount(page: Page, windowId: number): Promise<number> {
  return page.evaluate(async (wid: number) => {
    const tabs = await chrome.tabs.query({ windowId: wid });
    return tabs.length;
  }, windowId);
}

/**
 * Close all pages and context, then clean up the user data dir.
 */
export async function cleanup(context: BrowserContext, userDataDir?: string): Promise<void> {
  try {
    await context.close();
  } catch { /* ignore */ }
  if (userDataDir) cleanUserDataDir(userDataDir);
}

/**
 * Poll a predicate until it returns true or timeout.
 */
export async function waitFor(
  fn: () => boolean | Promise<boolean>,
  timeout = 10000,
  interval = 500,
  label = 'condition',
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return;
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error(`waitFor('${label}') timed out after ${timeout}ms`);
}

/**
 * Poll a query until it returns a defined non-null value or timeout.
 */
export async function pollQuery<T>(
  page: Page,
  message: Record<string, unknown>,
  extract: (result: T) => boolean,
  timeout = 10000,
  interval = 500,
  label = 'bus query',
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await querySW<T>(page, message);
    if (extract(result)) return result;
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error(`pollQuery('${label}') timed out after ${timeout}ms`);
}

/** Close the onboarding tab if present (created by onInstalled). */
export async function closeOnboardingTab(context: BrowserContext, extId: string): Promise<void> {
  for (const p of context.pages()) {
    const url = p.url();
    if (url === `chrome-extension://${extId}/onboarding.html`) {
      await p.close();
    }
  }
}

/** Collect console output from the service worker (for debugging E2E runs). */
export function swLogs(context: BrowserContext): string[] {
  const lines: string[] = [];
  const worker = context.serviceWorkers()[0];
  if (!worker) return lines;
  worker.on('console', (msg) => lines.push(`[${msg.type()}] ${msg.text()}`));
  return lines;
}
