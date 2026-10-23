/**
 * Deterministic, dependency-free tab marks.
 *
 * We draw a letter tile per domain instead of loading remote favicons: no
 * network requests, no permission prompt, and it stays readable at 14px in a
 * dense rail. Colours are derived from the hostname so the same site always
 * gets the same tile.
 */

const PALETTE = [
  { bg: '#DCE6FF', fg: '#1F4FD8' },
  { bg: '#DFF3EC', fg: '#0F7A5F' },
  { bg: '#F3E7D8', fg: '#9A5B12' },
  { bg: '#E6E2F5', fg: '#5B45A8' },
  { bg: '#FADFE4', fg: '#A32C46' },
  { bg: '#E2EEF7', fg: '#24607F' },
  { bg: '#EFEAD8', fg: '#6F5A18' },
  { bg: '#E4EEF0', fg: '#2C6A6F' },
];

/** Convert a URL into a display hostname (strips www.). */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] ?? '';
  }
}

/** Stable 32-bit hash (FNV-1a) so colours don't shuffle between renders. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export interface TabMark {
  /** Single character shown inside the tile. */
  letter: string;
  bg: string;
  fg: string;
  /** Hostname, for tooltips and debugging. */
  host: string;
}

export function tabMark(url: string, title?: string): TabMark {
  const host = hostnameOf(url);

  // Prefer the registrable label ("github.com" → "G"), then the title.
  const label = host.split('.').filter(Boolean)[0] ?? title ?? '?';
  const letter = (label[0] ?? '?').toUpperCase();

  const { bg, fg } = PALETTE[hashString(host || title || letter) % PALETTE.length]!;
  return { letter, bg, fg, host };
}
