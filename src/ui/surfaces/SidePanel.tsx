import { useStore } from '../app/store';
import { useSessions } from '@/hooks/useSessions';
import { SearchBar } from '../components/SearchBar';
import { TagRail } from '../components/TagRail';
import { ActiveSession } from '../components/ActiveSession';
import { ClosedSessionsList } from '../components/ClosedSessionsList';
import { SurfaceSwitcher } from '../components/SurfaceSwitcher';
import { SyncBadge } from '../components/SyncBadge';
import { cn } from '@/lib';

/**
 * Side Panel — primary surface, two-pane "library + active" layout.
 *
 * ┌──────────┬──────────────────┐
 * │ 🔍search │ ACTIVE: Research │
 * │──────────│  • ycombinator  │
 * │ #refs  × │  • arxiv.org    │
 * │ #work  × │  • github/...   │
 * │ #home  × │────────────────│
 * │──────────│ LIBRARY          │
 * │ active   │  Research v3 2h │
 * │ closed ▾ │  Shopping    1d │
 * │          │  Admin       3d │
 * └──────────┴──────────────────┘
 */
export function SidePanel() {
  // Initialise session hydration + bus subscriptions
  useSessions();

  const sessions = useStore((s) => s.sessions);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const tabs = useStore((s) => s.tabs);
  const groups = useStore((s) => s.groups);
  const tags = useStore((s) => s.tags);
  const search = useStore((s) => s.search);
  const filter = useStore((s) => s.filter);
  const selectedTagIds = useStore((s) => s.selectedTagIds);
  const syncStatus = useStore((s) => s.syncStatus);
  const setSearch = useStore((s) => s.setSearch);
  const clearSearch = useStore((s) => s.clearSearch);
  const setFilter = useStore((s) => s.setFilter);
  const toggleTag = useStore((s) => s.toggleTag);

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  // Filtered sessions for the library
  const filteredSessions = sessions.filter((s) => {
    // Always show the active session in the library if filter=all, but showing it separately
    // is handled by the ActiveSession component above. The library shows everything that matches
    // the filter criteria.
    if (filter === 'active') return s.state === 'active';
    if (filter === 'closed') return s.state === 'closed';
    return true; // 'all'
  }).filter((s) => {
    // Tag filter
    if (selectedTagIds.length === 0) return true;
    return s.tags?.some((t) => selectedTagIds.includes(t));
  }).filter((s) => {
    // Search filter
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (s.name ?? '').toLowerCase().includes(q) ||
      s.id.toLowerCase().includes(q)
    );
  }).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  // Keep the library list focused on non-active sessions since the active one is shown above.
  // But in M1 we show everything and let the filter handle it.

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Header ── */}
      <header className="flex items-center gap-1.5 border-b border-surface-border px-2 py-1.5 shrink-0">
        <span className="text-sm font-bold text-text-primary mr-auto leading-none">Windrow</span>
        <SurfaceSwitcher />
        <SyncBadge status={syncStatus} />
      </header>

      {/* ── Body: two-pane ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Left rail ── */}
        <aside className="flex w-44 shrink-0 flex-col gap-2 border-r border-surface-border bg-surface-elevated p-2">
          <SearchBar
            value={search}
            onChange={setSearch}
            onClear={clearSearch}
            placeholder="Search…"
          />

          <TagRail
            tags={tags}
            selectedTagIds={selectedTagIds}
            onToggleTag={toggleTag}
            filter={filter}
            onFilterChange={setFilter}
          />
        </aside>

        {/* ── Right content ── */}
        <main className="flex flex-1 flex-col overflow-hidden bg-surface-base">
          {/* Active session section */}
          <section className="flex-1 overflow-hidden flex flex-col">
            <ActiveSession
              session={activeSession}
              tabs={tabs}
              groups={groups}
            />
          </section>

          {/* Divider */}
          <div className="border-t border-surface-border shrink-0" />

          {/* Library section */}
          <section className="flex-1 overflow-hidden flex flex-col min-h-0">
            <ClosedSessionsList
              sessions={filteredSessions}
            />
          </section>
        </main>
      </div>
    </div>
  );
}