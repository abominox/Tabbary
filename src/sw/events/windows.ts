// Window event handlers: bind/unbind sessions to windows.

import { sessionsRepo, tabsRepo } from '@/db';
import { uuid } from '@/lib';
import { matchWindowsToSessions } from '@/lib/restore';
import { swCache } from '../cache';
import { requestSaveSession } from '../autosave';
import { broadcast } from '@/messaging';

function now(): number {
  return Date.now();
}

/**
 * How long after startup a newly created window may still be claimed by a
 * recorded session. Chrome reopens windows asynchronously after onStartup, so a
 * bounded window is the only reliable signal that a window is part of a
 * restore rather than something the user just opened.
 */
const STARTUP_MATCH_GRACE_MS = 20_000;
let startupGraceUntil = 0;

/** Called from startup.ts once restore matching has run. */
export function markStartupRestoreWindow(): void {
  startupGraceUntil = now() + STARTUP_MATCH_GRACE_MS;
}

/** Register all window listeners. Called synchronously from index.ts on SW load. */
export function registerWindowListeners(): void {
  // ── onCreated: bind an existing session if this window restores one ──
  chrome.windows.onCreated.addListener(async (window) => {
    if (window.id === undefined || window.id === chrome.windows.WINDOW_ID_NONE) return;
    // Chrome fires onCreated for all windows (popups, devtools). Only bind tab windows.
    if (window.type !== undefined && window.type !== 'normal') return;

    // Tabs are not populated on the event object, so give Chrome a moment to
    // create them before deciding whether this window restores a session.
    await bindOrCreateSession(window.id);
  });

  // ── onRemoved: unbind and close the session ──
  chrome.windows.onRemoved.addListener(async (windowId) => {
    const sessionId = swCache.getSessionForWindow(windowId);
    if (!sessionId) return;

    console.log('[tabbary SW] window removed:', windowId, 'session:', sessionId);

    await sessionsRepo.markClosed(sessionId);
    swCache.unbindWindow(windowId);
    broadcast({ type: 'sessionsChanged' });
  });

  // ── onFocusChanged: track focus for future use ──
  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;
    console.log('[tabbary SW] window focus changed:', windowId);
  });
}

/**
 * Decide what a newly created window belongs to.
 *
 * Within the startup grace period we first try to match the window's tabs
 * against recorded closed sessions. This is what lets Chrome's own window
 * restore keep its history instead of appearing as a brand-new session.
 * Outside the grace period, or with no confident match, we create a new session.
 */
async function bindOrCreateSession(windowId: number): Promise<void> {
  const inGrace = now() < startupGraceUntil;

  // Let Chrome finish populating the window before inspecting it.
  await new Promise((resolve) => setTimeout(resolve, inGrace ? 300 : 120));

  // A concurrent handler may have bound it already.
  if (swCache.getSessionForWindow(windowId)) return;

  let tabs: chrome.tabs.Tab[] = [];
  try {
    tabs = await chrome.tabs.query({ windowId });
  } catch {
    return; // window already gone
  }

  if (inGrace && tabs.length > 0) {
    const match = await findMatchForWindow(windowId, tabs);
    if (match) {
      const session = await sessionsRepo.get(match.sessionId);
      if (session && session.state === 'closed') {
        await sessionsRepo.markActive(match.sessionId, windowId);
        swCache.bindWindow(windowId, match.sessionId);
        console.log(
          `[tabbary SW] window ${windowId} restored session ${match.sessionId} ` +
            `(score ${match.score})`,
        );
        // Capture the as-opened tab set so the session reflects reality.
        requestSaveSession(windowId);
        broadcast({ type: 'sessionsChanged' });
        return;
      }
    }
  }

  // ── No match: this is a genuinely new window ──
  const sessionId = uuid();
  const ts = now();

  await sessionsRepo.create({
    id: sessionId,
    name: null,
    windowId,
    state: 'active',
    mode: 'multi-window',
    tags: [],
    pinnedTabUrls: [],
    createdAt: ts,
    updatedAt: ts,
    closedAt: null,
    version: 1,
    deleted: false,
  });

  swCache.bindWindow(windowId, sessionId);

  // A new window usually already contains a tab (the URL passed to
  // windows.create, or the NTP). Nothing else schedules a save until the
  // next tab event, so capture the initial state now.
  requestSaveSession(windowId);

  broadcast({ type: 'sessionsChanged' });
}

/** Score this window's tabs against closed sessions and return the best hit. */
async function findMatchForWindow(
  windowId: number,
  tabs: chrome.tabs.Tab[],
): Promise<{ sessionId: string; score: number } | null> {
  try {
    const closed = await sessionsRepo.listClosed({ limit: 50 });
    if (closed.length === 0) return null;

    const shapes = [];
    for (const s of closed) {
      const stored = await tabsRepo.listBySession(s.id);
      if (stored.length === 0) continue;
      shapes.push({
        id: s.id,
        name: s.name,
        tabs: stored.map((t) => ({ url: t.url, title: t.title, pinned: t.pinned })),
      });
    }

    const matches = matchWindowsToSessions(shapes, [
      {
        windowId,
        tabs: tabs.map((t) => ({ url: t.url ?? '', title: t.title })),
      },
    ]);

    const best = matches[0];
    return best ? { sessionId: best.sessionId, score: best.score } : null;
  } catch (err) {
    console.warn('[tabbary SW] match failed:', err);
    return null;
  }
}
