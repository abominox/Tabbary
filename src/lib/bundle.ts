/**
 * Export/import bundle format.
 *
 * Design goals: human-readable by default (plain JSON, no lock-in), stable
 * enough to be a backup, and tolerant of partial/foreign input on import.
 */

import type { Session, Tab, TabGroup } from '@/models';

export const BUNDLE_FORMAT = 'windrow-export';
export const BUNDLE_VERSION = 1;

export interface BundleSession {
  id: string;
  name: string | null;
  state: 'active' | 'closed';
  tags: string[];
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
  groups: BundleGroup[];
  tabs: BundleTab[];
}

export interface BundleGroup {
  id: string;
  title: string;
  color: TabGroup['color'];
  collapsed: boolean;
  position: number;
}

export interface BundleTab {
  url: string;
  title: string;
  pinned: boolean;
  position: number;
  /** References a BundleGroup.id, or null when ungrouped. */
  groupId: string | null;
}

export interface Bundle {
  format: typeof BUNDLE_FORMAT;
  version: number;
  exportedAt: number;
  generator: string;
  counts: { sessions: number; tabs: number; groups: number };
  sessions: BundleSession[];
}

/** Build a portable bundle from repository rows. */
export function buildBundle(
  sessions: Session[],
  tabsBySession: Record<string, Tab[]>,
  groupsBySession: Record<string, TabGroup[]>,
  generator = 'Windrow',
): Bundle {
  const bundleSessions: BundleSession[] = sessions.map((s) => {
    const groups = (groupsBySession[s.id] ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((g) => ({
        id: g.id,
        title: g.title,
        color: g.color,
        collapsed: g.collapsed,
        position: g.position,
      }));

    // Only export group ids the session actually owns.
    const owned = new Set(groups.map((g) => g.id));

    const tabs = (tabsBySession[s.id] ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((t) => ({
        url: t.url,
        title: t.title,
        pinned: t.pinned,
        position: t.position,
        groupId: t.groupId && owned.has(t.groupId) ? t.groupId : null,
      }))
      // Local browser pages are not restorable elsewhere.
      .filter((t) => isPortableUrl(t.url));

    return {
      id: s.id,
      name: s.name,
      state: s.state,
      tags: [...(s.tags ?? [])],
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      closedAt: s.closedAt,
      groups,
      tabs,
    };
  });

  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: Date.now(),
    generator,
    counts: {
      sessions: bundleSessions.length,
      tabs: bundleSessions.reduce((n, s) => n + s.tabs.length, 0),
      groups: bundleSessions.reduce((n, s) => n + s.groups.length, 0),
    },
    sessions: bundleSessions,
  };
}

/** Chrome-internal pages cannot be reopened from another profile. */
export function isPortableUrl(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (lower.startsWith('chrome://')) return false;
  if (lower.startsWith('chrome-extension://')) return false;
  if (lower.startsWith('devtools://')) return false;
  if (lower.startsWith('edge://')) return false;
  if (lower.startsWith('about:')) return false;
  if (lower.startsWith('javascript:')) return false;
  return lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('file://');
}

// ── Validation ────────────────────────────────────────────

export interface ParseResult {
  ok: boolean;
  error?: string;
  bundle?: Bundle;
  warnings: string[];
}

/**
 * Validate an untrusted object as a Bundle. Lenient about extra fields and
 * missing optionals; strict about the things that would corrupt a database.
 */
export function parseBundle(input: unknown): ParseResult {
  const warnings: string[] = [];

  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'File is not a JSON object', warnings };
  }

  const raw = input as Partial<Bundle> & { sessions?: unknown };

  if (raw.format !== BUNDLE_FORMAT) {
    return {
      ok: false,
      error: `Not a Windrow export (expected format "${BUNDLE_FORMAT}")`,
      warnings,
    };
  }

  if (typeof raw.version === 'number' && raw.version > BUNDLE_VERSION) {
    return {
      ok: false,
      error: `Export is version ${raw.version}; this build reads up to ${BUNDLE_VERSION}`,
      warnings,
    };
  }

  if (!Array.isArray(raw.sessions)) {
    return { ok: false, error: 'Missing "sessions" array', warnings };
  }

  const sessions: BundleSession[] = [];

  raw.sessions.forEach((candidate, i) => {
    if (typeof candidate !== 'object' || candidate === null) {
      warnings.push(`Session ${i + 1}: not an object, skipped`);
      return;
    }

    const s = candidate as Partial<BundleSession> & { tabs?: unknown; groups?: unknown };

    const groups: BundleGroup[] = Array.isArray(s.groups)
      ? s.groups
          .filter((g): g is BundleGroup => typeof g === 'object' && g !== null)
          .map((g, gi) => ({
            id: typeof g.id === 'string' && g.id ? g.id : `g-${i}-${gi}`,
            title: typeof g.title === 'string' ? g.title : '',
            color: (g.color ?? 'grey') as TabGroup['color'],
            collapsed: Boolean(g.collapsed),
            position: Number.isFinite(g.position) ? Number(g.position) : gi,
          }))
      : [];

    const ownedGroups = new Set(groups.map((g) => g.id));

    const tabs: BundleTab[] = Array.isArray(s.tabs)
      ? s.tabs
          .filter((t): t is BundleTab => typeof t === 'object' && t !== null)
          .filter((t) => typeof t.url === 'string' && isPortableUrl(t.url))
          .map((t, ti) => ({
            url: t.url,
            title: typeof t.title === 'string' ? t.title : '',
            pinned: Boolean(t.pinned),
            position: Number.isFinite(t.position) ? Number(t.position) : ti,
            groupId:
              typeof t.groupId === 'string' && ownedGroups.has(t.groupId) ? t.groupId : null,
          }))
      : [];

    if (tabs.length === 0) {
      warnings.push(`Session ${i + 1}: no restorable tabs, skipped`);
      return;
    }

    sessions.push({
      id: typeof s.id === 'string' && s.id ? s.id : `s-${i}`,
      name: typeof s.name === 'string' ? s.name : null,
      state: s.state === 'active' ? 'active' : 'closed',
      tags: Array.isArray(s.tags) ? s.tags.filter((t): t is string => typeof t === 'string') : [],
      createdAt: Number.isFinite(s.createdAt) ? Number(s.createdAt) : Date.now(),
      updatedAt: Number.isFinite(s.updatedAt) ? Number(s.updatedAt) : Date.now(),
      closedAt: Number.isFinite(s.closedAt) ? Number(s.closedAt) : null,
      groups,
      tabs,
    });
  });

  if (sessions.length === 0) {
    return { ok: false, error: 'No importable sessions found', warnings };
  }

  return {
    ok: true,
    warnings,
    bundle: {
      format: BUNDLE_FORMAT,
      version: BUNDLE_VERSION,
      exportedAt: Number.isFinite(raw.exportedAt) ? Number(raw.exportedAt) : Date.now(),
      generator: typeof raw.generator === 'string' ? raw.generator : 'unknown',
      counts: {
        sessions: sessions.length,
        tabs: sessions.reduce((n, s) => n + s.tabs.length, 0),
        groups: sessions.reduce((n, s) => n + s.groups.length, 0),
      },
      sessions,
    },
  };
}

// ── Foreign importers ─────────────────────────────────────

/** Parse a newline-separated list of URLs (one per line, blanks ignored). */
export function parseUrlList(text: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Accept bare URLs copied from a title line by taking the first token.
    const candidate = trimmed.split(/\s+/)[0]!;
    if (!isPortableUrl(candidate)) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    urls.push(candidate);
  }

  return urls;
}

/**
 * Parse a OneTab export.
 *
 * Accepts either the JSON-ish array OneTab writes into its textarea, e.g.
 *   ["https://a.example\tTitle A", "https://b.example"]
 * or the plain textarea format where each session is separated by a blank
 * line and each line is "url | title" or "url\tTitle".
 */
export function parseOneTab(text: string): BundleSession[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // JSON array form
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        const entries = parsed.filter((x): x is string => typeof x === 'string');
        const tabs = entries
          .map((entry, i) => oneTabLineToTab(entry, i))
          .filter((t): t is BundleTab => t !== null);
        return tabs.length > 0 ? [wrapSession('OneTab import', tabs)] : [];
      }
    } catch {
      // Fall through to the plain-text parser
    }
  }

  // Plain-text form: blank line separates sessions.
  const blocks = trimmed
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const sessions: BundleSession[] = [];
  blocks.forEach((block, bi) => {
    const tabs = block
      .split(/\r?\n/)
      .map((line, li) => oneTabLineToTab(line, li))
      .filter((t): t is BundleTab => t !== null);
    if (tabs.length > 0) sessions.push(wrapSession(`OneTab import ${bi + 1}`, tabs));
  });

  return sessions;
}

function oneTabLineToTab(line: string, position: number): BundleTab | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // "url<TAB>title" or "url | title" or bare url
  const tabSplit = trimmed.split('\t');
  let url = tabSplit[0] ?? '';
  let title = tabSplit[1] ?? '';

  if (!title && url.includes(' | ')) {
    const [u, ...rest] = url.split(' | ');
    url = u ?? '';
    title = rest.join(' | ');
  }

  url = url.trim();
  if (!isPortableUrl(url)) return null;

  return { url, title: title.trim(), pinned: false, position, groupId: null };
}

function wrapSession(name: string, tabs: BundleTab[]): BundleSession {
  const ts = Date.now();
  return {
    id: `import-${Math.random().toString(36).slice(2, 10)}`,
    name,
    state: 'closed',
    tags: ['imported'],
    createdAt: ts,
    updatedAt: ts,
    closedAt: ts,
    groups: [],
    tabs,
  };
}

/**
 * Turn arbitrary text into sessions, trying the most specific format first.
 * Returns the detected source so the UI can tell the user what happened.
 */
export function detectAndParseImport(text: string): {
  source: 'windrow' | 'onetab' | 'urls' | 'none';
  sessions: BundleSession[];
  warnings: string[];
} {
  const trimmed = text.trim();
  if (!trimmed) return { source: 'none', sessions: [], warnings: [] };

  // Windrow JSON
  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      const result = parseBundle(parsed);
      if (result.ok && result.bundle) {
        return { source: 'windrow', sessions: result.bundle.sessions, warnings: result.warnings };
      }
      if (result.error) {
        return { source: 'none', sessions: [], warnings: [result.error] };
      }
    } catch {
      // not JSON
    }
  }

  // OneTab JSON/plain
  if (trimmed.startsWith('[') || /\n\s*\n/.test(trimmed) || /\t/.test(trimmed)) {
    const sessions = parseOneTab(trimmed);
    if (sessions.length > 0) {
      return { source: 'onetab', sessions, warnings: [] };
    }
  }

  // Plain URL list
  const urls = parseUrlList(trimmed);
  if (urls.length > 0) {
    const ts = Date.now();
    return {
      source: 'urls',
      warnings: [],
      sessions: [
        {
          id: `import-${Math.random().toString(36).slice(2, 10)}`,
          name: `Imported links (${urls.length})`,
          state: 'closed',
          tags: ['imported'],
          createdAt: ts,
          updatedAt: ts,
          closedAt: ts,
          groups: [],
          tabs: urls.map((url, i) => ({
            url,
            title: '',
            pinned: false,
            position: i,
            groupId: null,
          })),
        },
      ],
    };
  }

  return { source: 'none', sessions: [], warnings: ['No importable URLs found'] };
}
