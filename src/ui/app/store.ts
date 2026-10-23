import { create } from 'zustand';
import type { Session, Tab, TabGroup, Tag, Settings } from '@/models';
import { DEFAULT_SETTINGS } from '@/models';
import { sendMessage } from '@/messaging/bus';

export type FilterMode = 'all' | 'active' | 'closed';
export type SyncStatus = 'synced' | 'syncing' | 'paused' | 'error' | 'local-only';

export interface AppState {
  // Data
  sessions: Session[];
  activeSessionId: string | null;
  tabs: Tab[];
  groups: TabGroup[];
  /** Tabs per session — powers the rail's icon strips and the full-tab detail. */
  tabsBySession: Record<string, Tab[]>;
  tags: Tag[];
  tagsLoaded: boolean;
  settings: Settings;

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
  loadSettings: () => Promise<void>;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;
  resetSettings: () => Promise<void>;
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
  tabsBySession: {},
  tags: [],
  tagsLoaded: false,
  settings: DEFAULT_SETTINGS,
  search: '',
  filter: 'all',
  selectedTagIds: [],
  syncStatus: 'local-only',
  sidebarWidth: 180,

  hydrate: async () => {
    try {
      const [sessions, settings] = await Promise.all([
        sendMessage({ type: 'getSessions' }),
        sendMessage({ type: 'getSettings' }).catch(() => null),
      ]);
      if (!Array.isArray(sessions)) return;
      set({ sessions, ...(settings ? { settings } : {}) });

      const active = sessions.find((s) => s.state === 'active');
      if (active) {
        set({ activeSessionId: active.id });
        await get().refreshTabs(active.id);
      }

      // Load tabs for every session so rails/detail can render without
      // a round-trip per selection.
      await hydrateAllTabs(sessions, set, get);
      await get().loadTags();
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
      set((state) => ({
        tabs,
        groups: deriveGroups(tabs, sessionId),
        tabsBySession: { ...state.tabsBySession, [sessionId]: tabs },
      }));
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

      await hydrateAllTabs(sessions, set, get);
      await get().loadTags();
    } catch {
      // ignore
    }
  },

  onTabsChanged: async (sessionId) => {
    await get().refreshTabs(sessionId);
  },

  onSyncStatusChanged: (status) => set({ syncStatus: status }),

  loadTags: async () => {
    // Tags live on sessions in the current schema; derive the rail from them.
    const { sessions } = get();
    const allTagNames = [...new Set(sessions.flatMap((s) => s.tags ?? []))];
    const derived: Tag[] = allTagNames.map((name) => ({
      id: name,
      name,
      color: undefined,
      createdAt: 0,
      updatedAt: 0,
      deleted: false,
    }));
    set({ tags: derived, tagsLoaded: true });
  },

  loadSettings: async () => {
    const settings = await sendMessage({ type: 'getSettings' }).catch(() => null);
    if (settings) set({ settings });
  },

  saveSettings: async (patch) => {
    const updated = await sendMessage({ type: 'updateSettings', patch });
    set({ settings: updated ?? { ...get().settings, ...patch } });
  },

  resetSettings: async () => {
    const updated = await sendMessage({ type: 'resetSettings' });
    set({ settings: updated ?? DEFAULT_SETTINGS });
  },
}));

/** Fetch tabs for every session and store them in one set() to avoid N renders. */
async function hydrateAllTabs(
  sessions: Session[],
  set: (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void,
  _get: () => AppState,
): Promise<void> {
  const entries = await Promise.all(
    sessions.map(async (s) => {
      try {
        const tabs = await sendMessage({ type: 'getSessionTabs', sessionId: s.id });
        return [s.id, Array.isArray(tabs) ? tabs : []] as const;
      } catch {
        return [s.id, []] as const;
      }
    }),
  );
  const tabsBySession = Object.fromEntries(entries);
  set({ tabsBySession });
}
