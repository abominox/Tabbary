/**
 * Import/export for the service worker and UI.
 *
 * Export reads every non-deleted session with its groups and tabs and produces
 * a plain, human-readable bundle. Import validates the bundle, then writes new
 * sessions with fresh ids so importing twice cannot clobber live sessions.
 */

import { db, sessionsRepo, tabsRepo, tabGroupsRepo } from '@/db';
import type { Session, Tab, TabGroup } from '@/models';
import {
  buildBundle,
  detectAndParseImport,
  type Bundle,
  type BundleSession,
} from '@/lib/bundle';

export interface ExportResult {
  bundle: Bundle;
  /** Byte length of the pretty-printed JSON. */
  bytes: number;
  json: string;
}

/** Read all sessions + tabs + groups and build an export bundle. */
export async function exportAll(): Promise<ExportResult> {
  const [sessions, tabs, groups] = await Promise.all([
    db.sessions.toArray(),
    db.tabs.toArray(),
    db.tabGroups.toArray(),
  ]);

  const live = sessions.filter((s) => !s.deleted);

  const tabsBySession: Record<string, Tab[]> = {};
  for (const t of tabs) {
    if (t.deleted) continue;
    (tabsBySession[t.sessionId] ??= []).push(t);
  }

  const groupsBySession: Record<string, TabGroup[]> = {};
  for (const g of groups) {
    if (g.deleted) continue;
    (groupsBySession[g.sessionId] ??= []).push(g);
  }

  const bundle = buildBundle(live, tabsBySession, groupsBySession);
  const json = JSON.stringify(bundle, null, 2);

  return { bundle, bytes: new TextEncoder().encode(json).length, json };
}

/**
 * Read the export-size summary without building the whole JSON (used for the
 * settings panel's "N sessions · M tabs" line).
 */
export async function exportSummary(): Promise<{ sessions: number; tabs: number; bytes: number }> {
  const r = await exportAll();
  return { sessions: r.bundle.counts.sessions, tabs: r.bundle.counts.tabs, bytes: r.bytes };
}

export interface ImportResult {
  sessions: number;
  tabs: number;
  groups: number;
  warnings: string[];
}

/**
 * Import a bundle. Sessions always get fresh ids and are stored as closed, so
 * a repeated import is additive rather than destructive.
 */
export async function importBundle(bundle: Bundle): Promise<ImportResult> {
  const warnings: string[] = [];
  let sessionCount = 0;
  let tabCount = 0;
  let groupCount = 0;

  for (const bs of bundle.sessions) {
    await importOne(bs);
    sessionCount++;
    tabCount += bs.tabs.length;
    groupCount += bs.groups.length;
  }

  return { sessions: sessionCount, tabs: tabCount, groups: groupCount, warnings };
}

async function importOne(bs: BundleSession): Promise<void> {
  const ts = Date.now();
  const sessionId = crypto.randomUUID();

  const session: Session = {
    id: sessionId,
    name: bs.name,
    windowId: null,
    // Imported sessions are never live: there is no window bound to them.
    state: 'closed',
    mode: 'multi-window',
    tags: bs.tags ?? [],
    pinnedTabUrls: [],
    createdAt: bs.createdAt || ts,
    updatedAt: ts,
    closedAt: bs.closedAt ?? ts,
    version: 1,
    deleted: false,
  };
  await sessionsRepo.create(session);

  // Remap group ids: the bundle may reuse ids across sessions or collide with
  // rows already in this database.
  const groupIdMap = new Map<string, string>();
  for (const bg of bs.groups) {
    const id = crypto.randomUUID();
    groupIdMap.set(bg.id, id);
    await tabGroupsRepo.upsert({
      id,
      sessionId,
      chromeGroupId: null,
      title: bg.title,
      color: bg.color,
      collapsed: bg.collapsed,
      position: bg.position,
      createdAt: ts,
      updatedAt: ts,
      deleted: false,
    });
  }

  const tabs: Tab[] = bs.tabs.map((bt, i) => ({
    id: crypto.randomUUID(),
    sessionId,
    chromeTabId: null,
    url: bt.url,
    title: bt.title || bt.url,
    groupId: bt.groupId ? (groupIdMap.get(bt.groupId) ?? null) : null,
    pinned: bt.pinned,
    position: Number.isFinite(bt.position) ? bt.position : i,
    active: false,
    discarded: false,
    createdAt: ts,
    updatedAt: ts,
    deleted: false,
  }));

  await tabsRepo.upsertMany(tabs);
}

export interface ImportTextResult extends ImportResult {
  source: 'tabbary' | 'onetab' | 'urls' | 'none';
  error?: string;
}

/** Parse and import any supported text format in one step. */
export async function importText(text: string): Promise<ImportTextResult> {
  const detected = detectAndParseImport(text);

  if (detected.source === 'none' || detected.sessions.length === 0) {
    return {
      source: detected.source,
      sessions: 0,
      tabs: 0,
      groups: 0,
      warnings: detected.warnings,
      error: detected.warnings[0] ?? 'Nothing to import',
    };
  }

  // detectAndParseImport already validated the bundle shape for Tabbary files
  // and built well-formed sessions for the foreign formats.
  const sessions = detected.sessions;

  let sessionCount = 0;
  let tabCount = 0;
  let groupCount = 0;
  for (const s of sessions) {
    await importOne(s);
    sessionCount++;
    tabCount += s.tabs.length;
    groupCount += s.groups.length;
  }

  return {
    source: detected.source,
    sessions: sessionCount,
    tabs: tabCount,
    groups: groupCount,
    warnings: detected.warnings,
  };
}
