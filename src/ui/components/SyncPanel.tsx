import { useEffect, useState } from 'react';
import { sendMessage } from '@/messaging/bus';
import { formatRelativeTime, cn } from '@/lib';
import { t } from '@/lib/i18n';
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
        setError('tabbary needs permission to reach that server.');
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
        setError('tabbary needs permission to reach that server.');
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
              {status.lastError ? t('sync_status_error') : status.enabled ? t('sync_status_syncing') : t('sync_status_paused')}
            </span>
            <span className="text-text-muted">
              {status.endpoint?.replace(/^https?:\/\//, '')}
            </span>
            {status.fingerprint && (
              <span className="font-mono text-[10px] text-text-muted">
                {t('sync_key', [status.fingerprint])}
              </span>
            )}
            <span className="ml-auto text-text-muted">
              {status.lastSyncAt ? t('sync_last_sync', [formatRelativeTime(status.lastSyncAt)]) : t('sync_never')}
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
            <p className="font-medium text-text-primary">{t('sync_optional_title')}</p>
            <p className="mt-1">
              {t('sync_optional_body_before')} <em>{t('sync_optional_body_you')}</em>{' '}
              {t('sync_optional_body_after')}
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMode('create')}
              className="rounded-lg border border-surface-border px-3 py-3 text-left hover:bg-surface-hover"
            >
              <span className="block text-[12px] font-semibold text-text-primary">
                {t('sync_setup_title')}
              </span>
              <span className="mt-0.5 block text-[11px] text-text-muted">
                {t('sync_setup_body')}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setMode('join')}
              className="rounded-lg border border-surface-border px-3 py-3 text-left hover:bg-surface-hover"
            >
              <span className="block text-[12px] font-semibold text-text-primary">
                {t('sync_join_title')}
              </span>
              <span className="mt-0.5 block text-[11px] text-text-muted">
                {t('sync_join_body')}
              </span>
            </button>
          </div>
        </>
      )}

      {/* ── Create / join forms ── */}
      {(mode === 'create' || mode === 'join') && (
        <div className="space-y-3 rounded-lg border border-surface-border p-3">
          <Field
            label={t('sync_server_label')}
            hint={t('sync_server_hint')}
          >
            <input
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder={t('sync_server_placeholder')}
              spellCheck={false}
              className={inputClass}
            />
          </Field>

          <Field
            label={t('sync_secret_label')}
            hint={t('sync_secret_hint')}
          >
            <input
              type="password"
              value={pairingSecret}
              onChange={(e) => setPairingSecret(e.target.value)}
              placeholder={t('sync_secret_placeholder')}
              autoComplete="off"
              className={inputClass}
            />
          </Field>

          <Field
            label={mode === 'create' ? t('sync_pass_create_label') : t('sync_pass_existing_label')}
            hint={
              mode === 'create'
                ? t('sync_pass_create_hint')
                : t('sync_pass_existing_hint')
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

          <Field label={t('sync_device_label')} hint={t('sync_device_hint')}>
            <input
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder={t('sync_device_placeholder')}
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
              {busy ? t('sync_working') : mode === 'create' ? t('sync_create_button') : t('sync_connect_button')}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('choose');
                setError(null);
              }}
              className="rounded-md border border-surface-border px-3 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface-hover"
            >
              {t('sync_back')}
            </button>
          </div>

          {mode === 'create' && (
            <p className="text-[10px] leading-relaxed text-text-muted">
              {t('sync_create_note')}
            </p>
          )}
        </div>
      )}

      {/* ── Recovery phrase (shown once) ── */}
      {mode === 'recovery' && newPhrase && (
        <div className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <div>
            <p className="text-[12px] font-semibold text-amber-900 dark:text-amber-200">
              {t('sync_recovery_title')}
            </p>
            <p className="mt-0.5 text-[11px] text-amber-800 dark:text-amber-300">
              {t('sync_recovery_body')}
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
                setNotice(t('sync_copied'));
              }}
              className="rounded-md border border-surface-border bg-surface-base px-2.5 py-1 text-[10px] font-medium text-text-secondary hover:bg-surface-hover"
            >
              {t('sync_copy')}
            </button>
            <button
              type="button"
              onClick={() => {
                const blob = new Blob(
                  [
                    t('sync_recovery_file_header'), '\n',
                    '=======================\n\n',
                    newPhrase.replace(/ /g, '\n'),
                    '\n\n', t('sync_recovery_file_footer'), '\n',
                  ],
                  { type: 'text/plain' },
                );
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'tabbary-recovery.txt';
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 10_000);
              }}
              className="rounded-md border border-surface-border bg-surface-base px-2.5 py-1 text-[10px] font-medium text-text-secondary hover:bg-surface-hover"
            >
              {t('sync_download')}
            </button>
          </div>

          <label className="flex items-start gap-2 text-[11px] text-amber-900 dark:text-amber-200">
            <input
              type="checkbox"
              checked={phraseSaved}
              onChange={(e) => setPhraseSaved(e.target.checked)}
              className="mt-0.5"
            />
            {t('sync_saved_checkbox')}
          </label>

          <button
            type="button"
            disabled={!phraseSaved}
            onClick={() => {
              setNewPhrase(null);
              setPhraseSaved(false);
              setMode('manage');
              setNotice(t('sync_on'));
            }}
            className="rounded-md bg-amber-600 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
          >
            {t('sync_continue')}
          </button>
        </div>
      )}

      {/* ── Manage ── */}
      {(mode === 'manage' || (status.configured && mode === 'choose')) && (
        <div className="space-y-2 rounded-lg border border-surface-border p-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[11px]">
            <dt className="text-text-muted">{t('sync_field_server')}</dt>
            <dd className="truncate font-mono text-text-primary">{status.endpoint}</dd>
            <dt className="text-text-muted">{t('sync_field_device')}</dt>
            <dd className="text-text-primary">{status.deviceName ?? '—'}</dd>
            <dt className="text-text-muted">{t('sync_field_key')}</dt>
            <dd className="font-mono text-text-primary">{status.fingerprint ?? '—'}</dd>
            <dt className="text-text-muted">{t('sync_field_revision')}</dt>
            <dd className="font-mono text-text-primary">{status.cursor}</dd>
            <dt className="text-text-muted">{t('sync_field_recovery')}</dt>
            <dd className="text-text-primary">{status.hasRecovery ? t('sync_recovery_stored') : t('sync_recovery_missing')}</dd>
          </dl>

          <div className="flex flex-wrap gap-1.5 pt-1">
            <button
              type="button"
              onClick={syncNow}
              disabled={busy}
              className="rounded-md bg-accent-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
            >
              {busy ? t('sync_syncing') : t('sync_now')}
            </button>
            <button
              type="button"
              onClick={verify}
              disabled={busy}
              className="rounded-md border border-surface-border px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface-hover disabled:opacity-50"
            >
              {t('sync_test')}
            </button>
            <button
              type="button"
              onClick={() => disconnect(false)}
              disabled={busy}
              className="rounded-md border border-surface-border px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface-hover disabled:opacity-50"
            >
              {t('sync_pause')}
            </button>
            <button
              type="button"
              onClick={() => disconnect(true)}
              disabled={busy}
              className="ml-auto rounded-md border border-surface-border px-2.5 py-1.5 text-[11px] font-medium text-red-600 hover:bg-surface-hover disabled:opacity-50 dark:text-red-400"
            >
              {t('sync_forget')}
            </button>
          </div>

          <p className="pt-1 text-[10px] leading-relaxed text-text-muted">
            {t('sync_forget_note')}
          </p>
        </div>
      )}

      {/* ── Paused but configured: offer unlock ── */}
      {status.configured && !status.enabled && mode !== 'recovery' && (
        <div className="space-y-2 rounded-lg border border-surface-border p-3">
          <p className="text-[11px] text-text-secondary">
            {t('sync_paused_body')}
          </p>
          <div className="flex gap-1.5">
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder={t('sync_pass_placeholder')}
              autoComplete="current-password"
              className={inputClass}
            />
            <button
              type="button"
              onClick={resume}
              disabled={busy}
              className="shrink-0 rounded-md bg-accent-600 px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
            >
              {t('sync_resume')}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setMode('recovery')}
            className="text-[10px] text-accent-600 underline underline-offset-2 dark:text-accent-400"
          >
            {t('sync_use_recovery')}
          </button>
        </div>
      )}

      {/* ── Recovery-phrase unlock ── */}
      {mode === 'recovery' && !newPhrase && (
        <div className="space-y-2 rounded-lg border border-surface-border p-3">
          <p className="text-[11px] text-text-secondary">
            {t('sync_unlock_body')}
          </p>
          <textarea
            value={recovery}
            onChange={(e) => setRecovery(e.target.value)}
            rows={3}
            spellCheck={false}
            placeholder={t('sync_words_placeholder')}
            className={cn(inputClass, 'font-mono')}
          />
          <p className="text-[10px] text-text-muted">
            {recovery.trim() ? (isValidRecoveryPhrase(recovery) ? t('sync_phrase_valid') : t('sync_phrase_progress', [recovery.trim().split(/\s+/).length])) : ''}
          </p>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => unlock(true)}
              disabled={busy || !isValidRecoveryPhrase(recovery)}
              className="rounded-md bg-accent-600 px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
            >
              {t('sync_unlock')}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode(status.configured ? 'manage' : 'choose');
                setRecovery('');
              }}
              className="rounded-md border border-surface-border px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface-hover"
            >
              {t('sync_cancel')}
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
        <summary className="cursor-pointer text-text-secondary">{t('sync_run_own')}</summary>
        <pre className="mt-2 overflow-x-auto rounded-md bg-text-primary p-2.5 font-mono text-[10px] leading-relaxed text-surface-base">
{`# 1. Generate a pairing secret
openssl rand -base64 32

# 2. Start it (Node 22+)
TABBARY_PAIRING_SECRET=… node server/index.mjs

# or with Docker
docker run -d -p 8787:8787 \\
  -e TABBARY_PAIRING_SECRET=… \\
  -v tabbary-data:/data \\
  ghcr.io/abominox/tabbary-sync`}
        </pre>
        <p className="mt-2 text-[10px] leading-relaxed text-text-muted">
          {t('sync_run_own_note')}
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
