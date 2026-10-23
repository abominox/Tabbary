// Typed SW↔UI message bus.

import type { Session, Tab, TabGroup, SessionVersion, Settings } from '@/models';

// ── Queries ──
export interface GetSessionsMessage {
  type: 'getSessions';
}
export interface GetSessionTabsMessage {
  type: 'getSessionTabs';
  sessionId: string;
}
export interface GetSessionGroupsMessage {
  type: 'getSessionGroups';
  sessionId: string;
}
export interface SearchMessage {
  type: 'search';
  query: string;
}
export interface GetSettingsMessage {
  type: 'getSettings';
}
export interface GetVersionsMessage {
  type: 'getVersions';
  sessionId: string;
}
export interface GetVersionMessage {
  type: 'getVersion';
  versionId: string;
}

// ── Commands ──
export interface OpenSessionMessage {
  type: 'openSession';
  sessionId: string;
}
export interface CloseSessionMessage {
  type: 'closeSession';
  sessionId: string;
}
export interface DeleteSessionMessage {
  type: 'deleteSession';
  sessionId: string;
}
export interface RenameSessionMessage {
  type: 'renameSession';
  sessionId: string;
  name: string;
}
export interface MoveTabsMessage {
  type: 'moveTabs';
  tabIds: string[];
  targetSessionId: string;
}
export interface MoveGroupMessage {
  type: 'moveGroup';
  groupId: string;
  targetSessionId: string;
}
export interface MergeSessionMessage {
  type: 'mergeSession';
  sourceSessionId: string;
  targetSessionId: string;
}
export interface RestoreVersionMessage {
  type: 'restoreVersion';
  versionId: string;
}
export interface DeleteVersionMessage {
  type: 'deleteVersion';
  versionId: string;
}
export interface UpdateSettingsMessage {
  type: 'updateSettings';
  patch: Partial<Settings>;
}
export interface ResetSettingsMessage {
  type: 'resetSettings';
}
export interface TagSessionMessage {
  type: 'tagSession';
  sessionId: string;
  tags: string[];
}
export interface DuplicateSessionMessage {
  type: 'duplicateSession';
  sessionId: string;
}

// ── Events (SW → UI push) ──
export interface SessionsChangedEvent {
  type: 'sessionsChanged';
}
export interface TabsChangedEvent {
  type: 'tabsChanged';
  sessionId: string;
}
export interface SyncStatusChangedEvent {
  type: 'syncStatusChanged';
  status: 'synced' | 'syncing' | 'paused' | 'error';
}

export type Message =
  | GetSessionsMessage
  | GetSessionTabsMessage
  | GetSessionGroupsMessage
  | SearchMessage
  | GetSettingsMessage
  | GetVersionsMessage
  | GetVersionMessage
  | OpenSessionMessage
  | CloseSessionMessage
  | DeleteSessionMessage
  | RenameSessionMessage
  | MoveTabsMessage
  | MoveGroupMessage
  | MergeSessionMessage
  | RestoreVersionMessage
  | DeleteVersionMessage
  | UpdateSettingsMessage
  | ResetSettingsMessage
  | TagSessionMessage
  | DuplicateSessionMessage
  | SessionsChangedEvent
  | TabsChangedEvent
  | SyncStatusChangedEvent;

/** Result of a merge: how many tabs moved, how many were duplicates. */
export interface MergeResult {
  moved: number;
  skipped: number;
  sourceEmptied: boolean;
}

/** Result of a move operation. */
export interface MoveResult {
  moved: number;
}

export type MessageResponse<T> = T extends { type: 'getSessions' }
  ? Session[]
  : T extends { type: 'getSessionTabs' }
    ? Tab[]
    : T extends { type: 'getSessionGroups' }
      ? TabGroup[]
      : T extends { type: 'search' }
        ? Session[]
        : T extends { type: 'getSettings' }
          ? Settings
          : T extends { type: 'getVersions' }
            ? SessionVersion[]
            : T extends { type: 'getVersion' }
              ? SessionVersion | null
              : T extends { type: 'mergeSession' }
                ? MergeResult
                : T extends { type: 'moveTabs' } | { type: 'moveGroup' }
                  ? MoveResult
                  : T extends { type: 'updateSettings' }
                    ? Settings
                    : T extends { type: 'resetSettings' }
                      ? Settings
                      : T extends { type: 'duplicateSession' }
                        ? import('@/models').Session | null
                        : void;
