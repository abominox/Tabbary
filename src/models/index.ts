// Stable interfaces — Phase 2 fills repositories. See PLAN §7.
// All entities are JSON-serializable; sync sends the full doc set as an encrypted blob.

export interface Session {
  id: string;
  name: string | null;
  windowId: number | null;
  state: 'active' | 'closed';
  mode: 'single-window' | 'multi-window';
  tags: string[];
  pinnedTabUrls: string[];
  monitor?: { x: number; y: number; w: number; h: number };
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
  version: number;
  deleted: boolean;
}

export interface Tab {
  id: string;
  sessionId: string;
  chromeTabId: number | null;
  url: string;
  title: string;
  favIconUrl?: string;
  groupId: string | null;
  pinned: boolean;
  position: number;
  active: boolean;
  discarded: boolean;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
}

export interface TabGroup {
  id: string;
  sessionId: string;
  chromeGroupId: number | null;
  title: string;
  color: 'grey' | 'blue' | 'red' | 'yellow' | 'green' | 'pink' | 'purple' | 'cyan' | 'orange';
  collapsed: boolean;
  position: number;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
}

export interface Tag {
  id: string;
  name: string;
  color?: string;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
}

export interface Bookmark {
  id: string;
  type: 'session' | 'tag' | 'browser';
  /** Owning session id, tag name, or null for browser imports. */
  ownerId: string | null;
  /** Containing folder, or null at the root. */
  parentId: string | null;
  title: string;
  url?: string;
  isFolder: boolean;
  position: number;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
}

export interface SessionVersion {
  id: string;
  sessionId: string;
  version: number;
  snapshot: { tabs: Tab[]; groups: TabGroup[]; name: string | null };
  createdAt: number;
}

export interface Settings {
  defaultOpenMode: 'single-window' | 'multi-window';
  restoreOnStartup: 'yes' | 'no' | 'ask';
  autosave: boolean;
  versionHistoryLimit: number;
  theme: 'light' | 'dark' | 'system';
  accent: string;
  density: 'comfortable' | 'compact';
  syncEnabled: boolean;
  syncEndpoint: string | null;
  syncAuthKey: string | null;
  syncConflictPolicy: 'close-remote' | 'allow-simultaneous';
  syncPollIntervalSec: number;
  openSuspended: boolean;
  preferredSurface: 'popup' | 'tab' | 'window' | 'sidepanel';
  /** What the session search box looks at. */
  searchScope: 'all' | 'sessions' | 'tabs';
}

export const DEFAULT_SETTINGS: Settings = {
  defaultOpenMode: 'multi-window',
  restoreOnStartup: 'yes',
  autosave: true,
  versionHistoryLimit: 10,
  theme: 'system',
  accent: '#3b82f6',
  density: 'comfortable',
  syncEnabled: false,
  syncEndpoint: null,
  syncAuthKey: null,
  syncConflictPolicy: 'close-remote',
  syncPollIntervalSec: 60,
  openSuspended: false,
  preferredSurface: 'sidepanel',
  searchScope: 'all',
};