import { useEffect, useState } from 'react';
import { sendMessage } from '@/messaging/bus';
import { formatRelativeTime } from '@/lib';
import { useStore } from '../app/store';

interface Candidate {
  sessionId: string;
  name: string | null;
  tabCount: number;
  closedAt: number | null;
  tags: string[];
  bestMatch: { windowId: number; score: number; sharedUrls: number } | null;
}

interface MatchResult {
  sessionId: string;
  windowId: number;
  score: number;
}

/**
 * Restore-on-startup prompt for `restoreOnStartup: 'ask'`.
 *
 * Shows which closed sessions still match the windows Chrome reopened, so the
 * user can accept the binding instead of letting Windrow guess.
 */
export function RestoreBanner() {
  const settings = useStore((s) => s.settings);
  const sessions = useStore((s) => s.sessions);
  const [report, setReport] = useState<{ strategy: string } | null>(null);
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (settings.restoreOnStartup !== 'ask') return;

    let cancelled = false;
    (async () => {
      try {
        const r = await sendMessage({ type: 'getRestoreReport' });
        const m = await sendMessage({ type: 'matchWindows' });
        if (cancelled) return;
        setReport(r ?? null);
        setMatches(Array.isArray(m) ? m : []);
      } catch {
        /* SW not ready */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [settings.restoreOnStartup]);

  if (dismissed || settings.restoreOnStartup !== 'ask') return null;

  const actionable = matches.filter((m) =>
    sessions.some((s) => s.id === m.sessionId && s.state === 'closed'),
  );

  // Show whenever there is something to offer, or the worker explicitly asked.
  if (actionable.length === 0 && report?.strategy !== 'ask') return null;

  const nameOf = (id: string) => sessions.find((s) => s.id === id)?.name?.trim() || 'Untitled';

  const accept = async () => {
    setBusy(true);
    try {
      await sendMessage({ type: 'restoreLastSession' });
      await useStore.getState().onSessionsChanged();
      setDismissed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[11px] font-medium text-amber-900 dark:text-amber-200">
          {actionable.length > 0
            ? `Windrow recognised ${actionable.length} closed session${
                actionable.length === 1 ? '' : 's'
              } in your open windows.`
            : 'Windrow can restore your last session.'}
        </p>

        {actionable.slice(0, 3).map((m) => {
          const s = sessions.find((x) => x.id === m.sessionId);
          return (
            <span
              key={m.sessionId}
              className="rounded border border-amber-600/30 bg-surface-base px-1.5 py-0.5 text-[10px] text-text-secondary"
              title={`${Math.round(m.score * 100)}% match`}
            >
              {nameOf(m.sessionId)}
              {s?.closedAt ? ` · ${formatRelativeTime(s.closedAt)}` : ''}
            </span>
          );
        })}

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={accept}
            disabled={busy}
            className="rounded-md bg-amber-600 px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {busy ? 'Restoring…' : 'Restore'}
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="rounded-md border border-surface-border px-2.5 py-1 text-[10px] font-medium text-text-secondary hover:bg-surface-hover"
          >
            Not now
          </button>
        </div>
      </div>
      <p className="mt-1 text-[10px] text-amber-800/80 dark:text-amber-300/70">
        Sessions are matched by URL overlap. You can change this in Settings → General.
      </p>
    </div>
  );
}
