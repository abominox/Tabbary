// Tab event handlers: route tab changes to the debounced auto-save.

import { requestSaveSession } from '../autosave';
import { swCache } from '../cache';

/** Register all tab listeners. Called synchronously from index.ts on SW load. */
export function registerTabListeners(): void {
  // ── onCreated ──
  chrome.tabs.onCreated.addListener((tab) => {
    if (tab.windowId === undefined || tab.openerTabId !== undefined) {
      // Tabs created by other tabs (e.g., middle-click links) still need saving
    }
    triggerSave(tab.windowId);
  });

  // ── onUpdated: only trigger save on meaningful changes ──
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    // Only trigger save if URL, title, pinned, or group changed
    const relevant = changeInfo.url !== undefined
      || changeInfo.title !== undefined
      || changeInfo.pinned !== undefined
      || changeInfo.groupId !== undefined;
    if (!relevant) return;

    triggerSave(tab.windowId);
  });

  // ── onRemoved ──
  chrome.tabs.onRemoved.addListener((_tabId, removeInfo) => {
    if (removeInfo.isWindowClosing) return; // window onRemoved handles it
    triggerSave(removeInfo.windowId);
  });

  // ── onMoved ──
  chrome.tabs.onMoved.addListener((_tabId, moveInfo) => {
    triggerSave(moveInfo.windowId);
  });

  // ── onAttached / onDetached (tab moved between windows) ──
  chrome.tabs.onAttached.addListener((_tabId, attachInfo) => {
    // Save both the source (unknown) and the target window
    triggerSave(attachInfo.newWindowId);
  });

  chrome.tabs.onDetached.addListener((_tabId, detachInfo) => {
    triggerSave(detachInfo.oldWindowId);
  });

  // ── onReplaced (e.g. prerendering → active tab) ──
  chrome.tabs.onReplaced.addListener((_addedTabId, _removedTabId) => {
    // We'll trigger saves for all active sessions as a safety net
    for (const wid of swCache.getAllWindowIds()) {
      triggerSave(wid);
    }
  });
}

/** Helper: trigger a debounced save for the session bound to `windowId`. */
function triggerSave(windowId: number | undefined): void {
  if (windowId === undefined) return;
  if (swCache.getSessionForWindow(windowId)) {
    requestSaveSession(windowId);
  }
}