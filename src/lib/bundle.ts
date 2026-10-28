/**
 * Export/import bundle format.
 *
 * Design goals: human-readable by default (plain JSON, no lock-in), stable
 * enough to be a backup, and tolerant of partial/foreign input on import.
 */

import type { Session, Tab, TabGroup } from '@/models';

export const BUNDLE_FORMAT = 'tabbary-export';
export const BUNDLE_VERSION = 1;

/**
 * Format tags this build still reads. Files exported before the rename carry
 * 'windrow-export'; refusing them would turn a rename into data loss for
 * anyone holding a backup, which is the opposite of what a backup is for.
 * We keep writing the current tag and keep reading the old one.
 */
export const LEGACY_BUNDLE_FORMATS = ['windrow-export'] as const;

export function isBundleFormat(tag: unknown): boolean {
  return tag === BUNDLE_FORMAT || (LEGACY_BUNDLE_FORMATS as readonly unknown[]).includes(tag);
}

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
  generator = 'tabbary',
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
/**
 * Can this URL be reopened in a tab?
 *
 * Deliberately looser than isPortableUrl: a `data:` or `view-source:` URL can
 * be restored by Chrome but cannot travel through an export or to another
 * browser, so it is captured but not portable. This excludes only the schemes
 * that are records of *this* browser's own UI, which would be meaningless or
 * rejected if reopened.
 */
export function isRestorableUrl(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (lower.startsWith('chrome://')) return false;
  if (lower.startsWith('chrome-extension://')) return false;
  if (lower.startsWith('devtools://')) return false;
  if (lower.startsWith('edge://')) return false;
  if (lower.startsWith('about:')) return false;
  if (lower.startsWith('javascript:')) return false;
  if (lower.startsWith('chrome-search://')) return false;
  if (lower.startsWith('chrome-untrusted://')) return false;
  return true;
}

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

  if (!isBundleFormat(raw.format)) {
    return {
      ok: false,
      error: `Not a tabbary export (expected format "${BUNDLE_FORMAT}")`,
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

/** Strip a leading list marker: "- ", "* ", "1. ", "1) ", "• ". */
function stripListMarker(line: string): string {
  return line.replace(/^\s*(?:\d+[.)]|[-*+\u2022])\s+/, '').trim();
}

/**
 * Pull tabs out of loose text.
 *
 * Handles the shapes people actually paste into an import box:
 *
 *   https://a.example
 *   - https://a.example
 *   1. https://a.example
 *   [Title](https://a.example)
 *   https://a.example<TAB>Title
 *   https://a.example | Title
 *
 * A leading bullet used to defeat the old parser: it took the first
 * whitespace-separated token as the URL, which is "-" for every line of a
 * bulleted list, so nothing imported at all.
 */
export function parseLinkList(text: string): BundleTab[] {
  const tabs: BundleTab[] = [];
  const seen = new Set<string>();

  for (const raw of text.split(/\r?\n/)) {
    const line = stripListMarker(raw);
    if (!line) continue;

    let url = '';
    let title = '';

    const md = line.match(/^\[([^\]]*)\]\(\s*<?([^)\s>]+)>?\s*\)/);
    if (md) {
      title = md[1] ?? '';
      url = md[2] ?? '';
    } else {
      const found = line.match(/(?:https?|file):\/\/[^\s<>"'`)\]]+/i);
      if (!found) continue;
      url = found[0].replace(/[.,;:]+$/, '');
      // "url<TAB>title", "url | title", "url - title"
      const rest = line.slice((found.index ?? 0) + found[0].length);
      const sep = rest.match(/^\s*(?:\t|\||-|\u2014)\s*(.+)$/);
      title = sep ? (sep[1] ?? '').trim() : '';
    }

    if (!isPortableUrl(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    tabs.push({ url, title: title.trim(), pinned: false, position: tabs.length, groupId: null });
  }

  return tabs;
}

/** Parse a newline-separated list of URLs (one per line, blanks ignored). */
export function parseUrlList(text: string): string[] {
  return parseLinkList(text).map((t) => t.url);
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

// ── Bookmarks HTML (Netscape format) ──────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (m, hex: string) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    })
    .replace(/&#(\d+);/g, (m, dec: string) => {
      const code = Number(dec);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    })
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

/**
 * Parse a Netscape bookmarks file.
 *
 * Chrome, Edge, Firefox and Safari all export this format, so it is the one
 * bookmark file you can get out of any browser without a third-party tool.
 * Folders become sessions and a folder's full path is its session name, which
 * keeps two folders called "Docs" in different places distinguishable.
 *
 * Parsed with a regex scan rather than DOMParser so it also works off the main
 * thread and in Node, where DOMParser does not exist.
 */
export function parseBookmarksHtml(text: string): BundleSession[] {
  if (!/<a\s[^>]*href\s*=/i.test(text)) return [];

  const token =
    /<h3[^>]*>([\s\S]*?)<\/h3>|<a\s[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>|<dl\b[^>]*>|<\/dl>/gi;

  // Each <dl> is one nesting level; the value is the folder that owns it.
  const openFolders: (string | null)[] = [];
  let pendingFolder: string | null = null;
  const byFolder = new Map<string, BundleTab[]>();

  const stripTags = (s: string) => s.replace(/<[^>]*>/g, '');

  let match: RegExpExecArray | null;
  while ((match = token.exec(text)) !== null) {
    const [raw, heading, href, anchorText] = match;

    if (heading !== undefined) {
      pendingFolder = decodeEntities(stripTags(heading)).trim() || null;
      continue;
    }

    if (href !== undefined) {
      const path = openFolders.filter((f): f is string => Boolean(f)).join(' / ');
      const url = decodeEntities(href).trim();
      if (!isPortableUrl(url)) continue;

      const list = byFolder.get(path) ?? [];
      if (list.some((t) => t.url === url)) continue;
      list.push({
        url,
        title: decodeEntities(stripTags(anchorText ?? '')).trim(),
        pinned: false,
        position: list.length,
        groupId: null,
      });
      byFolder.set(path, list);
      continue;
    }

    if (/^<dl/i.test(raw)) {
      openFolders.push(pendingFolder);
      pendingFolder = null;
    } else {
      openFolders.pop();
    }
  }

  const sessions: BundleSession[] = [];
  for (const [path, tabs] of byFolder) {
    if (tabs.length === 0) continue;
    sessions.push(wrapSession(path || 'Bookmarks', tabs));
  }
  return sessions;
}

/**
 * Turn arbitrary text into sessions, trying the most specific format first.
 * Returns the detected source so the UI can tell the user what happened.
 */
export function detectAndParseImport(text: string): {
  source: 'tabbary' | 'onetab' | 'bookmarks' | 'urls' | 'none';
  sessions: BundleSession[];
  warnings: string[];
} {
  const trimmed = text.trim();
  if (!trimmed) return { source: 'none', sessions: [], warnings: [] };

  // ── tabbary JSON ──
  if (trimmed.startsWith('{')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return {
        source: 'none',
        sessions: [],
        warnings: ['That file starts like JSON but could not be parsed.'],
      };
    }

    const result = parseBundle(parsed);
    if (result.ok && result.bundle) {
      return { source: 'tabbary', sessions: result.bundle.sessions, warnings: result.warnings };
    }

    // A JSON file from another manager used to report "Not a tabbary export
    // (expected format ...)", which blames the user's file for a format we do
    // not read. Say what it looks like and what is actually supported.
    const looksForeign =
      typeof parsed === 'object' && parsed !== null && !('format' in (parsed as object));

    return {
      source: 'none',
      sessions: [],
      warnings: looksForeign
        ? [
            'That is JSON, but not a tabbary export. Other managers store their own schema.',
            'Supported: tabbary JSON or encrypted export, OneTab, bookmarks HTML, plain URL lists.',
          ]
        : [result.error ?? 'That JSON is not a tabbary export.'],
    };
  }

  // ── Bookmarks HTML (Netscape format) ──
  // Chrome, Edge, Firefox and Safari all export this; it needs no guessing.
  if (/<a\s[^>]*href\s*=/i.test(trimmed) && /<dl\b|<h3\b|netscape-bookmark/i.test(trimmed)) {
    const sessions = parseBookmarksHtml(trimmed);
    if (sessions.length > 0) {
      return { source: 'bookmarks', sessions, warnings: [] };
    }
    return {
      source: 'none',
      sessions: [],
      warnings: ['That looks like bookmarks HTML, but no importable links were found.'],
    };
  }

  // ── OneTab ──
  if (trimmed.startsWith('[') || /\n\s*\n/.test(trimmed) || /\t/.test(trimmed)) {
    const sessions = parseOneTab(trimmed);
    if (sessions.length > 0) {
      return { source: 'onetab', sessions, warnings: [] };
    }
  }

  // ── Loose links ──
  const links = parseLinkList(trimmed);
  if (links.length > 0) {
    return {
      source: 'urls',
      warnings: [],
      sessions: [wrapSession(`Imported links (${links.length})`, links)],
    };
  }

  return { source: 'none', sessions: [], warnings: ['No importable URLs found'] };
}
