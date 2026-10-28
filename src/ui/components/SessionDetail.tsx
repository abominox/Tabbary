import { useEffect, useMemo, useState } from 'react';
import type { Session, Tab, TabGroup } from '@/models';
import { formatRelativeTime } from '@/lib';
import { TabMarkStrip } from './TabMarkStrip';
import { TabGroupSection } from './TabGroupSection';
import { EmptyState } from './EmptyState';
import { sendMessage } from '@/messaging/bus';
import { cn } from '@/lib';
import { t, tn } from '@/lib/i18n';

interface SessionDetailProps {
  session: Session;
  tabs: Tab[];
  groups: TabGroup[];
  onOpen: () => void;
  onHistory: () => void;
  onTag: (tags: string[]) => void;
  onMergeTarget: (targetSessionId: string) => void;
  candidates: Session[];
}

export function SessionDetail({
  session,
  tabs,
  groups,
  onOpen,
  onHistory,
  onTag,
  onMergeTarget,
  candidates,
}: SessionDetailProps) {
  const [tagDraft, setTagDraft] = useState(session.tags?.join(', ') ?? '');
  const [mergeOpen, setMergeOpen] = useState(false);
  const [suspendNote, setSuspendNote] = useState<string | null>(null);

  const pinned = useMemo(
    () => tabs.filter((t) => t.pinned).sort((a, b) => a.position - b.position),
    [tabs],
  );
  const grouped = useMemo(
    () => tabs.filter((t) => t.groupId != null && !t.pinned),
    [tabs],
  );
  const ungrouped = useMemo(
    () => tabs.filter((t) => t.groupId == null && !t.pinned).sort((a, b) => a.position - b.position),
    [tabs],
  );

  const groupIds = new Set(groups.map((g) => g.id));
  const orphanedGrouped = grouped.filter((t) => t.groupId && !groupIds.has(t.groupId));

  const domainCount = new Set(
    tabs.map((t) => {
      try {
        return new URL(t.url).hostname.replace(/^www\./, '');
      } catch {
        return t.url;
      }
    }),
  ).size;

  const isActive = session.state === 'active';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-surface-border px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  isActive ? 'bg-green-500' : 'bg-surface-border',
                )}
              />
              <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
                {isActive ? 'Active' : 'Closed'} · v{session.version}
              </span>
              <span className="text-[10px] text-text-muted">
                {formatRelativeTime(session.updatedAt)}
              </span>
            </div>
            <h1 className="mt-1 truncate text-lg font-semibold tracking-tight text-text-primary">
              {session.name?.trim() || 'Untitled session'}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-muted">
              <span>
                {tabs.length} tab{tabs.length === 1 ? '' : 's'}
              </span>
              <span>{groups.length} group{groups.length === 1 ? '' : 's'}</span>
              <span>{domainCount} domain{domainCount === 1 ? '' : 's'}</span>
              <TabMarkStrip tabs={tabs} max={8} size={15} muted={!isActive} />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onHistory}
              className="rounded-md border border-surface-border px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface-hover"
            >
              History
            </button>
            {isActive && session.windowId != null && (
              <button
                type="button"
                onClick={async () => {
                  const r = await sendMessage({
                    type: 'suspendWindow',
                    windowId: session.windowId!,
                    minIdleMinutes: 30,
                  });
                  setSuspendNote(
                    r
                      ? tn('sd_suspended_one', 'sd_suspended_other', r.discarded, [r.discarded]) +
                          (r.skipped.length ? t('sd_left_alone', [r.skipped.length]) : '')
                      : t('sd_suspend_failed'),
                  );
                }}
                title={t('sd_suspend_title')}
                className="rounded-md border border-surface-border px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface-hover"
              >
                {t('sd_suspend')}
              </button>
            )}
            <div className="relative">
              <button
                type="button"
                onClick={() => setMergeOpen((v) => !v)}
                className="rounded-md border border-surface-border px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface-hover"
              >
                {t('sd_merge')}
              </button>
              {mergeOpen && (
                <div className="absolute right-0 top-full z-30 mt-1 max-h-64 w-56 overflow-y-auto rounded-lg border border-surface-border bg-surface-elevated p-1 shadow-lg">
                  <p className="px-2 py-1 text-[10px] uppercase tracking-wider text-text-muted">
                    {t('sd_merge_into')}
                  </p>
                  {candidates.length === 0 && (
                    <p className="px-2 py-1.5 text-[11px] text-text-muted">{t('sd_no_other')}</p>
                  )}
                  {candidates.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setMergeOpen(false);
                        onMergeTarget(c.id);
                      }}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] text-text-primary hover:bg-surface-hover"
                    >
                      <span className="truncate">{c.name?.trim() || 'Untitled'}</span>
                      <span className="ml-auto shrink-0 font-mono text-[10px] text-text-muted">
                        {c.state === 'active' ? 'live' : 'closed'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onOpen}
              className="rounded-md bg-accent-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-accent-700"
            >
              {isActive ? 'Focus window' : 'Restore'}
            </button>
          </div>
        </div>

        {suspendNote && (
          <p role="status" className="mt-2 text-[10px] text-text-muted">
            {suspendNote}
          </p>
        )}

        {/* Tags */}
        <div className="mt-3 flex items-center gap-2">
          <label htmlFor="session-tags" className="text-[10px] uppercase tracking-wider text-text-muted">
            Tags
          </label>
          <input
            id="session-tags"
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onBlur={() => {
              const next = tagDraft.split(',').map((t) => t.trim()).filter(Boolean);
              const prev = session.tags ?? [];
              if (next.join('|') !== prev.join('|')) onTag(next);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            placeholder={t('sd_tags_placeholder')}
            className="min-w-0 flex-1 rounded border border-surface-border bg-surface-base px-2 py-1 text-[11px] text-text-primary outline-none focus:border-accent-500"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {tabs.length === 0 && <EmptyState message="This session has no tabs" />}

        {pinned.length > 0 && (
          <div className="mb-2">
            <h2 className="px-2 pb-1 font-mono text-[9px] uppercase tracking-wider text-text-muted">
              Pinned
            </h2>
            {pinned.map((tab) => (
              <TabLine key={tab.id} tab={tab} />
            ))}
          </div>
        )}

        {groups.map((group) => {
          const groupTabs = grouped
            .filter((t) => t.groupId === group.id)
            .sort((a, b) => a.position - b.position);
          if (groupTabs.length === 0) return null;
          return (
            <TabGroupSection
              key={group.id}
              group={group}
              tabs={groupTabs}
              onTabClick={(t) => {
                if (t.chromeTabId != null) {
                  chrome.tabs.update(t.chromeTabId, { active: true }).catch(() => {});
                }
              }}
            />
          );
        })}

        {orphanedGrouped.length > 0 && (
          <div className="mb-2">
            {orphanedGrouped.map((tab) => (
              <TabLine key={tab.id} tab={tab} />
            ))}
          </div>
        )}

        {ungrouped.length > 0 && (
          <div className="mb-2">
            <h2 className="px-2 pb-1 font-mono text-[9px] uppercase tracking-wider text-text-muted">
              Ungrouped
            </h2>
            {ungrouped.map((tab) => (
              <TabLine key={tab.id} tab={tab} />
            ))}
          </div>
        )}

        <ClosedTabs sessionId={session.id} refreshKey={tabs.length} />
      </div>
    </div>
  );
}

/**
 * Tabs that were closed in this session, newest first.
 *
 * Closing a tab soft-deletes its row, so the history is already on disk; this
 * is the view onto it, with a way back.
 */
function ClosedTabs({ sessionId, refreshKey }: { sessionId: string; refreshKey: number }) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    sendMessage({ type: 'getClosedTabs', sessionId })
      .then((rows) => {
        if (alive) setTabs(rows ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [sessionId, refreshKey]);

  const restore = async (tabId: string) => {
    setBusy(true);
    try {
      await sendMessage({ type: 'restoreClosedTab', tabId });
      const rows = await sendMessage({ type: 'getClosedTabs', sessionId });
      setTabs(rows ?? []);
    } finally {
      setBusy(false);
    }
  };

  if (tabs.length === 0) return null;

  return (
    <details className="mt-3 border-t border-surface-border pt-2">
      <summary className="cursor-pointer px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-text-muted">
        Closed tabs ({tabs.length})
      </summary>
      <div className="mt-1">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="group flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-surface-hover"
          >
            <span className="truncate text-text-muted line-through decoration-text-muted/40">
              {tab.title || tab.url}
            </span>
            <span className="ml-auto shrink-0 font-mono text-[10px] text-text-muted">
              {formatRelativeTime(tab.updatedAt)}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void restore(tab.id)}
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-accent-600 hover:underline disabled:opacity-50 dark:text-accent-400"
            >
              Restore
            </button>
          </div>
        ))}
      </div>
    </details>
  );
}

/** A single draggable tab line inside the detail pane. */
function TabLine({ tab }: { tab: Tab }) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-tabbary-tabs', tab.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className="group flex cursor-grab items-center gap-2 rounded px-2 py-1 text-xs hover:bg-surface-hover active:cursor-grabbing"
    >
      <TabMarkStrip tabs={[tab]} size={16} max={1} />
      <span className="truncate text-text-primary">{tab.title || tab.url}</span>
      <span className="ml-auto shrink-0 font-mono text-[10px] text-text-muted">
        {hostOf(tab.url)}
      </span>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
