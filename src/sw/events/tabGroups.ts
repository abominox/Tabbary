// TabGroup event handlers: route group changes to the debounced auto-save.
// Group changes affect tab group membership, so we need to reload tabs too.

import { tabGroupsRepo } from '@/db';
import { uuid } from '@/lib';
import { swCache } from '../cache';
import { requestSaveSession } from '../autosave';

/** Register all tabGroup listeners. Called synchronously from index.ts on SW load. */
export function registerTabGroupListeners(): void {
  // ── onCreated ──
  chrome.tabGroups.onCreated.addListener(async (group) => {
    await upsertGroupFromChrome(group);
    triggerSaveForGroup(group.id);
  });

  // ── onUpdated ──
  chrome.tabGroups.onUpdated.addListener(async (group) => {
    await upsertGroupFromChrome(group);
    triggerSaveForGroup(group.id);
  });

  // ── onRemoved ──
  chrome.tabGroups.onRemoved.addListener(async (group) => {
    // Group was removed by Chrome — soft-delete our record
    const ourId = swCache.getGroupForChromeId(group.id);
    if (ourId) {
      await tabGroupsRepo.softDelete(ourId);
      swCache.unbindGroup(group.id);
    }
    // Trigger save for the session that had this group
    // We need the windowId; try to find it from cached bindings
    // Fallback: iterate active sessions — simplified: trigger for all known windows
    // since we don't know which window the group belonged to after removal
    // Best effort: the group's old windowId is not available in onRemoved's callback
    // In practice, tabs.onUpdated or the next save will handle cleanup
    console.log('[Windrow SW] group removed:', group.id);
  });
}

/** Upsert a TabGroup record from chrome.tabGroups.TabGroup data. */
async function upsertGroupFromChrome(group: chrome.tabGroups.TabGroup): Promise<void> {
  // Find which session this group belongs to by checking the window
  // We don't know the windowId from the group alone — rely on the triggerSave path
  // which uses our cache. But we DO need to update/cache the group.
  // For now, just cache the chromeGroupId mapping for later tab-save resolution.

  const existingId = swCache.getGroupForChromeId(group.id);
  // We can't create a full TabGroup without knowing the sessionId.
  // The auto-save (called via triggerSaveForGroup) will reconstruct groups from scratch
  // via tabGroupsRepo.replaceForSession, so we only need to maintain the cache mapping.
  // If we have a cached mapping, ensure it's still valid; otherwise set a placeholder.

  if (!existingId) {
    // We don't know the sessionId yet — the next saveSession(windowId) call will
    // discover this group via chrome.tabGroups.query({windowId}) and create the record.
    // Just cache the mapping so resolveGroupId works for tab mapping.
    swCache.bindGroup(group.id, uuid());
  }
}

/** Trigger a debounced save for the window that contains this group. */
function triggerSaveForGroup(chromeGroupId: number): void {
  // The group API doesn't provide windowId directly in group objects.
  // We need to query chrome.tabs to find which window this group belongs to.
  // Asynchronously query and trigger save.
  chrome.tabs.query({ groupId: chromeGroupId }).then((tabs) => {
    if (tabs.length > 0 && tabs[0]?.windowId !== undefined) {
      const windowId = tabs[0].windowId;
      if (swCache.getSessionForWindow(windowId)) {
        requestSaveSession(windowId);
      }
    }
  }).catch(() => {
    // Window may have closed between event and query
  });
}