import { useStore } from '../app/store';
import { useSessions } from '@/hooks/useSessions';
import { SearchBar } from '../components/SearchBar';
import { TagRail } from '../components/TagRail';
import { ActiveSession } from '../components/ActiveSession';
import { SessionList } from '../components/SessionList';
import { SyncBadge } from '../components/SyncBadge';

/**
 * Side Panel — primary surface, two-pane "library + active" layout.
 *
 * ┌──────────┬──────────────────┐
 * │ 🔍search │ ACTIVE: Research │
 * │──────────│  • ycombinator   │
 * │ #refs    │  • arxiv.org     │
 * │ #work    │──────────────────│
 * │──────────│ LIBRARY (rows    │
 * │ filter   │ with tab marks)  │
 * └──────────┴──────────────────┘
 */
export function SidePanel() {
  // Initialise session hydration + bus subscriptions
  useSessions();

  const sessions = useStore((s) => s.sessions);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const tabs = useStore((s) => s.tabs);
  const groups = useStore((s) => s.groups);
  const tabsBySession = useStore((s) => s.tabsBySession);
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

  const filteredSessions = sessions
    .filter((s) => (filter === 'active' ? s.state === 'active' : filter === 'closed' ? s.state === 'closed' : true))
    .filter((s) =>
      selectedTagIds.length === 0 ? true : s.tags?.some((t) => selectedTagIds.includes(t)),
    )
    .filter((s) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      if ((s.name ?? '').toLowerCase().includes(q)) return true;
      return (tabsBySession[s.id] ?? []).some(
        (t) => t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q),
      );
    })
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Header ── */}
      <header className="flex shrink-0 items-center gap-1.5 border-b border-surface-border px-2 py-1.5">
        <span className="mr-auto text-sm font-bold leading-none text-text-primary">Windrow</span>
        <SyncBadge status={syncStatus} />
        <button
          type="button"
          onClick={() => chrome.runtime.openOptionsPage()}
          className="rounded px-1 text-[13px] leading-none text-text-muted hover:text-text-primary"
          aria-label="Settings"
          title="Settings"
        >
          ⚙
        </button>
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
          <section className="flex flex-1 flex-col overflow-hidden">
            <ActiveSession session={activeSession} tabs={tabs} groups={groups} />
          </section>

          <div className="shrink-0 border-t border-surface-border" />

          <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <SessionList
              heading="Sessions"
              sessions={filteredSessions}
              tabsBySession={tabsBySession}
              activeSessionId={activeSessionId}
              emptyMessage="No sessions match"
              onDropTabs={async (targetSessionId, tabIds) => {
                await import('@/messaging/bus').then(({ sendMessage }) =>
                  sendMessage({ type: 'moveTabs', tabIds, targetSessionId }),
                );
                await useStore.getState().onSessionsChanged();
              }}
            />
          </section>
        </main>
      </div>
    </div>
  );
}
