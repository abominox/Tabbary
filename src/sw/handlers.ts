// onMessageTyped handlers: wire queries and commands to repo methods.
// Handles all messages from UI surfaces (side panel, popup, tab, window).

import { sessionsRepo, tabsRepo, tagsRepo, settingsRepo } from '@/db';
import { onMessageTyped } from '@/messaging';
import { swCache } from './cache';
import { broadcast } from '@/messaging';

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
      // For M1, load tabs for all non-name-matched sessions and check
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
  });
}