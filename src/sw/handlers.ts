// onMessageTyped handlers: wire queries and commands to repo methods.
// Handles all messages from UI surfaces (side panel, popup, tab, window).

import { sessionsRepo, tabsRepo, tagsRepo, settingsRepo, sessionVersionsRepo, sessionOps, tabGroupsRepo } from '@/db';
import { onMessageTyped } from '@/messaging';
import { swCache } from './cache';
import { broadcast } from '@/messaging';
import { requestSaveSession } from './autosave';
import type { Settings, Tab } from '@/models';

/** Register all bus handlers. Called synchronously from index.ts on SW load. */
export function registerBusHandlers(): void {
  onMessageTyped({
    // ── Queries ──
    async getSessions() {
      const [active, closed] = await Promise.all([
        sessionsRepo.listActive(),
        sessionsRepo.listClosed(),
      ]);
      return [...active, ...closed];
    },

    async getSessionTabs(msg) {
      return tabsRepo.listBySession(msg.sessionId);
    },

    async getSessionGroups(msg) {
      return tabGroupsRepo.listBySession(msg.sessionId);
    },

    async search(msg) {
      const query = msg.query.toLowerCase().trim();
      if (!query) return [];

      const [active, closed] = await Promise.all([
        sessionsRepo.listActive(),
        sessionsRepo.listClosed(),
      ]);

      const candidates = [...active, ...closed];

      // First: filter by session name (substring, case-insensitive)
      const nameMatches = candidates.filter(s =>
        s.name !== null && s.name.toLowerCase().includes(query),
      );

      // Second: search tab URLs/titles within sessions
      const matchedIds = new Set(nameMatches.map(s => s.id));

      for (const session of candidates) {
        if (matchedIds.has(session.id)) continue;
        const tabs = await tabsRepo.listBySession(session.id);
        const tabMatch = tabs.some(
          t => t.url.toLowerCase().includes(query) || t.title.toLowerCase().includes(query),
        );
        if (tabMatch) matchedIds.add(session.id);
      }

      return candidates.filter(s => matchedIds.has(s.id));
    },

    async getSettings() {
      return settingsRepo.get();
    },

    async getVersions(msg) {
      return sessionVersionsRepo.list(msg.sessionId);
    },

    async getVersion(msg) {
      return (await sessionVersionsRepo.get(msg.versionId)) ?? null;
    },

    // ── Commands ──
    async openSession(msg) {
      const session = await sessionsRepo.get(msg.sessionId);
      if (!session) return;

      const tabs = await tabsRepo.listBySession(msg.sessionId);
      const urls = tabs.map(t => t.url).filter(Boolean);
      if (urls.length === 0) return;

      const newWindow = await chrome.windows.create({ url: urls });
      if (newWindow.id !== undefined) {
        await sessionsRepo.markActive(msg.sessionId, newWindow.id);
        swCache.bindWindow(newWindow.id, msg.sessionId);
        broadcast({ type: 'sessionsChanged' });
      }
    },

    async closeSession(msg) {
      // Find the windowId if this session is active
      const session = await sessionsRepo.get(msg.sessionId);
      if (session?.windowId !== null) {
        swCache.unbindWindow(session!.windowId!);
      }
      await sessionsRepo.markClosed(msg.sessionId);
      broadcast({ type: 'sessionsChanged' });
    },

    async deleteSession(msg) {
      const session = await sessionsRepo.get(msg.sessionId);
      if (session?.windowId !== null) {
        swCache.unbindWindow(session!.windowId!);
      }
      await sessionsRepo.softDelete(msg.sessionId);
      // Also soft-delete tabs for this session
      await tabsRepo.softDeleteBySession(msg.sessionId);
      broadcast({ type: 'sessionsChanged' });
    },

    async renameSession(msg) {
      await sessionsRepo.rename(msg.sessionId, msg.name);
      broadcast({ type: 'sessionsChanged' });
    },

    async moveTabs(msg) {
      const result = await sessionOps.moveTabs(msg.tabIds, msg.targetSessionId);

      // If the target session is live, its window must reflect the change.
      const target = await sessionsRepo.get(msg.targetSessionId);
      if (target?.windowId != null) {
        const urls = (await tabsRepo.listBySession(msg.targetSessionId))
          .map(t => t.url)
          .filter(Boolean);
        await openUrlsInWindow(target.windowId, urls);
        requestSaveSession(target.windowId);
      }

      // The source window, if live, must lose those tabs.
      for (const tabId of msg.tabIds) {
        const tab = await tabsRepo.get(tabId);
        if (tab?.chromeTabId != null) {
          await chrome.tabs.remove(tab.chromeTabId).catch(() => {});
        }
      }

      broadcast({ type: 'sessionsChanged' });
      broadcast({ type: 'tabsChanged', sessionId: msg.targetSessionId });
      return result;
    },

    async moveGroup(msg) {
      const result = await sessionOps.moveGroup(msg.groupId, msg.targetSessionId);
      broadcast({ type: 'sessionsChanged' });
      broadcast({ type: 'tabsChanged', sessionId: msg.targetSessionId });
      return result;
    },

    async mergeSession(msg) {
      const result = await sessionOps.mergeSession(msg.sourceSessionId, msg.targetSessionId);
      broadcast({ type: 'sessionsChanged' });
      broadcast({ type: 'tabsChanged', sessionId: msg.targetSessionId });
      return result;
    },

    async restoreVersion(msg) {
      const target = await sessionVersionsRepo.get(msg.versionId);
      if (!target) return;

      const result = await sessionOps.restoreVersion(msg.versionId);
      if (!result) return;

      const session = await sessionsRepo.get(result.sessionId);

      // A live session's window should now show the restored tabs.
      if (session?.windowId != null) {
        const tabs = await tabsRepo.listBySession(result.sessionId);
        const urls = tabs.map(t => t.url).filter(Boolean);
        await openUrlsInWindow(session.windowId, urls);
        requestSaveSession(session.windowId);
      }

      broadcast({ type: 'sessionsChanged' });
      broadcast({ type: 'tabsChanged', sessionId: result.sessionId });
    },

    async deleteVersion(msg) {
      await sessionVersionsRepo.delete(msg.versionId);
      broadcast({ type: 'sessionsChanged' });
    },

    async updateSettings(msg) {
      await settingsRepo.update(msg.patch as Partial<Settings>);
      return settingsRepo.get();
    },

    async resetSettings() {
      await settingsRepo.reset();
      return settingsRepo.get();
    },

    async tagSession(msg) {
      await sessionOps.setSessionTags(msg.sessionId, msg.tags);
      broadcast({ type: 'sessionsChanged' });
    },

    async duplicateSession(msg) {
      const copy = await sessionOps.duplicateSession(msg.sessionId);
      broadcast({ type: 'sessionsChanged' });
      return copy ?? null;
    },
  });
}

/**
 * Make a window's tabs match `urls`, preserving the first tab when possible.
 * Used by move/restore so the browser and the DB agree.
 */
async function openUrlsInWindow(windowId: number, urls: string[]): Promise<void> {
  try {
    const existing = await chrome.tabs.query({ windowId });

    // Reuse the first tab as a container so we don't briefly close the window.
    const [first, ...rest] = existing;
    if (first?.id != null && urls.length > 0) {
      await chrome.tabs.update(first.id, { url: urls[0] });
    } else if (urls.length > 0) {
      await chrome.tabs.create({ windowId, url: urls[0] });
    }

    // Drop the surplus tabs (keep index 0).
    for (const tab of rest) {
      if (tab.id != null) await chrome.tabs.remove(tab.id).catch(() => {});
    }

    for (const url of urls.slice(1)) {
      await chrome.tabs.create({ windowId, url, active: false });
    }
  } catch (err) {
    console.warn('[Windrow SW] could not sync window tabs:', err);
  }
}
