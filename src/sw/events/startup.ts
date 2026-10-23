// Startup + install handlers: restore sessions, initialize settings, rebuild caches.

import { sessionsRepo, settingsRepo, tabsRepo } from '@/db';
import { swCache } from '../cache';
import { broadcast } from '@/messaging';

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
}

/** Common startup logic: rebuild caches, restore closed sessions. */
async function initStartup(): Promise<void> {
  await rebuildCache();
  await restoreClosedSession();
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

/** If settings say 'yes', restore the single most recently closed session. */
async function restoreClosedSession(): Promise<void> {
  try {
    const settings = await settingsRepo.get();
    if (settings.restoreOnStartup === 'no') return;

    // If there are already active sessions (browser restored its own tabs), don't double-restore
    const existingActive = await sessionsRepo.listActive();
    if (existingActive.length > 0) return;

    // Restore the single most recently closed session
    const closed = await sessionsRepo.listClosed({ limit: 1 });
    if (closed.length === 0) return;

    const session = closed[0]!;
    const tabs = await tabsRepo.listBySession(session.id);
    if (tabs.length === 0) return;

    const urls = tabs.map(t => t.url).filter(Boolean);
    if (urls.length === 0) return;

    // Reopen tabs in a new window
    const newWindow = await chrome.windows.create({ url: urls });

    if (newWindow.id !== undefined) {
      await sessionsRepo.markActive(session.id, newWindow.id);
      swCache.bindWindow(newWindow.id, session.id);
      console.log(`[Windrow SW] restored session: ${session.id} (${tabs.length} tabs)`);
    }
  } catch (err) {
    console.error('[Windrow SW] restore error:', err);
  }
}