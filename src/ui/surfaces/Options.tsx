import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../app/store';
import { cn } from '@/lib';
import { t } from '@/lib/i18n';
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
  { id: 'general', label: 'opt_section_general' },
  { id: 'interface', label: 'opt_section_interface' },
  { id: 'sessions', label: 'opt_section_sessions' },
  { id: 'tabs', label: 'opt_section_tabs' },
  { id: 'data', label: 'opt_section_data' },
  { id: 'sync', label: 'opt_section_sync' },
  { id: 'history', label: 'opt_section_history' },
  { id: 'account', label: 'opt_section_account' },
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
            {t('opt_version_line', [chrome.runtime.getManifest().version])}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-text-primary">
            {t('opt_title')}
          </h1>
          <p className="mt-1 max-w-xl text-sm text-text-secondary">
            {t('opt_intro')}
          </p>
        </div>
        <span
          className={cn(
            'rounded-md bg-green-500/10 px-2 py-1 text-[11px] font-medium text-green-700 transition-opacity dark:text-green-400',
            changed ? 'opacity-100' : 'opacity-0',
          )}
          role="status"
        >
          {t('opt_saved')}
        </span>
      </header>

      {/* FOSS strip */}
      <div className="grid gap-2 sm:grid-cols-3">
        {[
          { title: t('opt_strip_backups'), detail: t('opt_strip_backups_detail') },
          { title: t('opt_strip_sync'), detail: t('opt_strip_sync_detail') },
          { title: t('opt_strip_no_ads'), detail: t('opt_strip_no_ads_detail') },
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
        <nav aria-label={t('opt_sections_label')} className="w-44 shrink-0">
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
                  {t(s.label)}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 flex-1 pb-8">
          {section === 'general' && (
            <Panel title={t('opt_section_general')} description={t('opt_general_desc')}>
              <SelectRow
                label={t('opt_restore_label')}
                hint={t('opt_restore_hint')}
                value={settings.restoreOnStartup}
                options={[
                  ['yes', t('opt_restore_yes')],
                  ['ask', t('opt_restore_ask')],
                  ['no', t('opt_restore_no')],
                ]}
                onChange={(v) => save({ restoreOnStartup: v as Settings['restoreOnStartup'] })}
              />
              <div className="px-3 py-3">
                <p className="text-[12px] font-medium text-text-primary">{t('opt_session_mode')}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">
                  {t('opt_session_mode_body')}
                </p>
              </div>
              <ToggleRow
                label={t('opt_autosave_label')}
                hint={t('opt_autosave_hint')}
                checked={settings.autosave}
                onChange={(v) => save({ autosave: v })}
              />
              <SelectRow
                label={t('opt_surface_label')}
                hint={t('opt_surface_hint')}
                value={settings.preferredSurface}
                options={[
                  ['sidepanel', t('opt_surface_sidepanel')],
                  ['tab', t('opt_surface_tab')],
                  ['window', t('opt_surface_window')],
                  ['popup', t('opt_surface_popup')],
                ]}
                onChange={(v) => save({ preferredSurface: v as Settings['preferredSurface'] })}
              />
              <SelectRow
                label={t('opt_search_label')}
                hint={t('opt_search_hint')}
                value={settings.searchScope}
                options={[
                  ['all', t('opt_search_all')],
                  ['sessions', t('opt_search_sessions')],
                  ['tabs', t('opt_search_tabs')],
                ]}
                onChange={(v) => save({ searchScope: v as Settings['searchScope'] })}
              />
            </Panel>
          )}

          {section === 'interface' && (
            <Panel title={t('opt_section_interface')} description={t('opt_interface_desc')}>
              <SelectRow
                label={t('opt_theme_label')}
                value={settings.theme}
                options={[
                  ['system', t('opt_theme_system')],
                  ['light', t('opt_theme_light')],
                  ['dark', t('opt_theme_dark')],
                ]}
                onChange={(v) => save({ theme: v as Settings['theme'] })}
              />
              <SelectRow
                label={t('opt_density_label')}
                hint={t('opt_density_hint')}
                value={settings.density}
                options={[
                  ['comfortable', t('opt_density_comfortable')],
                  ['compact', t('opt_density_compact')],
                ]}
                onChange={(v) => save({ density: v as Settings['density'] })}
              />
            </Panel>
          )}

          {section === 'sessions' && (
            <Panel title={t('opt_section_sessions')} description={t('opt_sessions_desc')}>
              <ToggleRow
                label={t('opt_open_suspended_label')}
                hint={t('opt_open_suspended_hint')}
                checked={settings.openSuspended}
                onChange={(v) => save({ openSuspended: v })}
              />
              <NumberRow
                label={t('opt_revisions_label')}
                hint={t('opt_revisions_hint')}
                value={settings.versionHistoryLimit}
                min={1}
                max={100}
                onChange={(v) => save({ versionHistoryLimit: v })}
              />
            </Panel>
          )}

          {section === 'tabs' && (
            <Panel title={t('opt_section_tabs')} description={t('opt_tabs_desc')}>
              <ToggleRow
                label={t('opt_tabs_suspended_label')}
                hint={t('opt_tabs_suspended_hint')}
                checked={settings.openSuspended}
                onChange={(v) => save({ openSuspended: v })}
              />
              <div className="rounded-md border border-surface-border bg-surface-elevated px-3 py-2.5 text-[11px] leading-relaxed text-text-secondary">
                {t('opt_discard_note_before')}{' '}
                <code className="font-mono">chrome.tabs.discard</code>{' '}
                {t('opt_discard_note_after')}
              </div>
            </Panel>
          )}

          {section === 'data' && (
            <Panel
              title={t('opt_section_data')}
              description={t('opt_data_desc')}
            >
              <div className="px-3 py-3">
                <DataPanel />
              </div>
            </Panel>
          )}

          {section === 'sync' && (
            <Panel
              title={t('opt_section_sync')}
              description={t('opt_sync_desc')}
            >
              <div className="px-3 py-3">
                <SyncPanel />
              </div>
            </Panel>
          )}

          {section === 'history' && (
            <Panel title={t('opt_section_history')} description={t('opt_history_desc')}>
              <div className="rounded-md border border-surface-border bg-surface-elevated px-3 py-3 text-[11px] text-text-secondary">
                <p className="font-medium text-text-primary">{t('opt_local_title')}</p>
                <p className="mt-1 leading-relaxed">
                  {t('opt_local_body')}
                </p>
              </div>
              <div className="px-3 py-3">
                <p className="mb-2 text-[12px] font-medium text-text-primary">{t('opt_backups_title')}</p>
                <BackupPanel />
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (!confirm(t('opt_reset_confirm'))) return;
                  await resetSettings();
                  setSavedAt(Date.now());
                }}
                className="rounded-md border border-surface-border px-3 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface-hover"
              >
                {t('opt_reset_button')}
              </button>
            </Panel>
          )}

          {section === 'account' && (
            <Panel title={t('opt_section_account')} description={t('opt_account_desc')}>
              <div className="rounded-md border border-surface-border bg-surface-elevated px-3 py-3 text-[11px] leading-relaxed text-text-secondary">
                <p className="font-medium text-text-primary">{t('opt_account_title')}</p>
                <p className="mt-1">
                  {t('opt_account_body')}
                </p>
              </div>
              <p className="text-[11px] text-text-muted">
                {t('opt_licence_before')}{' '}
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
