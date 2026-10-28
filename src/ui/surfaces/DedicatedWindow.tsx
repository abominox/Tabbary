import { useEffect, useState } from 'react';
import { useStore } from '../app/store';
import { useSessions } from '@/hooks/useSessions';
import { SessionList } from '../components/SessionList';
import { SessionDetail } from '../components/SessionDetail';
import { RevisionDrawer } from '../components/RevisionDrawer';
import { SearchBar } from '../components/SearchBar';
import { sendMessage } from '@/messaging/bus';
import { cn } from '@/lib';
import { t } from '@/lib/i18n';
import type { Session } from '@/models';

/**
 * Dedicated window surface.
 *
 * A two-pane layout sized for a narrow window (550–900px): session list on the
 * left, detail on the right. Same data and actions as the full-tab manager,
 * without the tag rail — horizontal space is the constraint here.
 */
export function DedicatedWindow() {
  useSessions();

  const sessions = useStore((s) => s.sessions);
  const tabsBySession = useStore((s) => s.tabsBySession);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const tabs = useStore((s) => s.tabs);
  const groups = useStore((s) => s.groups);
  const search = useStore((s) => s.search);
  const setSearch = useStore((s) => s.setSearch);
  const clearSearch = useStore((s) => s.clearSearch);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<Session | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pane, setPane] = useState<'list' | 'detail'>('list');

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const visible = sessions
    .filter((s) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      if ((s.name ?? '').toLowerCase().includes(q)) return true;
      return (tabsBySession[s.id] ?? []).some(
        (t) => t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q),
      );
    })
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  const selected =
    sessions.find((s) => s.id === selectedId) ??
    sessions.find((s) => s.id === activeSessionId) ??
    null;

  const selectedTabs = selected
    ? tabsBySession[selected.id] ?? (selected.id === activeSessionId ? tabs : [])
    : [];
  const selectedGroups = selected?.id === activeSessionId ? groups : [];

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-base">
      <header className="flex shrink-0 items-center gap-2 border-b border-surface-border px-3 py-2">
        <span className="grid h-5 w-5 place-items-center rounded bg-text-primary text-[10px] font-bold text-surface-base">
          W
        </span>
        <span className="text-[12px] font-bold">tabbary</span>
        <div className="ml-2 min-w-0 flex-1">
          <SearchBar
            value={search}
            onChange={setSearch}
            onClear={clearSearch}
            placeholder={t('common_search_placeholder')}
          />
        </div>
        <button
          type="button"
          onClick={() => chrome.runtime.openOptionsPage()}
          className="rounded px-1.5 py-1 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text-primary"
          aria-label="Settings"
        >
          ⚙
        </button>
        <button
          type="button"
          onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('index.html') })}
          className="whitespace-nowrap rounded border border-surface-border px-2 py-1 text-[10px] font-medium text-text-secondary hover:bg-surface-hover"
        >
          Full tab
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <section
          aria-label="Sessions"
          className={cn(
            'flex w-full min-w-0 flex-col overflow-hidden border-r border-surface-border bg-surface-elevated p-2 sm:w-56 sm:shrink-0',
            pane === 'detail' && 'hidden sm:flex',
          )}
        >
          <SessionList
            heading="Active"
            sessions={visible.filter((s) => s.state === 'active')}
            tabsBySession={tabsBySession}
            activeSessionId={activeSessionId}
            emptyMessage="No active windows"
            onSelect={(id) => {
              setSelectedId(id);
              setPane('detail');
            }}
            onDropTabs={async (target, ids) => {
              const r = await sendMessage({ type: 'moveTabs', tabIds: ids, targetSessionId: target });
              setToast(`Moved ${(r as { moved?: number } | undefined)?.moved ?? ids.length} tabs`);
              await useStore.getState().onSessionsChanged();
            }}
          />
          <div className="my-1 border-t border-surface-border" />
          <SessionList
            heading="Closed"
            sessions={visible.filter((s) => s.state === 'closed')}
            tabsBySession={tabsBySession}
            emptyMessage="Nothing closed"
            onSelect={(id) => {
              setSelectedId(id);
              setPane('detail');
            }}
            onDropTabs={async (target, ids) => {
              const r = await sendMessage({ type: 'moveTabs', tabIds: ids, targetSessionId: target });
              setToast(`Moved ${(r as { moved?: number } | undefined)?.moved ?? ids.length} tabs`);
              await useStore.getState().onSessionsChanged();
            }}
          />
        </section>

        <main
          className={cn(
            'flex min-w-0 flex-1 flex-col overflow-hidden',
            pane === 'list' && 'hidden sm:flex',
          )}
        >
          {selected ? (
            <>
              <button
                type="button"
                onClick={() => setPane('list')}
                className="shrink-0 border-b border-surface-border px-3 py-1.5 text-left text-[10px] text-text-muted sm:hidden"
              >
                ← Sessions
              </button>
              <SessionDetail
                session={selected}
                tabs={selectedTabs}
                groups={selectedGroups}
                onOpen={() => sendMessage({ type: 'openSession', sessionId: selected.id })}
                onHistory={() => setHistoryFor(selected)}
                onTag={(tags) =>
                  sendMessage({ type: 'tagSession', sessionId: selected.id, tags }).then(() =>
                    setToast('Tags updated'),
                  )
                }
                onMergeTarget={async (targetId) => {
                  const r = await sendMessage({
                    type: 'mergeSession',
                    sourceSessionId: selected.id,
                    targetSessionId: targetId,
                  });
                  setToast(`Merged ${(r as { moved?: number } | undefined)?.moved ?? 0} tabs`);
                  await useStore.getState().onSessionsChanged();
                }}
                candidates={sessions.filter((s) => s.id !== selected.id)}
              />
            </>
          ) : (
            <div className="grid flex-1 place-items-center p-6 text-center">
              <p className="text-[11px] text-text-muted">{t('dw_select')}</p>
            </div>
          )}
        </main>
      </div>

      {historyFor && (
        <RevisionDrawer
          session={historyFor}
          onClose={() => setHistoryFor(null)}
          onChanged={async (m) => {
            setToast(m);
            await useStore.getState().onSessionsChanged();
          }}
        />
      )}

      {toast && (
        <div
          role="status"
          className="pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md bg-text-primary px-3 py-1.5 text-[10px] font-medium text-surface-base"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
