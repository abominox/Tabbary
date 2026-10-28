import type { Session, Settings, Tab } from '@/models';

export type SearchScope = Settings['searchScope'];

/**
 * Does a session match the search box?
 *
 * Shared by the full-tab manager and the popup so the two search boxes cannot
 * drift apart: a session matches on its name, on the title or URL of any tab
 * inside it, or both, depending on the configured scope.
 */
export function sessionMatchesQuery(
  session: Session,
  tabs: Tab[],
  query: string,
  scope: SearchScope = 'all',
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  if (scope !== 'tabs' && (session.name ?? '').toLowerCase().includes(q)) return true;
  if (scope === 'sessions') return false;

  return tabs.some(
    (t) => t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q),
  );
}
