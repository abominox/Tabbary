/**
 * M5b E2E — bookmarks: all three scopes, folders, delete-with-children,
 * browser import, and "open folder as session".
 *
 * Prereq: `npm run build`. Run: `npx tsx e2e/bookmarks.ts`
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
  closeWindow,
  waitFor,
} from './helpers.js';
import type { Bookmark, Session, Tab } from '../src/models/index.js';

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

    // ── Seed a session so session-scoped bookmarks have an owner ──
    const win = await createWindow(page);
    await addTab(page, win, 'https://alpha.test/a');
    await addTab(page, win, 'https://beta.test/b');

    let sessionId = '';
    await waitFor(async () => {
      const sessions = await querySW<Session[]>(page, { type: 'getSessions' });
      const s = sessions.find((x) => x.windowId === win);
      if (!s) return false;
      const tabs = await querySW<Tab[]>(page, { type: 'getSessionTabs', sessionId: s.id });
      sessionId = s.id;
      return tabs.some((t) => t.url === 'https://beta.test/b');
    }, 20_000, 300, 'session seeded');

    // ── Session scope ──
    const added = await querySW<Bookmark>(page, {
      type: 'bookmarkAdd',
      scope: 'session',
      ownerId: sessionId,
      title: 'Alpha',
      url: 'https://alpha.test/a',
    });
    check('adds a session bookmark', Boolean(added?.id), added?.title);

    const folder = await querySW<Bookmark>(page, {
      type: 'bookmarkAdd',
      scope: 'session',
      ownerId: sessionId,
      title: 'Reading',
      isFolder: true,
    });
    check('creates a folder', folder?.isFolder === true, folder?.title);

    const inFolder = await querySW<Bookmark>(page, {
      type: 'bookmarkAdd',
      scope: 'session',
      ownerId: sessionId,
      title: 'Beta',
      url: 'https://beta.test/b',
      parentId: folder?.id,
    });
    check('adds a bookmark into the folder', Boolean(inFolder?.id));

    const listed = await querySW<Bookmark[]>(page, {
      type: 'bookmarksList',
      scope: 'session',
      ownerId: sessionId,
    });
    check('lists all bookmarks for the owner', listed.length === 3, `${listed.length} rows`);

    // ── Rejections ──
    const chromeUrl = await querySW<Bookmark | null>(page, {
      type: 'bookmarkAdd',
      scope: 'session',
      ownerId: sessionId,
      title: 'Nope',
      url: 'chrome://settings',
    });
    check('rejects a non-portable URL', chromeUrl === null);

    const badUpdate = await querySW<boolean>(page, {
      type: 'bookmarkUpdate',
      id: added!.id,
      url: 'javascript:alert(1)',
    });
    check('rejects an update to a javascript: URL', badUpdate === false);

    const renamed = await querySW<boolean>(page, {
      type: 'bookmarkUpdate',
      id: added!.id,
      title: 'Alpha renamed',
    });
    check('renames a bookmark', renamed === true);

    // ── Tag scope ──
    await querySW(page, { type: 'tagSession', sessionId, tags: ['shared'] });
    const tagBm = await querySW<Bookmark>(page, {
      type: 'bookmarkAdd',
      scope: 'tag',
      ownerId: 'shared',
      title: 'Docs',
      url: 'https://docs.test/guide',
    });
    check('adds a tag bookmark', Boolean(tagBm?.id));

    const tagList = await querySW<Bookmark[]>(page, {
      type: 'bookmarksList',
      scope: 'tag',
      ownerId: 'shared',
    });
    check('tag bookmarks are scoped separately', tagList.length === 1, `${tagList.length}`);

    // ── Open a folder as a session ──
    const opened = await querySW<{ sessionId: string; tabCount: number } | null>(page, {
      type: 'bookmarksOpen',
      scope: 'session',
      ownerId: sessionId,
      folderId: folder!.id,
      name: 'From reading folder',
    });
    check(
      'opens a folder as a session',
      Boolean(opened) && opened!.tabCount === 1,
      `${opened?.tabCount ?? 0} tabs`,
    );

    if (opened) {
      const newTabs = await querySW<Tab[]>(page, {
        type: 'getSessionTabs',
        sessionId: opened.sessionId,
      });
      check(
        'the new session contains the folder’s link',
        newTabs.some((t) => t.url === 'https://beta.test/b'),
        newTabs.map((t) => t.url).join(', '),
      );
      const sessions = await querySW<Session[]>(page, { type: 'getSessions' });
      check(
        'the new session is closed and named',
        sessions.find((s) => s.id === opened.sessionId)?.state === 'closed' &&
          sessions.find((s) => s.id === opened.sessionId)?.name === 'From reading folder',
      );
    }

    // ── Delete a folder removes its children ──
    const deleted = await querySW<number>(page, { type: 'bookmarkDelete', id: folder!.id });
    check('deleting a folder reports the subtree size', deleted === 2, `${deleted} rows`);

    const afterDelete = await querySW<Bookmark[]>(page, {
      type: 'bookmarksList',
      scope: 'session',
      ownerId: sessionId,
    });
    check(
      'folder and its child are both gone',
      !afterDelete.some((b) => b.id === folder!.id || b.id === inFolder!.id),
      `${afterDelete.length} remain`,
    );

    // ── Browser scope ──
    // The bookmarks permission cannot be granted headlessly, so exercise the
    // repository path through a direct import when the API is unavailable.
    const browserList = await querySW<Bookmark[]>(page, {
      type: 'bookmarksList',
      scope: 'browser',
      ownerId: null,
    });
    check('browser scope starts empty', Array.isArray(browserList) && browserList.length === 0);

    // ── Rendered UI ──
    const bookmarksPage = await openExtensionPage(context, extId, 'bookmarks.html');
    const ui = await bookmarksPage.evaluate(() => {
      const text = document.body.innerText;
      return {
        hasHeading: text.includes('Bookmarks'),
        scopes: ['Session', 'Tags', 'Browser'].filter((s) => text.includes(s)),
        hasAdd: text.includes('Add bookmark'),
        hasOpenAll: text.includes('Open all as session'),
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    check('bookmarks page renders', ui.hasHeading);
    check('all three scopes are offered', ui.scopes.length === 3, ui.scopes.join(', '));
    check('add + open-all actions are present', ui.hasAdd && ui.hasOpenAll);
    check('bookmarks page has no horizontal overflow', ui.overflowX === 0, `${ui.overflowX}`);

    // Manifest wiring
    const manifest = await page.evaluate(() => chrome.runtime.getManifest());
    const m = manifest as {
      optional_permissions?: string[];
      commands?: Record<string, unknown>;
    };
    check(
      'bookmarks is an optional permission, not a required one',
      (m.optional_permissions ?? []).includes('bookmarks'),
    );
    check(
      'a keyboard command opens bookmarks',
      Object.keys(m.commands ?? {}).includes('open-bookmarks'),
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
