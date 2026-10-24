// Typed SW↔UI message bus.

import type { Session, Tab, TabGroup, SessionVersion, Settings } from '@/models';
import type { SyncMessage, SyncSetupResult, SyncStatus, SyncRunResult } from './sync';
import type { BookmarkMessage } from './bookmarks';
import type { SuspendMessage } from './suspend';

export type * from './suspend';

export type * from './bookmarks';

export type * from './sync';

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
export interface FinishOnboardingMessage {
  type: 'finishOnboarding';
  restoreOnStartup: 'yes' | 'ask' | 'no';
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
export interface ExportDataMessage {
  type: 'exportData';
}
export interface ImportDataMessage {
  type: 'importData';
  text: string;
}
export interface GetRestoreReportMessage {
  type: 'getRestoreReport';
}
export interface RestoreLastSessionMessage {
  type: 'restoreLastSession';
}
export interface MatchWindowsMessage {
  type: 'matchWindows';
}
export interface GetTagsMessage {
  type: 'getTags';
}
export interface RenameTagMessage {
  type: 'renameTag';
  from: string;
  to: string;
}
export interface DeleteTagMessage {
  type: 'deleteTag';
  name: string;
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
  | FinishOnboardingMessage
  | DuplicateSessionMessage
  | ExportDataMessage
  | ImportDataMessage
  | GetRestoreReportMessage
  | RestoreLastSessionMessage
  | MatchWindowsMessage
  | GetTagsMessage
  | RenameTagMessage
  | DeleteTagMessage
  | SyncMessage
  | BookmarkMessage
  | SuspendMessage
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
                        : T extends { type: 'exportData' }
                          ? import('@/db/io').ExportResult
                          : T extends { type: 'importData' }
                            ? import('@/db/io').ImportTextResult
                            : T extends { type: 'getRestoreReport' }
                              ? import('@/sw/events/startup').RestoreReport | null
                              : T extends { type: 'matchWindows' }
                                ? import('@/lib/restore').MatchResult[]
                                : T extends { type: 'getTags' }
                                  ? { name: string; count: number }[]
                                  : T extends { type: 'renameTag' } | { type: 'deleteTag' }
                                    ? number
                                    : T extends { type: 'syncState' }
                                      ? SyncStatus
                                      : T extends { type: 'syncSetup' } | { type: 'syncPair' }
                                        ? SyncSetupResult
                                        : T extends { type: 'syncUnlock' }
                                          ? { ok: boolean; error?: string; fingerprint?: string }
                                          : T extends { type: 'syncNow' }
                                            ? SyncRunResult
                                            : T extends { type: 'syncVerify' }
                                              ? { ok: boolean; error?: string; revision?: number; device?: string }
                                              : T extends { type: 'syncDisable' } | { type: 'syncForget' }
                                                ? SyncStatus
                                                : T extends { type: 'bookmarksList' }
                                                  ? import('@/models').Bookmark[]
                                                  : T extends { type: 'bookmarkAdd' }
                                                    ? import('@/models').Bookmark | null
                                                    : T extends { type: 'bookmarkUpdate' }
                                                      ? boolean
                                                      : T extends { type: 'bookmarkDelete' }
                                                        ? number
                                                        : T extends { type: 'bookmarksImport' }
                                                          ? { imported: number; skipped: number }
                                                          : T extends { type: 'bookmarksOpen' }
                                                            ? { sessionId: string; tabCount: number } | null
                                                            : T extends { type: 'bookmarksSeed' }
                                                              ? number
                                                              : T extends { type: 'finishOnboarding' }
                                                                ? boolean
                                                                : T extends { type: 'suspendWindow' } | { type: 'suspendPreview' }
                                                                  ? import('@/messaging/suspend').SuspendResult
                                                                  : void;
