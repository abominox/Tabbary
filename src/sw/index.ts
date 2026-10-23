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

// ── Side panel: make the toolbar button open the side panel ──
// setPanelBehavior({ openPanelOnActionClick: true }) means clicking the action icon
// opens the side panel (the primary M1 surface) instead of firing onClicked. This
// works on both Chrome and Brave and avoids relying on a browser-side side-panel
// dropdown (Brave's UI differs from Chrome's). When this is true, chrome.action.
// onClicked does NOT fire, so the full-tab UI is reached via the Alt+S command.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error('[Windrow SW] setPanelBehavior failed:', err));

// Fallback: if openPanelOnActionClick were ever false, open the side panel on click.
// (Currently inert due to setPanelBehavior above, but kept as the documented gesture path.)
chrome.action.onClicked.addListener(async (tab) => {
  console.log('[Windrow SW] action clicked (fallback path)');
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch {
    // Last-resort: open the full-tab UI
    chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
  }
});

// ── Alarms ──
// Sync polling and version pruning scaffold (active work in M4/M1 refinement).
chrome.alarms.create('windrow-health', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'windrow-health') {
    // Keep SW warm(ish); future: sync engine poll (M4)
    console.log('[Windrow SW] health alarm');
    // Ensure settings DB is healthy
    settingsRepo.get().catch(() => {});
    // Enforce the global SessionVersion cap (500) — per-session pruning happens in
    // snapshot(); this periodic sweep is the cross-session safety net (PLAN §8).
    sessionVersionsRepo.pruneGlobal().catch((e: unknown) =>
      console.warn('[Windrow SW] pruneGlobal failed:', e),
    );
  }
});

// ── SW lifecycle hooks ──
// Cancel pending saves on SW suspend (best-effort; Dexie transactions are atomic)
chrome.runtime.onSuspend?.addListener(() => {
  console.log('[Windrow SW] onSuspend');
  cancelPendingSaves();
});

console.log('[Windrow SW] loaded and registered');

// Ensure module-scoped exports (unused, but prevents TS isolatedModules error)
export {};