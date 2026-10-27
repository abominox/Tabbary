import { useEffect, useState } from 'react';
import { sendMessage } from '@/messaging/bus';
import { cn } from '@/lib';
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
          Tabbary
        </span>
        <ol className="ml-auto flex items-center gap-1" aria-label="Onboarding progress">
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
            eyebrow="Local-first"
            title="Your windows, kept the way you left them."
            body="Tabbary saves each browser window as a session the moment it changes — tabs, groups and all. Close a window by accident, or crash, and it is still there."
          >
            <ul className="mt-6 space-y-2 text-[13px] text-text-secondary">
              <Fact label="No account">Nothing to sign up for, no email, no profile.</Fact>
              <Fact label="Stored here">Everything lives in this Chrome profile.</Fact>
              <Fact label="MIT">The source is open, so you can audit or fork it.</Fact>
            </ul>
          </Section>
        )}

        {step === 'capture' && (
          <Section
            eyebrow="Capture"
            title="Sessions save themselves."
            body="There is no save button to forget. Every tab, group, pin and window move is written shortly after it happens, and each session keeps a short revision history."
          >
            <fieldset className="mt-6">
              <legend className="text-[12px] font-medium text-text-primary">
                When Chrome starts, restore the windows Tabbary was tracking?
              </legend>
              <div className="mt-2 space-y-1.5">
                {(
                  [
                    ['yes', 'Yes, restore', 'Matched back to their sessions by URL, so history survives.'],
                    ['ask', 'Ask each time', 'Show a prompt with the matches and let me choose.'],
                    ['no', 'No', 'Leave everything closed; I will restore manually.'],
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
            eyebrow="Four ways in"
            title="Where you need it, not where we say."
            body="The same library is available as a popup, a side panel, a dedicated window, and a full tab. They share state, so switching is cheap."
          >
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              {[
                ['Popup', 'Click the toolbar icon. Alt+A opens the side panel.'],
                ['Full tab', 'Alt+S. The three-pane manager with drag-and-drop.'],
                ['Dedicated window', 'A compact two-pane view for a second screen.'],
                ['Side panel', 'Stays open beside the page you are reading.'],
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
            eyebrow="Privacy"
            title="Nothing leaves unless you say so."
            body="The extension asks for no host permissions at install. History and bookmark access are optional and requested only when you use those features."
          >
            <div className="mt-6 space-y-2 text-[12px]">
              <div className="rounded-lg border border-surface-border bg-surface-elevated px-3 py-2.5">
                <p className="font-medium text-text-primary">Sync is optional and self-hosted</p>
                <p className="mt-0.5 leading-relaxed text-text-muted">
                  {status?.configured
                    ? `Connected to ${status.endpoint?.replace(/^https?:\/\//, '')}. Blobs are encrypted here before upload.`
                    : 'Off by default. If you turn it on, you point it at a server you run; it stores ciphertext only.'}
                </p>
              </div>
              <div className="rounded-lg border border-surface-border bg-surface-elevated px-3 py-2.5">
                <p className="font-medium text-text-primary">Export anytime</p>
                <p className="mt-0.5 leading-relaxed text-text-muted">
                  Settings → Import &amp; export writes plain JSON or a passphrase-encrypted
                  file. No lock-in.
                </p>
              </div>
            </div>
          </Section>
        )}

        {step === 'done' && (
          <Section
            eyebrow="Ready"
            title="That's it."
            body="Open a window and Tabbary starts capturing. Press ? in the manager for keyboard shortcuts."
          >
            <div className="mt-6 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void finish()}
                className="rounded-md bg-accent-600 px-4 py-2 text-[12px] font-semibold text-white hover:bg-accent-700"
              >
                Open Tabbary
              </button>
              <button
                type="button"
                onClick={() => chrome.runtime.openOptionsPage()}
                className="rounded-md border border-surface-border px-4 py-2 text-[12px] font-medium text-text-secondary hover:bg-surface-hover"
              >
                Settings
              </button>
            </div>
            <p className="mt-4 text-[11px] text-text-muted">
              You can revisit these settings any time; nothing here is permanent.
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
