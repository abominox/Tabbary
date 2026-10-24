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
  // Only reached if the popup is removed from the manifest (e.g. a future mode).
  console.log('[Windrow SW] action clicked: opening side panel');
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch {
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