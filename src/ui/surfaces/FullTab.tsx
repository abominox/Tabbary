import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../app/store';
import { useSessions } from '@/hooks/useSessions';
import { SessionList } from '../components/SessionList';
import { ActiveSession } from '../components/ActiveSession';
import { SessionDetail } from '../components/SessionDetail';
import { RevisionDrawer } from '../components/RevisionDrawer';
import { SearchBar } from '../components/SearchBar';
import { TagRail } from '../components/TagRail';
import { sendMessage } from '@/messaging/bus';
import { cn } from '@/lib';
import type { Session } from '@/models';

type Pane = 'library' | 'detail';

/**
 * Full-tab manager.
 *
 * ┌────────────┬───────────────────────┬──────────────────────────┐
 * │ tags/search│ sessions (active +    │ selected session detail  │
 * │            │ closed, draggable)    │ groups, tabs, revisions  │
 * └────────────┴───────────────────────┴──────────────────────────┘
 */
export function FullTab() {
  useSessions();

  const sessions = useStore((s) => s.sessions);
  const tabsBySession = useStore((s) => s.tabsBySession);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const tabs = useStore((s) => s.tabs);
  const groups = useStore((s) => s.groups);
  const tags = useStore((s) => s.tags);
  const search = useStore((s) => s.search);
  const filter = useStore((s) => s.filter);
  const selectedTagIds = useStore((s) => s.selectedTagIds);
  const setSearch = useStore((s) => s.setSearch);
  const clearSearch = useStore((s) => s.clearSearch);
  const setFilter = useStore((s) => s.setFilter);
  const toggleTag = useStore((s) => s.toggleTag);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<Session | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>('detail');

  // Toast auto-dismiss
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const activeSessions = useMemo(
    () => sessions.filter((s) => s.state === 'active'),
    [sessions],
  );

  const visible = useMemo(() => {
    return sessions
      .filter((s) => (filter === 'all' ? true : s.state === filter))
      .filter((s) =>
        selectedTagIds.length === 0
          ? true
          : s.tags?.some((t) => selectedTagIds.includes(t)),
      )
      .filter((s) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        if ((s.name ?? '').toLowerCase().includes(q)) return true;
        return (tabsBySession[s.id] ?? []).some(
          (t) =>
            t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q),
        );
      })
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }, [sessions, filter, selectedTagIds, search, tabsBySession]);

  const openSessions = visible.filter((s) => s.state === 'active');
  const closedSessions = visible.filter((s) => s.state === 'closed');

  const selected =
    sessions.find((s) => s.id === selectedId) ??
    sessions.find((s) => s.id === activeSessionId) ??
    null;

  const selectedTabs = selected
    ? tabsBySession[selected.id] ?? (selected.id === activeSessionId ? tabs : [])
    : [];
  const selectedGroups = selected?.id === activeSessionId ? groups : [];

  // ── Actions ──
  const openSession = (id: string) => {
    setSelectedId(id);
    setPane('detail');
    sendMessage({ type: 'openSession', sessionId: id })
      .then(() => setToast('Opening session in a new window…'))
      .catch(() => setToast('Could not open the session'));
  };

  const selectSession = (id: string) => {
    setSelectedId(id);
    setPane('detail');
    if (id !== activeSessionId) {
      sendMessage({ type: 'getSessionTabs', sessionId: id })
        .then((tabs) => useStore.setState({ tabs, groups: [] }))
        .catch(() => {});
    }
  };

  const handleDropTabs = async (targetSessionId: string, tabIds: string[]) => {
    try {
      const result = await sendMessage({ type: 'moveTabs', tabIds, targetSessionId });
      const moved = (result as { moved?: number } | undefined)?.moved ?? tabIds.length;
      setToast(`Moved ${moved} tab${moved === 1 ? '' : 's'}`);
      await useStore.getState().onSessionsChanged();
    } catch {
      setToast('Could not move tabs');
    }
  };

  const mergeInto = async (sourceId: string, targetId: string) => {
    if (sourceId === targetId) {
      setToast('A session cannot be merged into itself');
      return;
    }
    try {
      const result = await sendMessage({
        type: 'mergeSession',
        sourceSessionId: sourceId,
        targetSessionId: targetId,
      });
      const r = result as { moved?: number; skipped?: number } | undefined;
      setToast(
        `Merged ${r?.moved ?? 0} tab${r?.moved === 1 ? '' : 's'}` +
          (r?.skipped ? `, skipped ${r.skipped} duplicate${r.skipped === 1 ? '' : 's'}` : ''),
      );
      setSelectedId(targetId);
      await useStore.getState().onSessionsChanged();
    } catch {
      setToast('Merge failed');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Header ── */}
      <header className="flex shrink-0 items-center gap-3 border-b border-surface-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-text-primary text-[11px] font-bold text-surface-base">
            W
          </span>
          <span className="text-sm font-bold">Windrow</span>
        </div>

        <div className="ml-2 w-full max-w-sm">
          <SearchBar
            value={search}
            onChange={setSearch}
            onClear={clearSearch}
            placeholder="Search sessions and tabs…"
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-1.5 text-[11px] text-text-muted sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            Local only
          </span>
          <button
            type="button"
            onClick={() => chrome.runtime.openOptionsPage()}
            className="rounded-md border border-surface-border px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface-hover"
          >
            Settings
          </button>
          <button
            type="button"
            onClick={() => setPane(pane === 'detail' ? 'library' : 'detail')}
            className="rounded-md border border-surface-border px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface-hover md:hidden"
          >
            {pane === 'detail' ? 'Sessions' : 'Detail'}
          </button>
        </div>
      </header>

      {/* ── Three panes ── */}
      <div className="flex min-h-0 flex-1">
        {/* Tags */}
        <aside className="hidden w-44 shrink-0 flex-col border-r border-surface-border bg-surface-elevated p-2 lg:flex">
          <TagRail
            tags={tags}
            selectedTagIds={selectedTagIds}
            onToggleTag={toggleTag}
            filter={filter}
            onFilterChange={setFilter}
          />
        </aside>

        {/* Session lists */}
        <section
          className={cn(
            'flex w-full min-w-0 flex-col gap-3 overflow-hidden border-r border-surface-border bg-surface-elevated p-2 md:w-64 md:shrink-0',
            pane === 'detail' && 'hidden md:flex',
          )}
          aria-label="Sessions"
        >
          <SessionList
            heading="Active sessions"
            sessions={openSessions}
            tabsBySession={tabsBySession}
            activeSessionId={activeSessionId}
            onSelect={selectSession}
            onDropTabs={handleDropTabs}
            emptyMessage="No active windows"
          />

          <div className="border-t border-surface-border" />

          <SessionList
            heading="Closed sessions"
            sessions={closedSessions}
            tabsBySession={tabsBySession}
            onSelect={selectSession}
            onDropTabs={handleDropTabs}
            emptyMessage="Nothing closed yet"
          />

          <p className="mt-auto px-2 pb-1 text-[10px] leading-relaxed text-text-muted">
            Drag tabs onto a session to move them. Drag a session onto another to merge.
          </p>
        </section>

        {/* Detail */}
        <main
          className={cn(
            'flex min-w-0 flex-1 flex-col overflow-hidden bg-surface-base',
            pane === 'library' && 'hidden md:flex',
          )}
        >
          {selected ? (
            <SessionDetail
              session={selected}
              tabs={selectedTabs}
              groups={selectedGroups}
              onOpen={() => openSession(selected.id)}
              onHistory={() => setHistoryFor(selected)}
              onTag={(tags) =>
                sendMessage({ type: 'tagSession', sessionId: selected.id, tags })
                  .then(() => setToast('Tags updated'))
                  .catch(() => setToast('Could not update tags'))
              }
              onMergeTarget={(targetId) => mergeInto(selected.id, targetId)}
              candidates={sessions.filter((s) => s.id !== selected.id)}
            />
          ) : (
            <div className="grid flex-1 place-items-center p-8 text-center">
              <div className="max-w-xs">
                <p className="text-sm font-medium text-text-primary">No session selected</p>
                <p className="mt-1 text-xs text-text-muted">
                  Pick a session on the left to see its groups, tabs, and revision history.
                </p>
              </div>
            </div>
          )}
        </main>
      </div>

      {historyFor && (
        <RevisionDrawer
          session={historyFor}
          onClose={() => setHistoryFor(null)}
          onChanged={async (message) => {
            setToast(message);
            await useStore.getState().onSessionsChanged();
          }}
        />
      )}

      {toast && (
        <div
          role="status"
          className="pointer-events-none fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-text-primary px-3.5 py-2 text-xs font-medium text-surface-base shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
