// Window event handlers: bind/unbind sessions to windows.

import { sessionsRepo } from '@/db';
import { uuid } from '@/lib';
import { swCache } from '../cache';
import { requestSaveSession } from '../autosave';
import { broadcast } from '@/messaging';

function now(): number {
  return Date.now();
}

/** Register all window listeners. Called synchronously from index.ts on SW load. */
export function registerWindowListeners(): void {
  // ── onCreated: bind a new session ──
  chrome.windows.onCreated.addListener(async (window) => {
    if (window.id === undefined || window.id === chrome.windows.WINDOW_ID_NONE) return;
    // Chrome fires onCreated for all windows (popups, devtools). Only bind tab windows.
    if (window.type !== undefined && window.type !== 'normal') return;

    console.log('[Windrow SW] window created:', window.id);

    const sessionId = uuid();
    const ts = now();

    await sessionsRepo.create({
      id: sessionId,
      name: null,
      windowId: window.id,
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

    swCache.bindWindow(window.id, sessionId);
    broadcast({ type: 'sessionsChanged' });
  });

  // ── onRemoved: unbind and close the session ──
  chrome.windows.onRemoved.addListener(async (windowId) => {
    const sessionId = swCache.getSessionForWindow(windowId);
    if (!sessionId) return;

    console.log('[Windrow SW] window removed:', windowId, 'session:', sessionId);

    await sessionsRepo.markClosed(sessionId);
    swCache.unbindWindow(windowId);
    broadcast({ type: 'sessionsChanged' });
  });

  // ── onFocusChanged: track focus for future use (stub for M1) ──
  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;
    // For M1, just a no-op that keeps the event bus alive.
    // Future: update `active` tab in the session, or update a focused session indicator.
    console.log('[Windrow SW] window focus changed:', windowId);
  });
}