import { useEffect, useState } from 'react';
import { useStore } from '../app/store';
import { useSessions } from '@/hooks/useSessions';
import { sendMessage } from '@/messaging/bus';
import { SessionList } from '../components/SessionList';
import { SearchBar } from '../components/SearchBar';
import { cn, formatRelativeTime } from '@/lib';
import { t, tn } from '@/lib/i18n';
import { TabMarkStrip } from '../components/TabMarkStrip';

export type TagCount = { name: string; count: number };

/**
 * Tags surface — manage tags as first-class objects.
 *
 * Tags live on sessions (an array of names), so renaming or deleting one is a
 * bulk update across every session that carries it. This view makes that
 * visible before it happens.
 */
export function Tags() {
  useSessions();

  const sessions = useStore((s) => s.sessions);
  const tabsBySession = useStore((s) => s.tabsBySession);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const load = async () => {
    try {
      const list = await sendMessage({ type: 'getTags' });
      setTags(Array.isArray(list) ? list : []);
    } catch {
      setTags([]);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions.length]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const filtered = tags.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()));
  const selectedSessions = selected
    ? sessions.filter((s) => (s.tags ?? []).includes(selected))
    : [];

  const commitRename = async (from: string) => {
    const to = draft.trim();
    setRenaming(null);
    if (!to || to === from) return;
    try {
      const n = await sendMessage({ type: 'renameTag', from, to });
      setToast(`Renamed on ${n ?? 0} session${n === 1 ? '' : 's'}`);
      if (selected === from) setSelected(to);
      await load();
      await useStore.getState().onSessionsChanged();
    } catch {
      setToast('Rename failed');
    }
  };

  const remove = async (name: string) => {
    const count = tags.find((t) => t.name === name)?.count ?? 0;
    if (!window.confirm(`Remove the tag “${name}” from ${count} session${count === 1 ? '' : 's'}?`)) {
      return;
    }
    try {
      const n = await sendMessage({ type: 'deleteTag', name });
      setToast(`Removed from ${n ?? 0} session${n === 1 ? '' : 's'}`);
      if (selected === name) setSelected(null);
      await load();
      await useStore.getState().onSessionsChanged();
    } catch {
      setToast('Delete failed');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-base">
      <header className="flex shrink-0 items-center gap-3 border-b border-surface-border px-4 py-2.5">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-wider text-text-muted">
            {tags.length} tags across {sessions.length} sessions
          </p>
          <h1 className="text-base font-semibold tracking-tight text-text-primary">Tags</h1>
        </div>
        <div className="ml-auto w-56">
          <SearchBar value={search} onChange={setSearch} placeholder={t('tg_filter_placeholder')} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Tag list */}
        <section
          aria-label="Tags"
          className={cn(
            'flex w-full flex-col overflow-hidden border-r border-surface-border bg-surface-elevated sm:w-64 sm:shrink-0',
            selected && 'hidden sm:flex',
          )}
        >
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {filtered.length === 0 && (
              <p className="px-2 py-3 text-[11px] text-text-muted">
                {tags.length === 0
                  ? 'No tags yet. Add tags to a session in its detail view.'
                  : 'No tags match.'}
              </p>
            )}
            {filtered.map((tag) => (
              <div
                key={tag.name}
                className={cn(
                  'group mb-0.5 flex items-center gap-1 rounded px-2 py-1.5',
                  selected === tag.name ? 'bg-accent-600 text-white' : 'hover:bg-surface-hover',
                )}
              >
                {renaming === tag.name ? (
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => void commitRename(tag.name)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitRename(tag.name);
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                    aria-label={`Rename tag ${tag.name}`}
                    className="min-w-0 flex-1 rounded border border-accent-500 bg-surface-base px-1 py-0.5 text-[11px] text-text-primary outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setSelected(selected === tag.name ? null : tag.name)}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  >
                    <span className="text-[10px] opacity-60">#</span>
                    <span className="truncate text-[11px] font-medium">{tag.name}</span>
                    <span
                      className={cn(
                        'ml-auto shrink-0 font-mono text-[10px]',
                        selected === tag.name ? 'text-white/70' : 'text-text-muted',
                      )}
                    >
                      {tag.count}
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setRenaming(tag.name);
                    setDraft(tag.name);
                  }}
                  aria-label={`Rename tag ${tag.name}`}
                  title="Rename"
                  className={cn(
                    'shrink-0 rounded px-1 text-[10px] opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                    selected === tag.name ? 'hover:bg-white/20' : 'hover:bg-surface-border',
                  )}
                >
                  ✎
                </button>
                <button
                  type="button"
                  onClick={() => void remove(tag.name)}
                  aria-label={`Delete tag ${tag.name}`}
                  title="Remove from all sessions"
                  className={cn(
                    'shrink-0 rounded px-1 text-[10px] opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                    selected === tag.name ? 'hover:bg-white/20' : 'text-red-500 hover:bg-surface-border',
                  )}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Sessions carrying the tag */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {!selected ? (
            <div className="grid flex-1 place-items-center p-8 text-center">
              <div className="max-w-xs">
                <p className="text-sm font-medium text-text-primary">{t('tg_select')}</p>
                <p className="mt-1 text-xs text-text-muted">
                  See every session carrying it, then rename or remove it in bulk.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex shrink-0 items-center gap-2 border-b border-surface-border px-4 py-2.5">
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="text-[11px] text-text-muted sm:hidden"
                >
                  ←
                </button>
                <div className="min-w-0">
                  <p className="font-mono text-[9px] uppercase tracking-wider text-text-muted">
                    Tag
                  </p>
                  <h2 className="truncate text-sm font-semibold text-text-primary">
                    #{selected}
                  </h2>
                </div>
                <span className="ml-auto shrink-0 text-[11px] text-text-muted">
                  {selectedSessions.length} session{selectedSessions.length === 1 ? '' : 's'}
                </span>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {selectedSessions.length === 0 && (
                  <p className="p-3 text-[11px] text-text-muted">{t('tg_empty')}</p>
                )}
                {selectedSessions.map((s) => {
                  const sTabs = tabsBySession[s.id] ?? [];
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
                      }}
                      className="mb-0.5 flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-surface-hover"
                    >
                      <span
                        className={cn(
                          'h-1.5 w-1.5 shrink-0 rounded-full',
                          s.state === 'active' ? 'bg-green-500' : 'bg-surface-border',
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-medium text-text-primary">
                          {s.name?.trim() || 'Untitled'}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5">
                          <TabMarkStrip tabs={sTabs} size={12} max={5} muted={s.state !== 'active'} />
                          <span className="text-[10px] text-text-muted">
                            {sTabs.length} tabs · {formatRelativeTime(s.updatedAt)}
                          </span>
                        </span>
                      </span>
                      <span className="shrink-0 rounded border border-surface-border px-1.5 py-0.5 text-[9px] text-text-muted">
                        {s.state === 'active' ? 'live' : 'closed'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </main>
      </div>

      {toast && (
        <div
          role="status"
          className="pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md bg-text-primary px-3 py-1.5 text-[11px] font-medium text-surface-base"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
