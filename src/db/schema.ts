import Dexie from 'dexie';
import type { Session, Tab, TabGroup, Tag, Bookmark, SessionVersion } from '@/models';

export class WindrowDB extends Dexie {
  sessions!: Dexie.Table<Session, 'id'>;
  tabs!: Dexie.Table<Tab, 'id'>;
  tabGroups!: Dexie.Table<TabGroup, 'id'>;
  tags!: Dexie.Table<Tag, 'id'>;
  bookmarks!: Dexie.Table<Bookmark, 'id'>;
  sessionVersions!: Dexie.Table<SessionVersion, 'id'>;

  constructor() {
    super('Windrow');
    this.version(1).stores({
      sessions: 'id, state, updatedAt, deleted, *tags',
      tabs: 'id, sessionId, chromeTabId, deleted, [sessionId+position]',
      tabGroups: 'id, sessionId, chromeGroupId, deleted, [sessionId+position]',
      tags: 'id, name, deleted',
      bookmarks: 'id, type, parentId, deleted, [type+parentId]',
      sessionVersions: 'id, sessionId, version, [sessionId+version]',
      settings: 'id',
    });
  }
}

export const db = new WindrowDB();