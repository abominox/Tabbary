import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../app/store';
import { cn } from '@/lib';
import { DataPanel } from '../components/DataPanel';
import { SyncPanel } from '../components/SyncPanel';
import { BackupPanel } from '../components/BackupPanel';
import { setTheme, setDensity, cacheAppearance } from '@/lib/appearance';
import type { Settings } from '@/models';

type SectionId =
  | 'general'
  | 'interface'
  | 'sessions'
  | 'tabs'
  | 'data'
  | 'sync'
  | 'history'
  | 'account';

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'interface', label: 'Interface' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'tabs', label: 'Tabs' },
  { id: 'data', label: 'Import & export' },
  { id: 'sync', label: 'Sync & backup' },
  { id: 'history', label: 'Storage & history' },
  { id: 'account', label: 'Account' },
];

export function Options() {
  const settings = useStore((s) => s.settings);
  const loadSettings = useStore((s) => s.loadSettings);
  const saveSettings = useStore((s) => s.saveSettings);
  const resetSettings = useStore((s) => s.resetSettings);

  const [section, setSection] = useState<SectionId>('general');
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // Keep the document and the cached appearance in step. The cache is what
  // lets other surfaces apply the theme before the service worker answers.
  useEffect(() => {
    setTheme(settings.theme);
    setDensity(settings.density);
    void cacheAppearance(settings.theme, settings.density);
  }, [settings.theme, settings.density]);

  const save = async (patch: Partial<Settings>) => {
    await saveSettings(patch);
    setSavedAt(Date.now());
  };

  const changed = useMemo(() => {
    if (!savedAt) return false;
    return Date.now() - savedAt < 2200;
  }, [savedAt]);

  return (
    <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-6 px-6 py-8">
      <header className="flex items-start gap-3">
        <div className="flex-1">
          <p className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
            tabbary {chrome.runtime.getManifest().version} · MIT
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-text-primary">
            Settings
          </h1>
          <p className="mt-1 max-w-xl text-sm text-text-secondary">
            Defaults favour privacy. Everything is stored in this browser profile, and the
            source is open for anyone to audit.
          </p>
        </div>
        <span
          className={cn(
            'rounded-md bg-green-500/10 px-2 py-1 text-[11px] font-medium text-green-700 transition-opacity dark:text-green-400',
            changed ? 'opacity-100' : 'opacity-0',
          )}
          role="status"
        >
          Saved
        </span>
      </header>

      {/* FOSS strip */}
      <div className="grid gap-2 sm:grid-cols-3">
        {[
          { title: 'Local backups', detail: 'Automatic, on this device' },
          { title: 'Encrypted sync', detail: 'Optional, you hold the key' },
          { title: 'No ads, no account', detail: 'Nothing to sign up for' },
        ].map((item) => (
          <div
            key={item.title}
            className="rounded-lg border border-surface-border bg-surface-elevated px-3 py-2"
          >
            <p className="text-[11px] font-semibold text-text-primary">{item.title}</p>
            <p className="text-[10px] text-text-muted">{item.detail}</p>
          </div>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 gap-6">
        <nav aria-label="Settings sections" className="w-44 shrink-0">
          <ul className="space-y-0.5">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setSection(s.id)}
                  aria-current={section === s.id ? 'page' : undefined}
                  className={cn(
                    'w-full rounded-md px-3 py-1.5 text-left text-[12px] transition-colors',
                    section === s.id
                      ? 'bg-surface-hover font-semibold text-text-primary'
                      : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary',
                  )}
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 flex-1 pb-8">
          {section === 'general' && (
            <Panel title="General" description="Startup and capture behaviour.">
              <SelectRow
                label="Restore sessions on startup"
                hint="Whether tabbary reopens the windows it was tracking when Chrome starts."
                value={settings.restoreOnStartup}
                options={[
                  ['yes', 'Yes, restore'],
                  ['ask', 'Ask each time'],
                  ['no', 'No'],
                ]}
                onChange={(v) => save({ restoreOnStartup: v as Settings['restoreOnStartup'] })}
              />
              <div className="px-3 py-3">
                <p className="text-[12px] font-medium text-text-primary">Session mode</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">
                  Tabbary currently tracks one session per browser window. A combined
                  &ldquo;single window&rdquo; mode is not implemented, so the option is not shown
                  rather than pretending to work.
                </p>
              </div>
              <ToggleRow
                label="Auto-save sessions"
                hint="Persist tabs as they change. Turning this off freezes session state until you save manually."
                checked={settings.autosave}
                onChange={(v) => save({ autosave: v })}
              />
              <SelectRow
                label="Preferred surface"
                hint="Where the toolbar button opens tabbary."
                value={settings.preferredSurface}
                options={[
                  ['sidepanel', 'Side panel'],
                  ['tab', 'Full tab'],
                  ['window', 'Separate window'],
                  ['popup', 'Popup'],
                ]}
                onChange={(v) => save({ preferredSurface: v as Settings['preferredSurface'] })}
              />
              <SelectRow
                label="Search scope"
                hint="What the search box matches. Session names, tab titles and URLs, or both."
                value={settings.searchScope}
                options={[
                  ['all', 'Session names and tabs'],
                  ['sessions', 'Session names only'],
                  ['tabs', 'Tab titles and URLs only'],
                ]}
                onChange={(v) => save({ searchScope: v as Settings['searchScope'] })}
              />
            </Panel>
          )}

          {section === 'interface' && (
            <Panel title="Interface" description="How tabbary looks.">
              <SelectRow
                label="Theme"
                value={settings.theme}
                options={[
                  ['system', 'Match system'],
                  ['light', 'Light'],
                  ['dark', 'Dark'],
                ]}
                onChange={(v) => save({ theme: v as Settings['theme'] })}
              />
              <SelectRow
                label="Density"
                hint="Compact rows fit more sessions in the rail."
                value={settings.density}
                options={[
                  ['comfortable', 'Comfortable'],
                  ['compact', 'Compact'],
                ]}
                onChange={(v) => save({ density: v as Settings['density'] })}
              />
            </Panel>
          )}

          {section === 'sessions' && (
            <Panel title="Sessions" description="What counts as a session, and when it closes.">
              <ToggleRow
                label="Open sessions suspended"
                hint="Restore tabs without loading them until they are clicked."
                checked={settings.openSuspended}
                onChange={(v) => save({ openSuspended: v })}
              />
              <NumberRow
                label="Revisions kept per session"
                hint="Older revisions are pruned first. Higher values use more disk."
                value={settings.versionHistoryLimit}
                min={1}
                max={100}
                onChange={(v) => save({ versionHistoryLimit: v })}
              />
            </Panel>
          )}

          {section === 'tabs' && (
            <Panel title="Tabs" description="Behaviour when restoring and opening tabs.">
              <ToggleRow
                label="Open restored sessions suspended"
                hint="Uses Chrome's native discard rather than rewriting the URL."
                checked={settings.openSuspended}
                onChange={(v) => save({ openSuspended: v })}
              />
              <div className="rounded-md border border-surface-border bg-surface-elevated px-3 py-2.5 text-[11px] leading-relaxed text-text-secondary">
                tabbary calls <code className="font-mono">chrome.tabs.discard</code> instead of
                sending tabs through a third-party suspense service, so the address bar always
                shows the real URL.
              </div>
            </Panel>
          )}

          {section === 'data' && (
            <Panel
              title="Import & export"
              description="Move your sessions in and out. Everything is processed on this device."
            >
              <div className="px-3 py-3">
                <DataPanel />
              </div>
            </Panel>
          )}

          {section === 'sync' && (
            <Panel
              title="Sync & backup"
              description="Optional, self-hosted, and encrypted on this device before anything is uploaded."
            >
              <div className="px-3 py-3">
                <SyncPanel />
              </div>
            </Panel>
          )}

          {section === 'history' && (
            <Panel title="Storage & history" description="What tabbary keeps on this device.">
              <div className="rounded-md border border-surface-border bg-surface-elevated px-3 py-3 text-[11px] text-text-secondary">
                <p className="font-medium text-text-primary">Everything is local</p>
                <p className="mt-1 leading-relaxed">
                  Sessions, groups, tags, and revisions live in IndexedDB inside this browser
                  profile. Nothing is uploaded, and removing the extension removes the data.
                </p>
              </div>
              <div className="px-3 py-3">
                <p className="mb-2 text-[12px] font-medium text-text-primary">Local backups</p>
                <BackupPanel />
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (!confirm('Reset all settings to their defaults?')) return;
                  await resetSettings();
                  setSavedAt(Date.now());
                }}
                className="rounded-md border border-surface-border px-3 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface-hover"
              >
                Reset settings to defaults
              </button>
            </Panel>
          )}

          {section === 'account' && (
            <Panel title="Account" description="There isn't one.">
              <div className="rounded-md border border-surface-border bg-surface-elevated px-3 py-3 text-[11px] leading-relaxed text-text-secondary">
                <p className="font-medium text-text-primary">No account required</p>
                <p className="mt-1">
                  tabbary has no sign-in, no user profile, and no server holding your data. If
                  you later run the optional sync server, it stores ciphertext only and you
                  hold the key.
                </p>
              </div>
              <p className="text-[11px] text-text-muted">
                Licence: MIT · Source:{' '}
                <a
                  className="text-accent-600 underline underline-offset-2"
                  href="https://github.com/abominox/Tabbary"
                  target="_blank"
                  rel="noreferrer"
                >
                  github.com/abominox/Tabbary
                </a>
              </p>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Rows ──────────────────────────────────────────────────

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-base font-semibold text-text-primary">{title}</h2>
      <p className="mb-4 mt-0.5 text-[12px] text-text-muted">{description}</p>
      <div className="space-y-0 divide-y divide-surface-border rounded-lg border border-surface-border">
        {children}
      </div>
    </section>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-4 px-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium text-text-primary">{label}</p>
        {hint && <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Row label={label} hint={hint}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-5 w-9 rounded-full transition-colors disabled:opacity-40',
          checked ? 'bg-accent-600' : 'bg-surface-border',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0.5',
          )}
        />
      </button>
    </Row>
  );
}

function SelectRow({
  label,
  hint,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <Row label={label} hint={hint}>
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-surface-border bg-surface-base px-2 py-1.5 text-[11px] text-text-primary outline-none focus:border-accent-500 disabled:opacity-40"
      >
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </Row>
  );
}

function NumberRow({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <Row label={label} hint={hint}>
      <input
        type="number"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, Math.round(n))));
        }}
        className="w-20 rounded-md border border-surface-border bg-surface-base px-2 py-1.5 text-[11px] text-text-primary outline-none focus:border-accent-500"
      />
    </Row>
  );
}

function TextRow({
  label,
  hint,
  value,
  placeholder,
  disabled,
  onCommit,
}: {
  label: string;
  hint?: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <Row label={label} hint={hint}>
      <input
        type="text"
        aria-label={label}
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== value && onCommit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        className="w-56 rounded-md border border-surface-border bg-surface-base px-2 py-1.5 text-[11px] text-text-primary outline-none focus:border-accent-500 disabled:opacity-40"
      />
    </Row>
  );
}
