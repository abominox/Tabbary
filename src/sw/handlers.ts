// onMessageTyped handlers: wire queries and commands to repo methods.
// Handles all messages from UI surfaces (side panel, popup, tab, window).

import { sessionsRepo, tabsRepo, tagsRepo, settingsRepo, sessionVersionsRepo, sessionOps, tabGroupsRepo } from '@/db';
import { exportAll, importText } from '@/db/io';
import { getRestoreReport } from './events/startup';
import { suspendWindow, previewSuspension } from './suspend-service';
import { planRestore, restoreIntoTabWindow } from './restore-tabs';
import {
  runBackup,
  readBackup,
  readBackupIndex,
  backupUsage,
  deleteBackup,
  setBackupsEnabled,
  scheduleBackupAlarm,
  type BackupIndex,
} from './backup-service';
import {
  listBookmarks,
  addBookmark,
  updateBookmark,
  deleteBookmark,
  importBrowserBookmarks,
  openBookmarksAsSession,
  seedSessionBookmarks,
} from './bookmarks-service';
import { applyAllMatches, matchCandidates } from './restore-service';
import { onMessageTyped } from '@/messaging';
import { swCache } from './cache';
import { broadcast } from '@/messaging';
import { requestSaveSession } from './autosave';
import {
  handleSyncSetup,
  handleSyncPair,
  handleSyncUnlock,
  handleSyncNow,
  handleSyncState,
  handleSyncVerify,
  handleSyncDisable,
  handleSyncForget,
} from './sync-handlers';
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

      const [tabs, groups] = await Promise.all([
        tabsRepo.listBySession(msg.sessionId),
        tabGroupsRepo.listBySession(msg.sessionId),
      ]);

      // Rebuild tab groups, not just the URL list. Without this the session
      // restores as a flat window, which is the main thing a session manager
      // is supposed to preserve.
      const plan = planRestore(tabs, groups);
      if (plan.urls.length === 0) return;

      const { settingsRepo } = await import('@/db');
      const settings = await settingsRepo.get().catch(() => null);

      const restored = await restoreIntoTabWindow(plan, {
        suspend: settings?.openSuspended ?? false,
      });
      if (restored.windowId == null) return;

      await sessionsRepo.markActive(msg.sessionId, restored.windowId);
      swCache.bindWindow(restored.windowId, msg.sessionId);
      broadcast({ type: 'sessionsChanged' });
      broadcast({ type: 'restored', sessionId: msg.sessionId, groups: restored.groupsCreated });

      if (restored.errors.length > 0) {
        console.warn('[Windrow SW] restore completed with issues:', restored.errors);
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

    async exportData() {
      return exportAll();
    },

    async importData(msg) {
      const result = await importText(msg.text);
      if (result.sessions > 0) broadcast({ type: 'sessionsChanged' });
      return result;
    },

    async getRestoreReport() {
      return getRestoreReport();
    },

    async getTags() {
      return sessionOps.listTags();
    },

    async renameTag(msg) {
      const affected = await sessionOps.renameTag(msg.from, msg.to);
      if (affected > 0) broadcast({ type: 'sessionsChanged' });
      return affected;
    },

    async deleteTag(msg) {
      const affected = await sessionOps.deleteTag(msg.name);
      if (affected > 0) broadcast({ type: 'sessionsChanged' });
      return affected;
    },

    async matchWindows() {
      const { matches } = await matchCandidates();
      return matches;
    },

    async finishOnboarding(msg) {
      await settingsRepo.update({ restoreOnStartup: msg.restoreOnStartup });
      // Seed a couple of session bookmarks from the live window so the
      // bookmarks surface is not empty on first visit.
      const active = await sessionsRepo.listActive();
      if (active[0]) await seedSessionBookmarks(active[0].id).catch(() => 0);
      broadcast({ type: 'sessionsChanged' });
      return true;
    },

    // ── Bookmarks ──
    async bookmarksList(msg) {
      return listBookmarks(msg.scope, msg.ownerId ?? null);
    },

    async bookmarkAdd(msg) {
      const bm = await addBookmark(msg);
      if (bm) broadcast({ type: 'sessionsChanged' });
      return bm;
    },

    async bookmarkUpdate(msg) {
      const ok = await updateBookmark(msg.id, { title: msg.title, url: msg.url });
      if (ok) broadcast({ type: 'sessionsChanged' });
      return ok;
    },

    async bookmarkDelete(msg) {
      const n = await deleteBookmark(msg.id);
      broadcast({ type: 'sessionsChanged' });
      return n;
    },

    async bookmarksImport() {
      const result = await importBrowserBookmarks();
      broadcast({ type: 'sessionsChanged' });
      return result;
    },

    async bookmarksOpen(msg) {
      const result = await openBookmarksAsSession({
        scope: msg.scope,
        ownerId: msg.ownerId,
        folderId: msg.folderId ?? null,
        name: msg.name,
      });
      if (result) broadcast({ type: 'sessionsChanged' });
      return result;
    },

    async bookmarksSeed(msg) {
      return seedSessionBookmarks(msg.sessionId);
    },

    // ── Backups ──
    async backupList() {
      const [index, usage] = await Promise.all([readBackupIndex(), backupUsage()]);
      return {
        enabled: index.enabled,
        lastRunAt: index.lastRunAt,
        bytes: usage.bytes,
        slots: index.slots
          .slice()
          .sort((a, b) => b.createdAt - a.createdAt)
          .map((s) => ({
            id: s.id,
            tier: s.tier,
            createdAt: s.createdAt,
            sessions: s.sessions,
            tabs: s.tabs,
            bytes: s.bytes,
          })),
      };
    },

    async backupRun(msg) {
      const result = await runBackup({ force: msg.force });
      await scheduleBackupAlarm();
      return { written: result.written.length, skipped: result.skipped };
    },

    async backupRestore(msg) {
      const json = await readBackup(msg.id);
      if (!json) return null;
      // Backups are just exported bundles, so the same importer applies. It is
      // additive by design: restoring never deletes what you already have.
      const result = await importText(json);
      if (result.sessions > 0) broadcast({ type: 'sessionsChanged' });
      return { sessions: result.sessions, tabs: result.tabs };
    },

    async backupDelete(msg) {
      await deleteBackup(msg.id);
      return true;
    },

    async backupToggle(msg) {
      const index: BackupIndex = await setBackupsEnabled(msg.enabled);
      await scheduleBackupAlarm();
      const usage = await backupUsage();
      return {
        enabled: index.enabled,
        lastRunAt: index.lastRunAt,
        bytes: usage.bytes,
        slots: index.slots.map((s) => ({
          id: s.id,
          tier: s.tier,
          createdAt: s.createdAt,
          sessions: s.sessions,
          tabs: s.tabs,
          bytes: s.bytes,
        })),
      };
    },

    // ── Suspension ──
    async suspendPreview(msg) {
      return previewSuspension(msg.windowId, msg.minIdleMinutes);
    },

    async suspendWindow(msg) {
      return suspendWindow(msg.windowId, msg.minIdleMinutes);
    },

    // ── Sync ──
    async syncState() {
      return handleSyncState();
    },

    async syncSetup(msg) {
      return handleSyncSetup(msg);
    },

    async syncPair(msg) {
      return handleSyncPair(msg);
    },

    async syncUnlock(msg) {
      return handleSyncUnlock(msg);
    },

    async syncNow() {
      return handleSyncNow();
    },

    async syncVerify() {
      return handleSyncVerify();
    },

    async syncDisable(msg) {
      return handleSyncDisable(msg);
    },

    async syncForget() {
      return handleSyncForget();
    },

    async restoreLastSession() {
      // Used by the "ask" prompt: apply every confident match in one go.
      const applied = await applyAllMatches();
      if (applied.length > 0) {
        broadcast({ type: 'sessionsChanged' });
        return;
      }

      // Nothing matched — fall back to restoring the most recent closed session.
      const closed = await sessionsRepo.listClosed({ limit: 1 });
      const session = closed[0];
      if (!session) return;
      const tabs = await tabsRepo.listBySession(session.id);
      const urls = tabs.map((t) => t.url).filter(Boolean);
      if (urls.length === 0) return;

      const groups = await tabGroupsRepo.listBySession(session.id);
      const restored = await restoreIntoTabWindow(planRestore(tabs, groups));
      if (restored.windowId != null) {
        await sessionsRepo.markActive(session.id, restored.windowId);
        swCache.bindWindow(restored.windowId, session.id);
        broadcast({ type: 'sessionsChanged' });
      }
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
