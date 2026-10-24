// Bookmark messages.

export interface BookmarksListMessage {
  type: 'bookmarksList';
  scope: 'session' | 'tag' | 'browser';
  ownerId?: string | null;
}

export interface BookmarkAddMessage {
  type: 'bookmarkAdd';
  scope: 'session' | 'tag' | 'browser';
  ownerId: string | null;
  title: string;
  url?: string;
  isFolder?: boolean;
  parentId?: string | null;
}

export interface BookmarkUpdateMessage {
  type: 'bookmarkUpdate';
  id: string;
  title?: string;
  url?: string;
}

export interface BookmarkDeleteMessage {
  type: 'bookmarkDelete';
  id: string;
}

export interface BookmarksImportMessage {
  type: 'bookmarksImport';
}

export interface BookmarksOpenMessage {
  type: 'bookmarksOpen';
  scope: 'session' | 'tag' | 'browser';
  ownerId: string | null;
  folderId?: string | null;
  name?: string;
}

export interface BookmarksSeedMessage {
  type: 'bookmarksSeed';
  sessionId: string;
}

export type BookmarkMessage =
  | BookmarksListMessage
  | BookmarkAddMessage
  | BookmarkUpdateMessage
  | BookmarkDeleteMessage
  | BookmarksImportMessage
  | BookmarksOpenMessage
  | BookmarksSeedMessage;
