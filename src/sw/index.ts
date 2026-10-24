// MV3 Service Worker — thin event router.
// Wires all event listeners, auto-save, message handlers, and alarms.

import { settingsRepo, sessionVersionsRepo } from '@/db';
import { registerWindowListeners } from './events/windows';
import { registerTabListeners } from './events/tabs';
import { registerTabGroupListeners } from './events/tabGroups';
import { registerStartupListeners } from './events/startup';
import { registerCommandListeners } from './events/commands';
import { registerBusHandlers } from './handlers';
import { cancelPendingSaves } from './autosave';
import { scheduleSyncAlarm, SYNC_POLL_ALARM, cancelSyncTimers } from '@/sync/scheduler';
import { BACKUP_ALARM, runBackup, scheduleBackupAlarm } from './backup-service';
import { handleSyncNow } from './sync-handlers';
import { broadcast } from '@/messaging';

// ──────────────────────────────────────────────
// All listeners MUST be registered synchronously
// at the top level of the SW module (MV3 requirement).
// ──────────────────────────────────────────────

// Register event handlers for windows, tabs, tab groups
registerWindowListeners();
registerTabListeners();
registerTabGroupListeners();

// Register startup/install lifecycle handlers
registerStartupListeners();

// Register keyboard command handlers
registerCommandListeners();

// Register bus message handlers (UI ↔ SW typed messages)
registerBusHandlers();

// ── Action surface ──
// M3: the toolbar button opens the popup (manifest `action.default_popup`), so
// the side panel needs its own entry point. A popup cannot close the panel and
// vice versa, so they are separate gestures:
//   click icon  → popup        (manifest default_popup)
//   Alt+A       → side panel   (command `open-side-panel`)
//   Alt+S       → full tab     (command `open-full-tab`)
//
// Do NOT call setPanelBehavior({openPanelOnActionClick:true}) while a
// default_popup is set: Chrome ignores the popup and the button appears dead.
chrome.action.onClicked.addListener(async (tab) => {
  // Only reached if the popup is removed from the manifest. Respect the
  // user's preferred surface rather than always assuming the side panel.
  const settings = await settingsRepo.get().catch(() => null);
  const surface = settings?.preferredSurface ?? 'sidepanel';
  console.log('[Windrow SW] action clicked →', surface);

  if (surface === 'sidepanel') {
    try {
      await chrome.sidePanel.open({ windowId: tab.windowId });
      return;
    } catch {
      /* fall through to a tab */
    }
  }
  if (surface === 'window') {
    await chrome.windows.create({
      url: chrome.runtime.getURL('window.html'),
      type: 'popup',
      width: 560,
      height: 760,
    });
    return;
  }
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
});

// ── Alarms ──
chrome.alarms.create('windrow-health', { periodInMinutes: 5 });

// Recreate the sync poll alarm from stored state on every SW start.
scheduleSyncAlarm().catch(() => {});

// Local backups: on by default, checked twice a day.
scheduleBackupAlarm()
  .then(() => runBackup())
  .catch((e) => console.warn('[Windrow SW] backup failed:', e));

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'windrow-health') {
    console.log('[Windrow SW] health alarm');
    settingsRepo.get().catch(() => {});
    // Enforce the global SessionVersion cap (500) — per-session pruning happens in
    // snapshot(); this periodic sweep is the cross-session safety net (PLAN §8).
    sessionVersionsRepo.pruneGlobal().catch((e: unknown) =>
      console.warn('[Windrow SW] pruneGlobal failed:', e),
    );
  }

  if (alarm.name === BACKUP_ALARM) {
    runBackup()
      .then((r) => {
        if (r.written.length > 0) {
          console.log(`[Windrow SW] backup written (${r.written.map((w) => w.tier).join(', ')})`);
        }
      })
      .catch((e) => console.warn('[Windrow SW] backup failed:', e));
  }

  if (alarm.name === SYNC_POLL_ALARM) {
    broadcast({ type: 'syncStatusChanged', status: 'syncing' });
    handleSyncNow()
      .then((r) => broadcast({ type: 'syncStatusChanged', status: r.ok ? 'synced' : 'error' }))
      .catch(() => broadcast({ type: 'syncStatusChanged', status: 'error' }));
  }
});

// ── SW lifecycle hooks ──
// Cancel pending saves on SW suspend (best-effort; Dexie transactions are atomic)
chrome.runtime.onSuspend?.addListener(() => {
  console.log('[Windrow SW] onSuspend');
  cancelPendingSaves();
  void cancelSyncTimers();
});

console.log('[Windrow SW] loaded and registered');

// Ensure module-scoped exports (unused, but prevents TS isolatedModules error)
export {};