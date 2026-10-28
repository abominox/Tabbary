import { useEffect, useState } from 'react';
import type { Session, SessionVersion } from '@/models';
import { sendMessage } from '@/messaging/bus';
import { formatRelativeTime, cn } from '@/lib';
import { t } from '@/lib/i18n';
import { TabMarkStrip } from './TabMarkStrip';

interface RevisionDrawerProps {
  session: Session;
  onClose: () => void;
  onChanged: (message: string) => void;
}

/**
 * Right-hand drawer listing a session's revisions. Selecting an older revision
 * previews its tabs; "Restore" replaces the live state after snapshotting it
 * first, so the action is reversible.
 */
export function RevisionDrawer({ session, onClose, onChanged }: RevisionDrawerProps) {
  const [versions, setVersions] = useState<SessionVersion[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);

  const load = async () => {
    try {
      const list = await sendMessage({ type: 'getVersions', sessionId: session.id });
      setVersions(list as SessionVersion[]);
      setSelectedId((list as SessionVersion[])[0]?.id ?? null);
    } catch {
      setVersions([]);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const selected = versions?.find((v) => v.id === selectedId) ?? null;
  const isCurrent = selected ? selected.id === versions?.[0]?.id : false;

  const restore = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await sendMessage({ type: 'restoreVersion', versionId: selected.id });
      onChanged(`Restored revision from ${formatRelativeTime(selected.createdAt)}`);
      setConfirmRestore(false);
      await load();
    } catch {
      onChanged('Restore failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t('rev_title')}
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-2xl flex-col border-l border-surface-border bg-surface-base shadow-2xl"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-surface-border px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
              Session history · {versions?.length ?? 0} revisions
            </p>
            <h2 className="truncate text-sm font-semibold text-text-primary">
              {session.name?.trim() || 'Untitled session'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-surface-border px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface-hover"
          >
            Close
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* Revision list */}
          <div className="w-56 shrink-0 overflow-y-auto border-r border-surface-border bg-surface-elevated p-1.5">
            {versions === null && (
              <p className="px-2 py-2 text-[11px] text-text-muted">{t('common_loading')}</p>
            )}
            {versions?.length === 0 && (
              <p className="px-2 py-2 text-[11px] text-text-muted">
                No revisions yet. tabbary snapshots a session as it changes.
              </p>
            )}
            {versions?.map((v, i) => (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  setSelectedId(v.id);
                  setConfirmRestore(false);
                }}
                className={cn(
                  'mb-1 w-full rounded-md px-2 py-1.5 text-left transition-colors',
                  selectedId === v.id
                    ? 'bg-accent-600 text-white'
                    : 'text-text-primary hover:bg-surface-hover',
                )}
              >
                <span className="flex items-baseline gap-1.5">
                  <span className="font-mono text-[10px] opacity-80">
                    {v.id.slice(0, 7)}
                  </span>
                  {i === 0 && (
                    <span
                      className={cn(
                        'rounded px-1 text-[9px] font-semibold uppercase',
                        selectedId === v.id ? 'bg-white/20' : 'bg-surface-border',
                      )}
                    >
                      current
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block truncate text-[11px]">
                  {formatRelativeTime(v.createdAt)}
                </span>
                <span className="block font-mono text-[10px] opacity-70">
                  {v.snapshot.tabs.length} tabs · v{v.version}
                </span>
              </button>
            ))}
          </div>

          {/* Preview */}
          <div className="min-w-0 flex-1 overflow-y-auto p-4">
            {!selected && (
              <p className="text-xs text-text-muted">{t('rev_select')}</p>
            )}

            {selected && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-mono text-sm font-semibold text-text-primary">
                    {selected.id.slice(0, 7)}
                  </h3>
                  <span className="text-[11px] text-text-muted">
                    {new Date(selected.createdAt).toLocaleString()}
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    disabled={isCurrent || busy}
                    onClick={() => setConfirmRestore(true)}
                    className="rounded-md bg-accent-600 px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Restore this revision
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      sendMessage({ type: 'duplicateSession', sessionId: session.id })
                        .then(() => onChanged('Saved a copy of the session'))
                        .catch(() => onChanged('Could not save a copy'))
                    }
                    className="rounded-md border border-surface-border px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface-hover disabled:opacity-40"
                  >
                    Save a copy
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      sendMessage({ type: 'deleteVersion', versionId: selected.id })
                        .then(async () => {
                          onChanged('Revision deleted');
                          await load();
                        })
                        .catch(() => onChanged('Could not delete revision'))
                    }
                    className="rounded-md border border-surface-border px-2.5 py-1.5 text-[11px] font-medium text-red-500 hover:bg-surface-hover disabled:opacity-40"
                  >
                    Delete
                  </button>
                </div>

                {confirmRestore && (
                  <div className="mt-3 rounded-lg border border-surface-border bg-surface-elevated p-3">
                    <p className="text-[11px] leading-relaxed text-text-secondary">
                      Restore <strong>{selected.snapshot.tabs.length} tabs</strong> from this
                      revision? The current state is snapshotted first, so you can undo this.
                      {session.state === 'active' && (
                        <> {t('rev_live_note')}</>
                      )}
                    </p>
                    <div className="mt-2 flex gap-1.5">
                      <button
                        type="button"
                        onClick={restore}
                        disabled={busy}
                        className="rounded-md bg-accent-600 px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
                      >
                        {busy ? 'Restoring…' : 'Yes, restore'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmRestore(false)}
                        className="rounded-md border border-surface-border px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface-hover"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                <h4 className="mt-5 font-mono text-[9px] uppercase tracking-wider text-text-muted">
                  Tabs in this revision
                </h4>
                <div className="mt-1">
                  {selected.snapshot.tabs.length === 0 && (
                    <p className="text-[11px] text-text-muted">{t('rev_no_tabs')}</p>
                  )}
                  {selected.snapshot.tabs.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center gap-2 rounded px-1.5 py-1 text-[11px] hover:bg-surface-hover"
                    >
                      <TabMarkStrip tabs={[t]} size={14} max={1} />
                      <span className="truncate text-text-primary">{t.title || t.url}</span>
                      <span className="ml-auto shrink-0 font-mono text-[10px] text-text-muted">
                        {hostOf(t.url)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
