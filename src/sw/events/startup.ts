// Startup + install handlers: restore sessions, initialize settings, rebuild caches.

import { sessionsRepo, settingsRepo, tabsRepo } from '@/db';
import { swCache } from '../cache';
import { broadcast } from '@/messaging';
import {
  matchWindowsToSessions,
  unmatchedSessions,
  type MatchSession,
  type MatchWindow,
} from '@/lib/restore';
import { markStartupRestoreWindow } from './windows';

/**
 * What the last startup decided, so the UI can explain itself instead of
 * silently restoring the wrong things.
 */
export interface RestoreReport {
  at: number;
  strategy: 'matched' | 'restored-last' | 'ask' | 'none' | 'skipped';
  matched: { sessionId: string; windowId: number; score: number }[];
  restoredSessionId: string | null;
  restoredTabs: number;
  closedLeftUnrestored: number;
  reason?: string;
}

let lastReport: RestoreReport | null = null;

export function getRestoreReport(): RestoreReport | null {
  return lastReport;
}

/** Register all startup/install listeners. Called synchronously from index.ts on SW load. */
export function registerStartupListeners(): void {
  // ── onInstalled: first-run onboarding, settings init ──
  chrome.runtime.onInstalled.addListener(async (details) => {
    console.log('[Windrow SW] onInstalled:', details.reason);

    if (details.reason === 'install') {
      // Ensure settings are initialized
      await settingsRepo.get();

      // Open onboarding page
      chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
    }

    if (details.reason === 'update') {
      // Future: migrate logic here
      console.log('[Windrow SW] updated from', details.previousVersion);
    }

    // On any install/update, rebuild caches and sync
    await initStartup();
  });

  // ── onStartup: restore sessions and rebuild caches ──
  chrome.runtime.onStartup.addListener(async () => {
    console.log('[Windrow SW] onStartup');
    await initStartup();
  });

  // ── onCreated for the very first window (Cold start) ──
  // Chrome dispatches onStartup before windows exist; matching runs there and
  // binds whatever is already open. Anything Chrome reopens afterwards is
  // captured as a new session by windows.onCreated, which is the safe default.
  chrome.windows.onCreated.addListener(() => {
    if (lastReport?.strategy === 'none') void initStartup();
  });
}

/** Common startup logic: rebuild caches, match/restore sessions. */
async function initStartup(): Promise<void> {
  await rebuildCache();
  // Open the grace period before matching: Chrome reopens windows asynchronously
  // after onStartup, and windows.ts claims them during this window.
  markStartupRestoreWindow();
  await restoreOnStartup();
  broadcast({ type: 'sessionsChanged' });
}

/** Rebuild the in-memory window↔session cache from DB. */
async function rebuildCache(): Promise<void> {
  try {
    const active = await sessionsRepo.listActive();
    swCache.rebuildFromActiveSessions(active);
    console.log(`[Windrow SW] cache rebuilt: ${active.length} active sessions`);
  } catch (err) {
    console.error('[Windrow SW] cache rebuild error:', err);
  }
}

/**
 * Restore-on-startup, in order of least surprise:
 *
 * 1. `no`   — do nothing.
 * 2. `ask`  — do nothing automatically; the UI surfaces a restore prompt.
 * 3. default — first *match* live windows against recorded sessions, so a
 *    window Chrome already reopened keeps its history instead of appearing as a
 *    brand-new session. Then, if nothing is live, restore the most recently
 *    closed session (the previous behaviour).
 */
async function restoreOnStartup(): Promise<void> {
  const report: RestoreReport = {
    at: Date.now(),
    strategy: 'none',
    matched: [],
    restoredSessionId: null,
    restoredTabs: 0,
    closedLeftUnrestored: 0,
  };

  try {
    const settings = await settingsRepo.get();

    if (settings.restoreOnStartup === 'no') {
      lastReport = { ...report, strategy: 'skipped', reason: 'restore-on-startup is set to no' };
      return;
    }

    if (settings.restoreOnStartup === 'ask') {
      lastReport = { ...report, strategy: 'ask', reason: 'waiting for the user to choose' };
      console.log('[Windrow SW] restore-on-startup = ask; not restoring automatically');
      return;
    }

    const closed = await sessionsRepo.listClosed();
    if (closed.length === 0) {
      lastReport = { ...report, strategy: 'none', reason: 'no closed sessions' };
      return;
    }

    // ── 1. Match windows Chrome already reopened ──
    const liveWindows = await chrome.windows.getAll({ populate: true });
    const windowShapes: MatchWindow[] = liveWindows
      .filter((w) => w.id !== undefined && w.type === 'normal' && (w.tabs?.length ?? 0) > 0)
      .map((w) => ({
        windowId: w.id!,
        tabs: (w.tabs ?? []).map((t) => ({ url: t.url ?? '', title: t.title })),
      }));

    const sessionShapes: MatchSession[] = [];
    for (const s of closed) {
      const tabs = await tabsRepo.listBySession(s.id);
      if (tabs.length > 0) {
        sessionShapes.push({
          id: s.id,
          name: s.name,
          tabs: tabs.map((t) => ({ url: t.url, title: t.title, pinned: t.pinned })),
        });
      }
    }

    const matches = matchWindowsToSessions(sessionShapes, windowShapes);

    for (const m of matches) {
      const session = await sessionsRepo.get(m.sessionId);
      // Never hijack a window that is already active under another session.
      if (swCache.getSessionForWindow(m.windowId)) continue;
      if (!session || session.state !== 'closed') continue;

      await sessionsRepo.markActive(m.sessionId, m.windowId);
      swCache.bindWindow(m.windowId, m.sessionId);
      report.matched.push({ sessionId: m.sessionId, windowId: m.windowId, score: m.score });
      console.log(
        `[Windrow SW] matched session ${m.sessionId} to window ${m.windowId} (score ${m.score})`,
      );
    }

    if (matches.length > 0) {
      report.strategy = 'matched';
      report.closedLeftUnrestored = unmatchedSessions(sessionShapes, matches).length;
      lastReport = report;
      return;
    }

    // ── 2. Nothing matched: restore the most recent closed session ──
    const existingActive = await sessionsRepo.listActive();
    if (existingActive.length > 0) {
      lastReport = {
        ...report,
        strategy: 'none',
        reason: 'windows are already open, and none matched a session',
      };
      return;
    }

    const session = closed[0]!;
    const tabs = await tabsRepo.listBySession(session.id);
    const urls = tabs.map((t) => t.url).filter(Boolean);
    if (urls.length === 0) {
      lastReport = { ...report, strategy: 'none', reason: 'most recent session has no tabs' };
      return;
    }

    const newWindow = await chrome.windows.create({ url: urls });
    if (newWindow.id !== undefined) {
      await sessionsRepo.markActive(session.id, newWindow.id);
      swCache.bindWindow(newWindow.id, session.id);
      lastReport = {
        ...report,
        strategy: 'restored-last',
        restoredSessionId: session.id,
        restoredTabs: urls.length,
      };
      console.log(`[Windrow SW] restored session: ${session.id} (${tabs.length} tabs)`);
    } else {
      lastReport = { ...report, strategy: 'none', reason: 'could not create a window' };
    }
  } catch (err) {
    console.error('[Windrow SW] restore error:', err);
    lastReport = { ...report, strategy: 'none', reason: (err as Error).message };
  }
}
