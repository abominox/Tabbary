import { create } from 'zustand';
import type { Session, Tab, TabGroup, Tag, Bookmark } from '@/models';
import { sendMessage } from '@/messaging/bus';

export type FilterMode = 'all' | 'active' | 'closed';
export type SyncStatus = 'synced' | 'syncing' | 'paused' | 'error' | 'local-only';

export interface AppState {
  // Data
  sessions: Session[];
  activeSessionId: string | null;
  tabs: Tab[];
  groups: TabGroup[];
  tags: Tag[];
  tagsLoaded: boolean;

  // Search & filter
  search: string;
  filter: FilterMode;
  selectedTagIds: string[];

  // Sync
  syncStatus: SyncStatus;

  // UI
  sidebarWidth: number;

  // Actions
  hydrate: () => Promise<void>;
  setActiveSession: (id: string | null) => void;
  setSearch: (q: string) => void;
  clearSearch: () => void;
  setFilter: (f: FilterMode) => void;
  toggleTag: (tagId: string) => void;
  refreshTabs: (sessionId: string) => Promise<void>;
  onSessionsChanged: () => Promise<void>;
  onTabsChanged: (sessionId: string) => Promise<void>;
  onSyncStatusChanged: (status: SyncStatus) => void;
  loadTags: () => Promise<void>;
}

/**
 * Derive lightweight group objects from a flat tab array.
 * Tabs with the same groupId form a section.
 */
function deriveGroups(tabs: Tab[], sessionId: string): TabGroup[] {
  const seen = new Set<string | null>();
  const groups: TabGroup[] = [];

  for (const tab of tabs) {
    if (tab.groupId && !seen.has(tab.groupId)) {
      seen.add(tab.groupId);
      groups.push({
        id: tab.groupId,
        sessionId,
        chromeGroupId: null,
        title: '',
        color: 'grey',
        collapsed: false,
        position: groups.length,
        createdAt: 0,
        updatedAt: 0,
        deleted: false,
      });
    }
  }
  return groups;
}

export const useStore = create<AppState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  tabs: [],
  groups: [],
  tags: [],
  tagsLoaded: false,
  search: '',
  filter: 'all',
  selectedTagIds: [],
  syncStatus: 'local-only',
  sidebarWidth: 180,

  hydrate: async () => {
    try {
      const sessions = await sendMessage({ type: 'getSessions' });
      if (!Array.isArray(sessions)) return;
      set({ sessions });

      const active = sessions.find((s) => s.state === 'active');
      if (active) {
        set({ activeSessionId: active.id });
        await get().refreshTabs(active.id);
      }
    } catch {
      // SW not ready yet — UI renders empty states gracefully
    }
  },

  setActiveSession: (id) => {
    set({ activeSessionId: id });
    if (id) get().refreshTabs(id);
    else set({ tabs: [], groups: [] });
  },

  setSearch: (q) => set({ search: q }),

  clearSearch: () => set({ search: '' }),

  setFilter: (f) => set({ filter: f }),

  toggleTag: (tagId) => {
    const { selectedTagIds } = get();
    const next = selectedTagIds.includes(tagId)
      ? selectedTagIds.filter((id) => id !== tagId)
      : [...selectedTagIds, tagId];
    set({ selectedTagIds: next });
  },

  refreshTabs: async (sessionId) => {
    try {
      const tabs = await sendMessage({ type: 'getSessionTabs', sessionId });
      if (!Array.isArray(tabs)) return;
      set({
        tabs,
        groups: deriveGroups(tabs, sessionId),
      });
    } catch {
      // SW not ready
    }
  },

  onSessionsChanged: async () => {
    try {
      const sessions = await sendMessage({ type: 'getSessions' });
      if (!Array.isArray(sessions)) return;
      set({ sessions });

      const { activeSessionId } = get();
      // If current active session is gone (e.g. closed), pick a new one
      const stillActive = activeSessionId
        ? sessions.find((s) => s.id === activeSessionId && s.state === 'active')
        : null;

      if (!stillActive) {
        const newActive = sessions.find((s) => s.state === 'active');
        if (newActive) {
          set({ activeSessionId: newActive.id });
          await get().refreshTabs(newActive.id);
        } else {
          set({ activeSessionId: null, tabs: [], groups: [] });
        }
      }
    } catch {
      // ignore
    }
  },

  onTabsChanged: async (sessionId) => {
    const { activeSessionId } = get();
    if (sessionId === activeSessionId) {
      await get().refreshTabs(sessionId);
    }
  },

  onSyncStatusChanged: (status) => set({ syncStatus: status }),

  loadTags: async () => {
    // M1: no getTags message yet — tags are M2+. Stub for future.
    // For now, derive unique tags from sessions' tag arrays.
    const { sessions } = get();
    const allTagNames = [...new Set(sessions.flatMap((s) => s.tags ?? []))];
    const derived: Tag[] = allTagNames.map((name, i) => ({
      id: `tag-${i}`,
      name,
      color: undefined,
      createdAt: 0,
      updatedAt: 0,
      deleted: false,
    }));
    set({ tags: derived, tagsLoaded: true });
  },
}));
