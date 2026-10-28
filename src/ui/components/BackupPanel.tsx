import { useEffect, useState } from 'react';
import { sendMessage } from '@/messaging/bus';
import { formatRelativeTime, cn } from '@/lib';
import { t, tn } from '@/lib/i18n';
import type { BackupView } from '@/messaging/messages';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Local backup panel.
 *
 * Snapshots are plain export bundles held in extension storage on a rolling
 * daily/weekly/monthly scheme. Restoring is additive — it never deletes the
 * library you already have.
 */
export function BackupPanel() {
  const [view, setView] = useState<BackupView | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const load = async () => {
    try {
      const v = await sendMessage({ type: 'backupList' });
      if (v) setView(v);
    } catch {
      setView(null);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const run = async (force: boolean) => {
    setBusy(true);
    setStatus(null);
    try {
      const r = await sendMessage({ type: 'backupRun', force });
      setStatus(
        r && r.written > 0
          ? `Wrote ${r.written} snapshot${r.written === 1 ? '' : 's'}.`
          : `Nothing to do — ${r?.skipped ?? 'no changes'}.`,
      );
      await load();
    } finally {
      setBusy(false);
    }
  };

  const restore = async (id: string, sessions: number, tabs: number) => {
    if (
      !window.confirm(
        `Restore this snapshot?\n\nIt adds ${sessions} sessions (${tabs} tabs) as new sessions. Nothing you already have is deleted.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const r = await sendMessage({ type: 'backupRestore', id });
      setStatus(r ? `Restored ${r.sessions} sessions, ${r.tabs} tabs.` : 'That snapshot could not be read.');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this snapshot?')) return;
    await sendMessage({ type: 'backupDelete', id });
    await load();
  };

  const toggle = async () => {
    if (!view) return;
    const next = await sendMessage({ type: 'backupToggle', enabled: !view.enabled });
    if (next) setView(next);
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-surface-border bg-surface-elevated px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
          <span className="flex items-center gap-1.5 font-medium text-text-primary">
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                view?.enabled ? 'bg-green-500' : 'bg-yellow-500',
              )}
            />
            {view?.enabled ? 'Automatic' : 'Off'}
          </span>
          <span className="text-text-muted">
            {view
              ? `${view.slots.length} snapshot${view.slots.length === 1 ? '' : 's'} · ${formatBytes(view.bytes)}`
              : 'Reading…'}
          </span>
          <span className="ml-auto text-text-muted">
            {view?.lastRunAt ? t('bk_last_run', [formatRelativeTime(view.lastRunAt)]) : t('bk_never')}
          </span>
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-text-muted">
          Kept in this browser profile: seven daily, four weekly, six monthly. Snapshots are
          plain JSON, so they can be exported or inspected. Backups never leave the device.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => void run(true)}
          disabled={busy}
          className="rounded-md bg-accent-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
        >
          {busy ? t('common_working') : t('bk_backup_now')}
        </button>
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={busy || !view}
          className="rounded-md border border-surface-border px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface-hover disabled:opacity-50"
        >
          {view?.enabled ? t('bk_turn_off') : t('bk_turn_on')}
        </button>
      </div>

      {view && view.slots.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-surface-border">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-surface-border bg-surface-elevated text-left">
                <th className="px-2.5 py-1.5 font-medium text-text-muted">{t('bk_col_when')}</th>
                <th className="px-2 py-1.5 font-medium text-text-muted">{t('bk_col_tier')}</th>
                <th className="px-2 py-1.5 font-medium text-text-muted">{t('bk_col_contents')}</th>
                <th className="px-2 py-1.5 font-medium text-text-muted">{t('bk_col_size')}</th>
                <th className="px-2.5 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {view.slots.map((s) => (
                <tr key={s.id} className="border-b border-surface-border last:border-0">
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-text-primary">
                    {formatRelativeTime(s.createdAt)}
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="rounded border border-surface-border px-1.5 py-0.5 font-mono text-[9px] uppercase text-text-muted">
                      {s.tier}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-text-secondary">
                    {tn('common_sessions_one', 'common_sessions_other', s.sessions, [s.sessions])} ·{' '}
                    {tn('common_tabs_one', 'common_tabs_other', s.tabs, [s.tabs])}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[10px] text-text-muted">
                    {formatBytes(s.bytes)}
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => void restore(s.id, s.sessions, s.tabs)}
                      className="rounded px-1.5 py-0.5 text-[10px] font-medium text-accent-600 hover:underline dark:text-accent-400"
                    >
                      Restore
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(s.id)}
                      className="ml-1 rounded px-1.5 py-0.5 text-[10px] text-red-500 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p role="status" aria-live="polite" className={cn('text-[11px]', status ? 'text-text-secondary' : 'sr-only')}>
        {status}
      </p>
    </div>
  );
}
