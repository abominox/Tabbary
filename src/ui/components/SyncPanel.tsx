import { useEffect, useState } from 'react';
import { sendMessage } from '@/messaging/bus';
import { formatRelativeTime, cn } from '@/lib';
import { isValidRecoveryPhrase } from '@/sync/crypto';
import type { SyncSetupResult, SyncStatus } from '@/messaging/sync';

type Mode = 'choose' | 'create' | 'join' | 'recovery' | 'manage';

const EMPTY: SyncStatus = {
  configured: false,
  enabled: false,
  endpoint: null,
  deviceName: null,
  fingerprint: null,
  lastSyncAt: null,
  lastError: null,
  cursor: 0,
  hasRecovery: false,
};

/**
 * Sync setup and management.
 *
 * The whole flow is explicit about the trade: the server stores ciphertext,
 * the passphrase never leaves this device, and without either the passphrase
 * or the recovery phrase the data cannot be recovered by anyone.
 */
export function SyncPanel() {
  const [status, setStatus] = useState<SyncStatus>(EMPTY);
  const [mode, setMode] = useState<Mode>('choose');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Form fields
  const [endpoint, setEndpoint] = useState('http://localhost:8787');
  const [pairingSecret, setPairingSecret] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [recovery, setRecovery] = useState('');
  const [newPhrase, setNewPhrase] = useState<string | null>(null);
  const [phraseSaved, setPhraseSaved] = useState(false);

  const refresh = async () => {
    try {
      const s = await sendMessage({ type: 'syncState' });
      if (s) {
        setStatus(s);
        setMode(s.configured ? 'manage' : 'choose');
        if (s.endpoint) setEndpoint(s.endpoint);
      }
    } catch {
      /* SW not ready */
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Ask for the server origin while the click is still "live". Chrome only
   * allows permissions.request() during a user gesture, so this must happen
   * before the first await inside the handler.
   */
  const requestOrigin = (): Promise<boolean> | true => {
    try {
      const url = new URL(/^https?:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`);
      return chrome.permissions.request({ origins: [`${url.origin}/*`] });
    } catch {
      setError('That server URL is not valid.');
      return true;
    }
  };

  const createAccount = () => {
    const permission = requestOrigin();
    return run(async () => {
      if (permission !== true && !(await permission)) {
        setError('Windrow needs permission to reach that server.');
        return;
      }
      if (passphrase.length < 10) {
        setError('Use a passphrase of at least 10 characters.');
        return;
      }
      const result = (await sendMessage({
        type: 'syncSetup',
        endpoint,
        pairingSecret,
        passphrase,
        deviceName,
      })) as SyncSetupResult;

      if (!result?.ok) {
        setError(result?.error ?? 'Setup failed');
        return;
      }
      setNewPhrase(result.recoveryPhrase ?? null);
      setPhraseSaved(false);
      setPassphrase('');
      setPairingSecret('');
      // Show the phrase first. refresh() would flip the mode to "manage" and
      // the user would never see the only copy of their recovery key.
      setMode('recovery');
      setStatus((prev) => ({ ...prev, configured: true, enabled: true }));
    });
  };

  const joinAccount = () => {
    const permission = requestOrigin();
    return run(async () => {
      if (permission !== true && !(await permission)) {
        setError('Windrow needs permission to reach that server.');
        return;
      }
      const result = (await sendMessage({
        type: 'syncPair',
        endpoint,
        pairingSecret,
        passphrase,
        deviceName,
      })) as SyncSetupResult;

      if (!result?.ok) {
        setError(result?.error ?? 'Could not join');
        return;
      }
      setPassphrase('');
      setPairingSecret('');
      setNotice('Connected. Your sessions were pulled from the server.');
      await refresh();
    });
  };

  const unlock = (viaRecovery: boolean) =>
    run(async () => {
      const result = (await sendMessage({
        type: 'syncUnlock',
        secret: viaRecovery ? recovery : passphrase,
        viaRecovery,
      })) as { ok: boolean; error?: string };

      if (!result?.ok) {
        setError(result?.error ?? 'Unlock failed');
        return;
      }
      setPassphrase('');
      setRecovery('');
      setNotice('Unlocked. Syncing now…');
      await refresh();
    });

  const syncNow = () =>
    run(async () => {
      const r = await sendMessage({ type: 'syncNow' });
      if (!r) return;
      if (r.ok) {
        setNotice(`Synced — pushed ${r.pushed ?? 0}, pulled ${r.pulled ?? 0}.`);
      } else {
        setError(r.errors.join('; ') || 'Sync failed');
      }
      await refresh();
    });

  const verify = () =>
    run(async () => {
      const r = await sendMessage({ type: 'syncVerify' });
      if (r?.ok) setNotice(`Server reachable. Revisions stored: ${r.revision ?? 0}.`);
      else setError(r?.error ?? 'Could not reach the server');
    });

  const disconnect = (forget: boolean) =>
    run(async () => {
      const what = forget
        ? 'Remove this server, its permission, and the local sync keys?'
        : 'Pause sync? Your keys stay on this device so you can resume.';
      if (!window.confirm(what)) return;
      await sendMessage({ type: 'syncDisable', forget });
      setNotice(forget ? 'Disconnected and forgot the server.' : 'Sync paused.');
      await refresh();
    });

  const resume = () =>
    run(async () => {
      await sendMessage({ type: 'syncUnlock', secret: passphrase, viaRecovery: false });
      await refresh();
    });

  return (
    <div className="space-y-4">
      {/* Status strip */}
      {status.configured && (
        <div className="rounded-lg border border-surface-border bg-surface-elevated px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
            <span className="flex items-center gap-1.5 font-medium text-text-primary">
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  status.lastError ? 'bg-red-500' : status.enabled ? 'bg-green-500' : 'bg-yellow-500',
                )}
              />
              {status.lastError ? 'Error' : status.enabled ? 'Syncing' : 'Paused'}
            </span>
            <span className="text-text-muted">
              {status.endpoint?.replace(/^https?:\/\//, '')}
            </span>
            {status.fingerprint && (
              <span className="font-mono text-[10px] text-text-muted">
                key {status.fingerprint}
              </span>
            )}
            <span className="ml-auto text-text-muted">
              {status.lastSyncAt ? `Last sync ${formatRelativeTime(status.lastSyncAt)}` : 'Never synced'}
            </span>
          </div>
          {status.lastError && (
            <p className="mt-1 text-[10px] text-red-600 dark:text-red-400">{status.lastError}</p>
          )}
        </div>
      )}

      {/* ── Not configured ── */}
      {mode === 'choose' && !status.configured && (
        <>
          <div className="rounded-md border border-surface-border bg-surface-elevated px-3 py-2.5 text-[11px] leading-relaxed text-text-secondary">
            <p className="font-medium text-text-primary">Optional, and yours</p>
            <p className="mt-1">
              Sync talks to a server <em>you</em> run. Sessions are encrypted on this device
              before upload, so the server holds ciphertext it cannot read. There is no account
              and no vendor in the middle.
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMode('create')}
              className="rounded-lg border border-surface-border px-3 py-3 text-left hover:bg-surface-hover"
            >
              <span className="block text-[12px] font-semibold text-text-primary">
                Set up a new server
              </span>
              <span className="mt-0.5 block text-[11px] text-text-muted">
                First device. Creates the encryption key and recovery phrase.
              </span>
            </button>
            <button
              type="button"
              onClick={() => setMode('join')}
              className="rounded-lg border border-surface-border px-3 py-3 text-left hover:bg-surface-hover"
            >
              <span className="block text-[12px] font-semibold text-text-primary">
                Join an existing one
              </span>
              <span className="mt-0.5 block text-[11px] text-text-muted">
                Second device. Uses the passphrase to unlock the existing key.
              </span>
            </button>
          </div>
        </>
      )}

      {/* ── Create / join forms ── */}
      {(mode === 'create' || mode === 'join') && (
        <div className="space-y-3 rounded-lg border border-surface-border p-3">
          <Field
            label="Server URL"
            hint="Where your sync server is running. http://localhost:8787 for a local one."
          >
            <input
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://sync.example.net"
              spellCheck={false}
              className={inputClass}
            />
          </Field>

          <Field
            label="Pairing secret"
            hint="The WINDROW_PAIRING_SECRET your server was started with. Sent once, stored by the server only as a hash."
          >
            <input
              type="password"
              value={pairingSecret}
              onChange={(e) => setPairingSecret(e.target.value)}
              placeholder="From the server's environment"
              autoComplete="off"
              className={inputClass}
            />
          </Field>

          <Field
            label={mode === 'create' ? 'Encryption passphrase' : 'Existing passphrase'}
            hint={
              mode === 'create'
                ? 'At least 10 characters. It unlocks the data key and never leaves this device.'
                : 'The passphrase set on your first device.'
            }
          >
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoComplete="new-password"
              className={inputClass}
            />
          </Field>

          <Field label="Device name" hint="Shown in the server's device list. Optional.">
            <input
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="Laptop"
              className={inputClass}
            />
          </Field>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={mode === 'create' ? createAccount : joinAccount}
              className="rounded-md bg-accent-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
            >
              {busy ? 'Working…' : mode === 'create' ? 'Create sync account' : 'Connect this device'}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('choose');
                setError(null);
              }}
              className="rounded-md border border-surface-border px-3 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface-hover"
            >
              Back
            </button>
          </div>

          {mode === 'create' && (
            <p className="text-[10px] leading-relaxed text-text-muted">
              You will be shown a 24-word recovery phrase. It is the only way back in if you
              forget the passphrase — there is nobody who can reset it.
            </p>
          )}
        </div>
      )}

      {/* ── Recovery phrase (shown once) ── */}
      {mode === 'recovery' && newPhrase && (
        <div className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <div>
            <p className="text-[12px] font-semibold text-amber-900 dark:text-amber-200">
              Save your recovery phrase
            </p>
            <p className="mt-0.5 text-[11px] text-amber-800 dark:text-amber-300">
              These 24 words unlock your synced data if you forget the passphrase. They are
              shown once and are not stored anywhere.
            </p>
          </div>

          <ol className="grid grid-cols-2 gap-1 rounded-md border border-amber-600/30 bg-surface-base p-2 font-mono text-[11px] sm:grid-cols-3">
            {newPhrase.split(' ').map((word, i) => (
              <li key={`${word}-${i}`} className="flex gap-1.5 text-text-primary">
                <span className="w-4 shrink-0 text-right text-text-muted">{i + 1}.</span>
                <span>{word}</span>
              </li>
            ))}
          </ol>

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(newPhrase);
                setNotice('Recovery phrase copied to the clipboard.');
              }}
              className="rounded-md border border-surface-border bg-surface-base px-2.5 py-1 text-[10px] font-medium text-text-secondary hover:bg-surface-hover"
            >
              Copy
            </button>
            <button
              type="button"
              onClick={() => {
                const blob = new Blob(
                  [
                    'Windrow recovery phrase\n',
                    '=======================\n\n',
                    newPhrase.replace(/ /g, '\n'),
                    '\n\nKeep this offline. Anyone with it can read your synced sessions.\n',
                  ],
                  { type: 'text/plain' },
                );
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'windrow-recovery.txt';
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 10_000);
              }}
              className="rounded-md border border-surface-border bg-surface-base px-2.5 py-1 text-[10px] font-medium text-text-secondary hover:bg-surface-hover"
            >
              Download as text
            </button>
          </div>

          <label className="flex items-start gap-2 text-[11px] text-amber-900 dark:text-amber-200">
            <input
              type="checkbox"
              checked={phraseSaved}
              onChange={(e) => setPhraseSaved(e.target.checked)}
              className="mt-0.5"
            />
            I have saved my recovery phrase somewhere offline.
          </label>

          <button
            type="button"
            disabled={!phraseSaved}
            onClick={() => {
              setNewPhrase(null);
              setPhraseSaved(false);
              setMode('manage');
              setNotice('Sync is on.');
            }}
            className="rounded-md bg-amber-600 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
          >
            Continue
          </button>
        </div>
      )}

      {/* ── Manage ── */}
      {(mode === 'manage' || (status.configured && mode === 'choose')) && (
        <div className="space-y-2 rounded-lg border border-surface-border p-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[11px]">
            <dt className="text-text-muted">Server</dt>
            <dd className="truncate font-mono text-text-primary">{status.endpoint}</dd>
            <dt className="text-text-muted">Device</dt>
            <dd className="text-text-primary">{status.deviceName ?? '—'}</dd>
            <dt className="text-text-muted">Key</dt>
            <dd className="font-mono text-text-primary">{status.fingerprint ?? '—'}</dd>
            <dt className="text-text-muted">Revision</dt>
            <dd className="font-mono text-text-primary">{status.cursor}</dd>
            <dt className="text-text-muted">Recovery</dt>
            <dd className="text-text-primary">{status.hasRecovery ? 'stored on this device' : 'missing'}</dd>
          </dl>

          <div className="flex flex-wrap gap-1.5 pt-1">
            <button
              type="button"
              onClick={syncNow}
              disabled={busy}
              className="rounded-md bg-accent-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
            >
              {busy ? 'Syncing…' : 'Sync now'}
            </button>
            <button
              type="button"
              onClick={verify}
              disabled={busy}
              className="rounded-md border border-surface-border px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface-hover disabled:opacity-50"
            >
              Test connection
            </button>
            <button
              type="button"
              onClick={() => disconnect(false)}
              disabled={busy}
              className="rounded-md border border-surface-border px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface-hover disabled:opacity-50"
            >
              Pause
            </button>
            <button
              type="button"
              onClick={() => disconnect(true)}
              disabled={busy}
              className="ml-auto rounded-md border border-surface-border px-2.5 py-1.5 text-[11px] font-medium text-red-600 hover:bg-surface-hover disabled:opacity-50 dark:text-red-400"
            >
              Forget this server
            </button>
          </div>

          <p className="pt-1 text-[10px] leading-relaxed text-text-muted">
            Forgetting removes the server URL, its host permission, and this device's keys. Data
            already on the server is untouched; delete the server's database to remove it.
          </p>
        </div>
      )}

      {/* ── Paused but configured: offer unlock ── */}
      {status.configured && !status.enabled && mode !== 'recovery' && (
        <div className="space-y-2 rounded-lg border border-surface-border p-3">
          <p className="text-[11px] text-text-secondary">
            Sync is paused. Enter your passphrase to resume on this device.
          </p>
          <div className="flex gap-1.5">
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Passphrase"
              autoComplete="current-password"
              className={inputClass}
            />
            <button
              type="button"
              onClick={resume}
              disabled={busy}
              className="shrink-0 rounded-md bg-accent-600 px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
            >
              Resume
            </button>
          </div>
          <button
            type="button"
            onClick={() => setMode('recovery')}
            className="text-[10px] text-accent-600 underline underline-offset-2 dark:text-accent-400"
          >
            Use a recovery phrase instead
          </button>
        </div>
      )}

      {/* ── Recovery-phrase unlock ── */}
      {mode === 'recovery' && !newPhrase && (
        <div className="space-y-2 rounded-lg border border-surface-border p-3">
          <p className="text-[11px] text-text-secondary">
            Enter your 24-word recovery phrase to unlock syncing on this device.
          </p>
          <textarea
            value={recovery}
            onChange={(e) => setRecovery(e.target.value)}
            rows={3}
            spellCheck={false}
            placeholder="word1 word2 word3 …"
            className={cn(inputClass, 'font-mono')}
          />
          <p className="text-[10px] text-text-muted">
            {recovery.trim() ? (isValidRecoveryPhrase(recovery) ? '✓ Valid phrase' : `${recovery.trim().split(/\s+/).length} of 24 words`) : ''}
          </p>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => unlock(true)}
              disabled={busy || !isValidRecoveryPhrase(recovery)}
              className="rounded-md bg-accent-600 px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
            >
              Unlock
            </button>
            <button
              type="button"
              onClick={() => {
                setMode(status.configured ? 'manage' : 'choose');
                setRecovery('');
              }}
              className="rounded-md border border-surface-border px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface-hover"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Feedback */}
      {error && (
        <p role="alert" className="rounded-md bg-red-500/10 px-3 py-2 text-[11px] text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-md bg-green-500/10 px-3 py-2 text-[11px] text-green-800 dark:text-green-300">
          {notice}
        </p>
      )}

      <details className="rounded-md border border-surface-border px-3 py-2 text-[11px]">
        <summary className="cursor-pointer text-text-secondary">Run your own server</summary>
        <pre className="mt-2 overflow-x-auto rounded-md bg-text-primary p-2.5 font-mono text-[10px] leading-relaxed text-surface-base">
{`# 1. Generate a pairing secret
openssl rand -base64 32

# 2. Start it (Node 22+)
WINDROW_PAIRING_SECRET=… node server/index.mjs

# or with Docker
docker run -d -p 8787:8787 \\
  -e WINDROW_PAIRING_SECRET=… \\
  -v windrow-data:/data \\
  ghcr.io/abominox/windrow-sync`}
        </pre>
        <p className="mt-2 text-[10px] leading-relaxed text-text-muted">
          The server keeps ciphertext, device token hashes, and a monotonic revision counter.
          Put it behind TLS (Caddy, nginx, or a tunnel) before using it from another machine.
        </p>
      </details>
    </div>
  );
}

const inputClass =
  'w-full rounded-md border border-surface-border bg-surface-base px-2 py-1.5 text-[11px] text-text-primary outline-none focus:border-accent-500';

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-text-primary">{label}</span>
      {hint && <span className="mt-0.5 block text-[10px] leading-relaxed text-text-muted">{hint}</span>}
      <span className="mt-1 block">{children}</span>
    </label>
  );
}
