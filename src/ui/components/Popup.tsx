import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../app/store';
import { sessionMatchesQuery } from '@/lib/search';
import { useSessions } from '@/hooks/useSessions';
import { sendMessage } from '@/messaging/bus';
import { formatRelativeTime, cn } from '@/lib';
import { TabMarkStrip } from './TabMarkStrip';
import type { Session } from '@/models';

interface PopupProps {
  /** Height is constrained in the manifest popup; the window surface passes false. */
  compact?: boolean;
}

/**
 * Popup: the 30-second surface.
 *
 * Shows the live window, the last few closed sessions, and a search box that
 * jumps into the full-tab manager. Deliberately no drag-and-drop or settings —
 * those belong in the larger surfaces.
 */
export function Popup({ compact = true }: PopupProps) {
  useSessions();

  const sessions = useStore((s) => s.sessions);
  const activeSessionId = useStore((s) => s.activeSessionId);
  const tabsBySession = useStore((s) => s.tabsBySession);
  const searchScope = useStore((s) => s.settings.searchScope);
  const tabs = useStore((s) => s.tabs);
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const active = sessions.find((s) => s.id === activeSessionId) ?? null;

  const closed = useMemo(() => {
    const list = sessions.filter((s) => s.state === 'closed');
    const q = query.trim().toLowerCase();
    const filtered = list.filter((s) =>
      sessionMatchesQuery(s, tabsBySession[s.id] ?? [], q, searchScope),
    );
    return filtered.sort((a, b) => (b.closedAt ?? b.updatedAt) - (a.closedAt ?? a.updatedAt));
  }, [sessions, query, searchScope, tabsBySession]);

  const openFullTab = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
    window.close();
  };

  const openWindow = () => {
    chrome.windows.create({
      url: chrome.runtime.getURL('window.html'),
      type: 'popup',
      width: 520,
      height: 720,
    });
    window.close();
  };

  const openSettings = () => {
    chrome.runtime.openOptionsPage();
    window.close();
  };

  const restore = async (session: Session) => {
    try {
      await sendMessage({ type: 'openSession', sessionId: session.id });
      setToast('Restoring in a new window…');
      setTimeout(() => window.close(), 600);
    } catch {
      setToast('Could not restore that session');
    }
  };

  return (
    <div
      className={cn(
        'flex flex-col bg-surface-base text-text-primary',
        compact ? 'h-[520px] w-[380px]' : 'h-full w-full',
      )}
    >
      {/* Header */}
      <header className="flex shrink-0 items-center gap-2 border-b border-surface-border px-3 py-2">
        <span className="grid h-5 w-5 place-items-center rounded bg-text-primary text-[10px] font-bold text-surface-base">
          W
        </span>
        <span className="text-[12px] font-bold">tabbary</span>
        <span className="ml-1 flex items-center gap-1 text-[10px] text-text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
          local
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={openWindow}
            title="Open in a window"
            aria-label="Open in a window"
            className="rounded px-1.5 py-1 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text-primary"
          >
            ⧉
          </button>
          <button
            type="button"
            onClick={openSettings}
            title="Settings"
            aria-label="Settings"
            className="rounded px-1.5 py-1 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text-primary"
          >
            ⚙
          </button>
        </div>
      </header>

      {/* Search */}
      <div className="shrink-0 px-3 pt-2.5">
        <div className="relative">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') openFullTab();
            }}
            placeholder="Search sessions and tabs…"
            aria-label="Search sessions and tabs"
            className="w-full rounded-md border border-surface-border bg-surface-elevated py-1.5 pl-7 pr-8 text-[11px] outline-none focus:border-accent-500"
          />
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-text-muted">
            ⌕
          </span>
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-surface-border px-1 font-mono text-[9px] text-text-muted">
            ⏎
          </kbd>
        </div>
      </div>

      {/* Live window */}
      <section className="shrink-0 px-3 pt-3">
        <h2 className="mb-1 font-mono text-[9px] uppercase tracking-wider text-text-muted">
          This window
        </h2>
        {active ? (
          <div className="rounded-md border border-surface-border bg-surface-elevated px-2.5 py-2">
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
              <span className="truncate text-[11px] font-medium">
                {active.name?.trim() || 'Window 1'}
              </span>
              <span className="ml-auto shrink-0 font-mono text-[10px] text-text-muted">
                {tabs.length}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <TabMarkStrip tabs={tabs} size={13} max={7} />
              <span className="truncate text-[9px] text-text-muted">
                {formatRelativeTime(active.updatedAt)}
              </span>
            </div>
          </div>
        ) : (
          <p className="rounded-md border border-dashed border-surface-border px-2.5 py-2 text-[10px] text-text-muted">
            No active session in this window yet.
          </p>
        )}
      </section>

      {/* Recent */}
      <section className="flex min-h-0 flex-1 flex-col px-3 pt-3">
        <div className="mb-1 flex items-baseline gap-1.5">
          <h2 className="font-mono text-[9px] uppercase tracking-wider text-text-muted">
            {query ? 'Matches' : 'Recently closed'}
          </h2>
          <span className="text-[9px] text-text-muted">{closed.length}</span>
        </div>

        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-1">
          {closed.length === 0 && (
            <p className="px-1 py-3 text-[10px] text-text-muted">
              {query ? 'Nothing matches.' : 'Nothing closed yet.'}
            </p>
          )}
          {closed.slice(0, 40).map((s) => {
            const sTabs = tabsBySession[s.id] ?? [];
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => void restore(s)}
                className="group mb-0.5 flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-left hover:bg-surface-hover"
                title={`Restore ${sTabs.length} tabs`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-medium text-text-primary">
                    {s.name?.trim() || 'Untitled'}
                  </p>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <TabMarkStrip tabs={sTabs} size={11} max={4} muted />
                    <span className="truncate text-[9px] text-text-muted">
                      {sTabs.length} tabs · {formatRelativeTime(s.closedAt ?? s.updatedAt)}
                    </span>
                  </div>
                </div>
                <span className="shrink-0 rounded border border-surface-border px-1.5 py-0.5 text-[9px] text-text-muted opacity-0 transition-opacity group-hover:opacity-100">
                  Restore
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Footer */}
      <footer className="flex shrink-0 items-center gap-2 border-t border-surface-border px-3 py-2">
        <button
          type="button"
          onClick={openFullTab}
          className="rounded-md bg-accent-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-accent-700"
        >
          Open manager
        </button>
        <button
          type="button"
          onClick={() => {
            chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
            window.close();
          }}
          className="ml-auto text-[10px] text-text-muted hover:text-text-primary"
        >
          {sessions.length} sessions
        </button>
      </footer>

      {toast && (
        <div
          role="status"
          className="pointer-events-none absolute bottom-14 left-1/2 -translate-x-1/2 rounded-md bg-text-primary px-2.5 py-1.5 text-[10px] font-medium text-surface-base"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
