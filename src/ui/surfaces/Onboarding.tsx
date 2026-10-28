import { useEffect, useState } from 'react';
import { sendMessage } from '@/messaging/bus';
import { cn } from '@/lib';
import { t } from '@/lib/i18n';
import type { SyncStatus } from '@/messaging/sync';

type Step = 'welcome' | 'capture' | 'surfaces' | 'privacy' | 'done';

const STEPS: Step[] = ['welcome', 'capture', 'surfaces', 'privacy', 'done'];

/**
 * First-run onboarding.
 *
 * Deliberately short: three claims the product actually keeps, then out of the
 * way. No account, no email, no tour that requires clicking through ten cards.
 */
export function Onboarding() {
  const [step, setStep] = useState<Step>('welcome');
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [restore, setRestore] = useState<'yes' | 'ask' | 'no'>('yes');

  useEffect(() => {
    sendMessage({ type: 'syncState' }).then(setStatus).catch(() => {});
  }, []);

  const index = STEPS.indexOf(step);
  const next = () => setStep(STEPS[Math.min(index + 1, STEPS.length - 1)]!);
  const back = () => setStep(STEPS[Math.max(index - 1, 0)]!);

  const finish = async () => {
    await sendMessage({ type: 'finishOnboarding', restoreOnStartup: restore }).catch(() => {});
    const full = await chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
    // Close this onboarding tab so the manager is the only thing left.
    const self = await chrome.tabs.getCurrent();
    if (self?.id != null) chrome.tabs.remove(self.id).catch(() => {});
    void full;
  };

  return (
    <div className="flex min-h-full flex-col bg-surface-base text-text-primary">
      {/* Progress */}
      <header className="flex shrink-0 items-center gap-3 border-b border-surface-border px-6 py-3">
        <span className="flex items-center gap-2 text-[13px] font-bold">
          <span className="grid h-5 w-5 place-items-center rounded bg-text-primary text-[10px] text-surface-base">
            W
          </span>
          tabbary
        </span>
        <ol className="ml-auto flex items-center gap-1" aria-label={t('ob_progress')}>
          {STEPS.slice(0, 4).map((s, i) => (
            <li
              key={s}
              aria-current={s === step ? 'step' : undefined}
              className={cn(
                'h-1.5 rounded-full transition-all',
                i <= index ? 'w-6 bg-accent-600' : 'w-3 bg-surface-border',
              )}
              title={s}
            />
          ))}
        </ol>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-10">
        {step === 'welcome' && (
          <Section
            eyebrow={t('ob_eyebrow_local_first')}
            title={t('ob_welcome_title')}
            body={t('ob_welcome_body')}
          >
            <ul className="mt-6 space-y-2 text-[13px] text-text-secondary">
              <Fact label={t('ob_fact_no_account_label')}>{t('ob_fact_no_account_body')}</Fact>
              <Fact label={t('ob_fact_stored_label')}>{t('ob_fact_stored_body')}</Fact>
              <Fact label={t('ob_fact_mit_label')}>{t('ob_fact_mit_body')}</Fact>
            </ul>
          </Section>
        )}

        {step === 'capture' && (
          <Section
            eyebrow={t('ob_capture_eyebrow')}
            title={t('ob_capture_title')}
            body={t('ob_capture_body')}
          >
            <fieldset className="mt-6">
              <legend className="text-[12px] font-medium text-text-primary">
                {t('ob_restore_legend')}
              </legend>
              <div className="mt-2 space-y-1.5">
                {(
                  [
                    ['yes', t('ob_restore_yes_label'), t('ob_restore_yes_hint')],
                    ['ask', t('ob_restore_ask_label'), t('ob_restore_ask_hint')],
                    ['no', t('ob_restore_no_label'), t('ob_restore_no_hint')],
                  ] as const
                ).map(([value, label, hint]) => (
                  <label
                    key={value}
                    className={cn(
                      'flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-[12px]',
                      restore === value
                        ? 'border-accent-500 bg-accent-50/40 dark:bg-accent-500/10'
                        : 'border-surface-border hover:bg-surface-hover',
                    )}
                  >
                    <input
                      type="radio"
                      name="restore"
                      value={value}
                      checked={restore === value}
                      onChange={() => setRestore(value)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block font-medium text-text-primary">{label}</span>
                      <span className="block text-[11px] text-text-muted">{hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </Section>
        )}

        {step === 'surfaces' && (
          <Section
            eyebrow={t('ob_surfaces_eyebrow')}
            title={t('ob_surfaces_title')}
            body={t('ob_surfaces_body')}
          >
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              {[
                [t('ob_surface_popup_title'), t('ob_surface_popup_body')],
                [t('ob_surface_tab_title'), t('ob_surface_tab_body')],
                [t('ob_surface_window_title'), t('ob_surface_window_body')],
                [t('ob_surface_side_title'), t('ob_surface_side_body')],
              ].map(([title, body]) => (
                <div
                  key={title}
                  className="rounded-lg border border-surface-border bg-surface-elevated px-3 py-2.5"
                >
                  <p className="text-[12px] font-semibold text-text-primary">{title}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">{body}</p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {step === 'privacy' && (
          <Section
            eyebrow={t('ob_privacy_eyebrow')}
            title={t('ob_privacy_title')}
            body={t('ob_privacy_body')}
          >
            <div className="mt-6 space-y-2 text-[12px]">
              <div className="rounded-lg border border-surface-border bg-surface-elevated px-3 py-2.5">
                <p className="font-medium text-text-primary">{t('ob_sync_title')}</p>
                <p className="mt-0.5 leading-relaxed text-text-muted">
                  {status?.configured
                    ? t('ob_sync_connected', [status.endpoint?.replace(/^https?:\/\//, '') ?? ''])
                    : t('ob_sync_off')}
                </p>
              </div>
              <div className="rounded-lg border border-surface-border bg-surface-elevated px-3 py-2.5">
                <p className="font-medium text-text-primary">{t('ob_export_title')}</p>
                <p className="mt-0.5 leading-relaxed text-text-muted">
                  {t('ob_export_body')}
                </p>
              </div>
            </div>
          </Section>
        )}

        {step === 'done' && (
          <Section
            eyebrow={t('ob_done_eyebrow')}
            title={t('ob_done_title')}
            body={t('ob_done_body')}
          >
            <div className="mt-6 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void finish()}
                className="rounded-md bg-accent-600 px-4 py-2 text-[12px] font-semibold text-white hover:bg-accent-700"
              >
                {t('ob_open_button')}
              </button>
              <button
                type="button"
                onClick={() => chrome.runtime.openOptionsPage()}
                className="rounded-md border border-surface-border px-4 py-2 text-[12px] font-medium text-text-secondary hover:bg-surface-hover"
              >
                {t('common_settings')}
              </button>
            </div>
            <p className="mt-4 text-[11px] text-text-muted">
              {t('ob_revisit')}
            </p>
          </Section>
        )}
      </main>

      {step !== 'done' && (
        <footer className="flex shrink-0 items-center gap-2 border-t border-surface-border px-6 py-3">
          {index > 0 && (
            <button
              type="button"
              onClick={back}
              className="rounded-md border border-surface-border px-3 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface-hover"
            >
              Back
            </button>
          )}
          <button
            type="button"
            onClick={next}
            className="ml-auto rounded-md bg-accent-600 px-4 py-1.5 text-[11px] font-semibold text-white hover:bg-accent-700"
          >
            {index === 3 ? 'Finish' : 'Next'}
          </button>
        </footer>
      )}
    </div>
  );
}

function Section({
  eyebrow,
  title,
  body,
  children,
}: {
  eyebrow: string;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <section>
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-accent-600 dark:text-accent-400">
        {eyebrow}
      </p>
      <h1 className="mt-2 text-balance text-[26px] font-semibold leading-tight tracking-tight text-text-primary">
        {title}
      </h1>
      <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-text-secondary">{body}</p>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" aria-hidden="true" />
      <span>
        <span className="font-medium text-text-primary">{label}</span> — {children}
      </span>
    </li>
  );
}
