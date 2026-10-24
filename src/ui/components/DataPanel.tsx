import { useEffect, useRef, useState } from 'react';
import { sendMessage } from '@/messaging/bus';
import { encryptJson, decryptJson, isEncryptedPayload } from '@/lib/crypto';
import type { ExportResult } from '@/db/io';
import { cn } from '@/lib';

type Mode = 'json' | 'encrypted';

interface ImportOutcome {
  source: string;
  sessions: number;
  tabs: number;
  groups: number;
  warnings: string[];
  error?: string;
}

/**
 * Export/import panel. Lives in Settings.
 *
 * Export: plain JSON (default) or passphrase-encrypted (PBKDF2 + AES-GCM).
 * Import: Windrow bundle, OneTab export, or a plain list of URLs.
 */
export function DataPanel() {
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode>('json');
  const [passphrase, setPassphrase] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [summary, setSummary] = useState<{ sessions: number; tabs: number } | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  // Refresh the size summary whenever the panel mounts.
  useEffect(() => {
    sendMessage({ type: 'exportData' })
      .then((r) => setSummary({ sessions: r?.bundle.counts.sessions ?? 0, tabs: r?.bundle.counts.tabs ?? 0 }))
      .catch(() => setSummary(null));
  }, []);

  const download = (filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke on the next tick so the download has started.
    setTimeout(() => URL.revokeObjectURL(url), 15_000);
  };

  const stamp = () => new Date().toISOString().slice(0, 10);

  const doExport = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const result: ExportResult = await sendMessage({ type: 'exportData' });
      if (!result) throw new Error('Nothing to export');

      if (mode === 'encrypted') {
        if (passphrase.length < 8) {
          setStatus('Use a passphrase of at least 8 characters.');
          return;
        }
        const envelope = await encryptJson(result.bundle, passphrase);
        download(`windrow-${stamp()}.windrow`, JSON.stringify(envelope, null, 2), 'application/json');
        setStatus(
          `Encrypted ${result.bundle.counts.sessions} sessions (${result.bundle.counts.tabs} tabs). Keep the passphrase — it cannot be recovered.`,
        );
      } else {
        download(`windrow-${stamp()}.json`, result.json, 'application/json');
        setStatus(
          `Exported ${result.bundle.counts.sessions} sessions, ${result.bundle.counts.tabs} tabs (${formatBytes(result.bytes)}).`,
        );
      }
    } catch (err) {
      setStatus(`Export failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const doImport = async (text: string, filename?: string) => {
    setBusy(true);
    setOutcome(null);
    setStatus(null);
    try {
      let payload = text;

      // Encrypted files need a passphrase before the worker can read them.
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }

      if (isEncryptedPayload(parsed)) {
        const pass = window.prompt('This export is encrypted. Enter its passphrase:');
        if (!pass) {
          setStatus('Import cancelled.');
          return;
        }
        payload = JSON.stringify(await decryptJson(parsed, pass));
      }

      const result = await sendMessage({ type: 'importData', text: payload });
      if (!result) throw new Error('No response from the extension');

      setOutcome(result as ImportOutcome);
      setStatus(
        result.error
          ? `Import failed: ${result.error}`
          : `Imported ${result.sessions} sessions, ${result.tabs} tabs from ${result.source}.`,
      );
    } catch (err) {
      const message = (err as Error).message;
      setStatus(
        message.includes('Wrong passphrase')
          ? 'Wrong passphrase, or the file is corrupted.'
          : `Import failed: ${message}`,
      );
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
      if (filename) setTimeout(() => setOutcome(null), 0);
    }
  };

  const onFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      setStatus('That file is larger than 25 MB — refusing to import.');
      return;
    }
    const text = await file.text();
    await doImport(text, file.name);
  };

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="rounded-lg border border-surface-border bg-surface-elevated px-3 py-2.5">
        <p className="text-[11px] font-medium text-text-primary">On this device</p>
        <p className="mt-0.5 text-[11px] text-text-muted">
          {summary
            ? `${summary.sessions} sessions · ${summary.tabs} tabs · stored locally`
            : 'Reading local data…'}
        </p>
      </div>

      {/* Export */}
      <section className="rounded-lg border border-surface-border">
        <header className="border-b border-surface-border px-3 py-2.5">
          <h3 className="text-[12px] font-semibold text-text-primary">Export</h3>
          <p className="mt-0.5 text-[11px] text-text-muted">
            Plain JSON is human-readable and has no lock-in. Encryption is optional.
          </p>
        </header>

        <div className="space-y-3 px-3 py-3">
          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">Export format</legend>
            {(
              [
                ['json', 'Plain JSON', 'Readable, diffable'],
                ['encrypted', 'Encrypted', 'Passphrase-protected'],
              ] as const
            ).map(([value, label, hint]) => (
              <label
                key={value}
                className={cn(
                  'flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-[11px]',
                  mode === value
                    ? 'border-accent-500 bg-accent-50/40 dark:bg-accent-500/10'
                    : 'border-surface-border hover:bg-surface-hover',
                )}
              >
                <input
                  type="radio"
                  name="export-format"
                  value={value}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-medium text-text-primary">{label}</span>
                  <span className="block text-text-muted">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {mode === 'encrypted' && (
            <div>
              <label htmlFor="export-pass" className="text-[11px] font-medium text-text-primary">
                Passphrase
              </label>
              <input
                id="export-pass"
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                className="mt-1 w-full max-w-sm rounded-md border border-surface-border bg-surface-base px-2 py-1.5 text-[12px] outline-none focus:border-accent-500"
              />
              <p className="mt-1 text-[10px] text-text-muted">
                PBKDF2-SHA256 (600k iterations) → AES-GCM-256, all on this device. There is no
                recovery: lose the passphrase and the file is unreadable.
              </p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={doExport}
              disabled={busy}
              className="rounded-md bg-accent-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
            >
              {busy ? 'Working…' : mode === 'encrypted' ? 'Export encrypted' : 'Export JSON'}
            </button>
            <span className="text-[10px] text-text-muted">
              Sessions, groups, tags, pinned state and tab order.
            </span>
          </div>
        </div>
      </section>

      {/* Import */}
      <section className="rounded-lg border border-surface-border">
        <header className="border-b border-surface-border px-3 py-2.5">
          <h3 className="text-[12px] font-semibold text-text-primary">Import</h3>
          <p className="mt-0.5 text-[11px] text-text-muted">
            Windrow JSON or encrypted export, a OneTab export, or a plain list of URLs.
          </p>
        </header>

        <div className="space-y-3 px-3 py-3">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void onFiles(e.dataTransfer.files);
            }}
            className={cn(
              'rounded-lg border border-dashed px-4 py-5 text-center transition-colors',
              dragging
                ? 'border-accent-500 bg-accent-50/40 dark:bg-accent-500/10'
                : 'border-surface-border',
            )}
          >
            <p className="text-[11px] text-text-secondary">
              Drop a file here, or
            </p>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="mt-1.5 rounded-md border border-surface-border px-2.5 py-1.5 text-[11px] font-medium text-text-primary hover:bg-surface-hover disabled:opacity-50"
            >
              Choose a file…
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,.windrow,.txt,application/json,text/plain"
              className="hidden"
              onChange={(e) => void onFiles(e.target.files)}
            />
            <p className="mt-2 text-[10px] text-text-muted">
              Imports are additive: new sessions are created, existing ones are never modified.
            </p>
          </div>

          <details className="text-[11px]">
            <summary className="cursor-pointer text-text-secondary">Paste text instead</summary>
            <textarea
              id="import-text"
              rows={4}
              placeholder={'https://example.com\nhttps://another.example'}
              className="mt-2 w-full rounded-md border border-surface-border bg-surface-base px-2 py-1.5 font-mono text-[11px] outline-none focus:border-accent-500"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const el = document.getElementById('import-text') as HTMLTextAreaElement | null;
                if (el?.value.trim()) void doImport(el.value);
              }}
              className="mt-1.5 rounded-md border border-surface-border px-2.5 py-1.5 text-[11px] font-medium text-text-primary hover:bg-surface-hover disabled:opacity-50"
            >
              Import pasted text
            </button>
          </details>

          {outcome && !outcome.error && (
            <div className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-[11px] text-green-800 dark:text-green-300">
              Imported {outcome.sessions} sessions, {outcome.tabs} tabs, {outcome.groups} groups
              {outcome.warnings.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-[10px]">
                  {outcome.warnings.slice(0, 4).map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </section>

      <p
        role="status"
        aria-live="polite"
        className={cn('text-[11px]', status ? 'text-text-secondary' : 'sr-only')}
      >
        {status}
      </p>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
