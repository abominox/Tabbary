// Typed SW↔UI message bus. See HANDOFF-M1 §"M1-MB-LIB".

// ── Queries ──
export interface GetSessionsMessage {
  type: 'getSessions';
}
export interface GetSessionTabsMessage {
  type: 'getSessionTabs';
  sessionId: string;
}
export interface SearchMessage {
  type: 'search';
  query: string;
}
export interface GetSettingsMessage {
  type: 'getSettings';
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
  | SearchMessage
  | GetSettingsMessage
  | OpenSessionMessage
  | CloseSessionMessage
  | DeleteSessionMessage
  | RenameSessionMessage
  | SessionsChangedEvent
  | TabsChangedEvent
  | SyncStatusChangedEvent;

export type MessageResponse<T> = T extends { type: 'getSessions' }
  ? import('@/models').Session[]
  : T extends { type: 'getSessionTabs' }
    ? import('@/models').Tab[]
    : T extends { type: 'search' }
      ? import('@/models').Session[]
      : T extends { type: 'getSettings' }
        ? import('@/models').Settings
        : void;