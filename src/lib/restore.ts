/**
 * Window ↔ session matching for restore-on-startup.
 *
 * Chrome usually reopens the windows the user had, but our session rows are
 * keyed to the *old* window ids, which no longer exist. Rather than dumping
 * everything into new sessions (losing history) or blindly trusting ids, we
 * score each live window against each closed session and bind the best pair.
 *
 * Pure functions only: no chrome.* and no DB access, so the scoring rules are
 * unit-testable.
 */

export interface MatchTab {
  url: string;
  title?: string;
  pinned?: boolean;
}

export interface MatchWindow {
  windowId: number;
  tabs: MatchTab[];
}

export interface MatchSession {
  id: string;
  name: string | null;
  tabs: MatchTab[];
}

export interface MatchResult {
  sessionId: string;
  windowId: number;
  score: number;
  /** URLs present in both, after normalisation. */
  sharedUrls: number;
  /** Fraction of the session's tabs found in the window (0..1). */
  coverage: number;
}

/** Lower-case the host, drop a trailing slash, keep path and query. */
export function normalizeUrl(url: string): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.protocol}//${u.hostname.toLowerCase()}${path}${u.search}`;
  } catch {
    return url.trim().toLowerCase().replace(/\/+$/, '');
  }
}

/**
 * Score how well a live window matches a recorded session.
 *
 * Weighting:
 *   60% URL coverage  — what fraction of the session's tabs are present
 *   30% Jaccard       — overlap relative to the union (penalises extra tabs)
 *   10% size closeness — discourages matching a 20-tab window to a 2-tab session
 *
 * A window that shares no URLs scores 0 unless it is empty and the session is
 * empty, which is not a useful match either. Title-only matching is deliberately
 * not used: it produces confident wrong bindings for common pages (new tab,
 * search results, docs index).
 */
export function scoreMatch(session: MatchSession, window: MatchWindow): Omit<MatchResult, 'sessionId' | 'windowId'> {
  const sessionUrls = new Set(session.tabs.map((t) => normalizeUrl(t.url)).filter(Boolean));
  const windowUrls = new Set(window.tabs.map((t) => normalizeUrl(t.url)).filter(Boolean));

  if (sessionUrls.size === 0 || windowUrls.size === 0) {
    return { score: 0, sharedUrls: 0, coverage: 0 };
  }

  let shared = 0;
  for (const url of sessionUrls) {
    if (windowUrls.has(url)) shared++;
  }

  // No shared URL means no evidence. Without this guard the size-closeness
  // bonus would award points to equally-sized unrelated windows.
  if (shared === 0) {
    return { score: 0, sharedUrls: 0, coverage: 0 };
  }

  const coverage = shared / sessionUrls.size;
  const union = new Set([...sessionUrls, ...windowUrls]).size;
  const jaccard = union === 0 ? 0 : shared / union;

  const sizeRatio =
    Math.min(sessionUrls.size, windowUrls.size) / Math.max(sessionUrls.size, windowUrls.size);

  const score = coverage * 0.6 + jaccard * 0.3 + sizeRatio * 0.1;

  return {
    score: Number(score.toFixed(4)),
    sharedUrls: shared,
    coverage: Number(coverage.toFixed(4)),
  };
}

/**
 * Minimum score to accept a binding. 0.5 means roughly "at least half the
 * session's tabs are in that window". Below that we prefer a fresh session.
 */
export const MATCH_THRESHOLD = 0.5;

/**
 * Greedy best-pair matching, one window per session and vice versa.
 *
 * Greedy is fine here: sessions are few, and an unmatched-at-or-above-threshold
 * pair is better left alone than force-fitted. Pairs are taken highest score
 * first so the strongest evidence wins.
 */
export function matchWindowsToSessions(
  sessions: MatchSession[],
  windows: MatchWindow[],
  threshold = MATCH_THRESHOLD,
): MatchResult[] {
  const candidates: MatchResult[] = [];

  for (const session of sessions) {
    for (const win of windows) {
      const { score, sharedUrls, coverage } = scoreMatch(session, win);
      if (score >= threshold) {
        candidates.push({
          sessionId: session.id,
          windowId: win.windowId,
          score,
          sharedUrls,
          coverage,
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score || b.sharedUrls - a.sharedUrls);

  const usedSessions = new Set<string>();
  const usedWindows = new Set<number>();
  const accepted: MatchResult[] = [];

  for (const c of candidates) {
    if (usedSessions.has(c.sessionId) || usedWindows.has(c.windowId)) continue;
    usedSessions.add(c.sessionId);
    usedWindows.add(c.windowId);
    accepted.push(c);
  }

  return accepted;
}

/** Windows that did not match any session. */
export function unmatchedWindows(windows: MatchWindow[], matches: MatchResult[]): MatchWindow[] {
  const used = new Set(matches.map((m) => m.windowId));
  return windows.filter((w) => !used.has(w.windowId));
}

/** Sessions that did not match any window. */
export function unmatchedSessions(sessions: MatchSession[], matches: MatchResult[]): MatchSession[] {
  const used = new Set(matches.map((m) => m.sessionId));
  return sessions.filter((s) => !used.has(s.id));
}
