/**
 * Window/session matching driven by the UI (the "ask" restore flow and the
 * "Restore…" button).
 *
 * The pure scoring lives in src/lib/restore.ts; this module only deals with
 * chrome.* and the database.
 */

import { sessionsRepo, tabsRepo } from '@/db';
import { swCache } from './cache';
import { matchWindowsToSessions, type MatchSession, type MatchWindow, type MatchResult } from '@/lib/restore';

export interface Candidate {
  sessionId: string;
  name: string | null;
  tabCount: number;
  closedAt: number | null;
  tags: string[];
  /** Top matching window, when one scored above the threshold. */
  bestMatch: { windowId: number; score: number; sharedUrls: number } | null;
}

/** Snapshot live windows and closed sessions into matcher shapes. */
export async function collectShapes(): Promise<{
  sessions: MatchSession[];
  windows: MatchWindow[];
  meta: Map<string, { name: string | null; tabCount: number; closedAt: number | null; tags: string[] }>;
}> {
  // Include active sessions too: a restored window is already bound by the time
  // the user opens the UI, and "which window is this?" should stay answerable.
  const all = await sessionsRepo.listActive();
  const closed = await sessionsRepo.listClosed();
  const live = await chrome.windows.getAll({ populate: true });

  const windows: MatchWindow[] = live
    .filter((w) => w.id !== undefined && w.type === 'normal' && (w.tabs?.length ?? 0) > 0)
    .map((w) => ({
      windowId: w.id!,
      tabs: (w.tabs ?? []).map((t) => ({ url: t.url ?? '', title: t.title })),
    }));

  const sessions: MatchSession[] = [];
  const meta = new Map<string, { name: string | null; tabCount: number; closedAt: number | null; tags: string[] }>();

  for (const s of [...all, ...closed]) {
    const tabs = await tabsRepo.listBySession(s.id);
    if (tabs.length === 0) continue;
    sessions.push({
      id: s.id,
      name: s.name,
      tabs: tabs.map((t) => ({ url: t.url, title: t.title, pinned: t.pinned })),
    });
    meta.set(s.id, {
      name: s.name,
      tabCount: tabs.length,
      closedAt: s.closedAt,
      tags: s.tags ?? [],
    });
  }

  return { sessions, windows, meta };
}

/** Match live windows to closed sessions and describe each result. */
export async function matchCandidates(): Promise<{
  matches: MatchResult[];
  candidates: Candidate[];
}> {
  const { sessions, windows, meta } = await collectShapes();
  const matches = matchWindowsToSessions(sessions, windows);

  const bestBySession = new Map<string, MatchResult>();
  for (const m of matches) bestBySession.set(m.sessionId, m);

  const candidates: Candidate[] = sessions
    .map((s) => {
      const info = meta.get(s.id)!;
      const best = bestBySession.get(s.id);
      return {
        sessionId: s.id,
        name: info.name,
        tabCount: info.tabCount,
        closedAt: info.closedAt,
        tags: info.tags,
        bestMatch: best
          ? { windowId: best.windowId, score: best.score, sharedUrls: best.sharedUrls }
          : null,
      };
    })
    // Matched candidates first, then the most recently closed.
    .sort((a, b) => {
      const am = a.bestMatch ? 1 : 0;
      const bm = b.bestMatch ? 1 : 0;
      if (am !== bm) return bm - am;
      return (b.closedAt ?? 0) - (a.closedAt ?? 0);
    });

  return { matches, candidates };
}

/** Bind a session to an existing (already open) window. */
export async function bindSessionToWindow(sessionId: string, windowId: number): Promise<boolean> {
  const session = await sessionsRepo.get(sessionId);
  if (!session || session.state !== 'closed') return false;
  if (swCache.getSessionForWindow(windowId)) return false;

  await sessionsRepo.markActive(sessionId, windowId);
  swCache.bindWindow(windowId, sessionId);
  return true;
}

/** Apply every match above the threshold at once (the "ask" → accept path). */
export async function applyAllMatches(): Promise<MatchResult[]> {
  const { matches } = await matchCandidates();
  const applied: MatchResult[] = [];
  for (const m of matches) {
    if (await bindSessionToWindow(m.sessionId, m.windowId)) applied.push(m);
  }
  return applied;
}
