/**
 * Internationalisation, on top of Chrome's `_locales` mechanism.
 *
 * Two reasons this is a wrapper rather than `chrome.i18n.getMessage` everywhere:
 *
 *  1. `chrome.i18n` only exists inside the extension. Unit tests, the dev server
 *     and any Node-side render would otherwise show blank strings. The English
 *     bundle is imported directly as the fallback, so tests keep asserting real
 *     copy instead of placeholders.
 *  2. A missing key would render as an empty string, which is invisible in
 *     review. Here it renders as ⟦key⟧, so it is obvious in the UI and fails
 *     loudly enough to get noticed.
 *
 * English values in `public/_locales/en/messages.json` are byte-identical to the
 * copy that was hardcoded before, so this change is invisible in English.
 */

import en from '../../public/_locales/en/messages.json';

interface MessageEntry {
  message: string;
}

const fallbackMessages = en as unknown as Record<string, MessageEntry>;

type Substitutions = (string | number)[];

/** Replace Chrome's $1..$9 placeholders. */
function substitute(template: string, subs?: Substitutions): string {
  if (!subs || subs.length === 0) return template;
  return template.replace(/\$(\d)/g, (match, digit: string) => {
    const value = subs[Number(digit) - 1];
    return value === undefined ? match : String(value);
  });
}

/** Translate a key. Falls back to the bundled English message. */
export function t(key: string, subs?: Substitutions): string {
  try {
    const api = (globalThis as {
      chrome?: { i18n?: { getMessage?: (k: string, s?: string[]) => string } };
    }).chrome?.i18n;

    const translated = api?.getMessage?.(key, (subs ?? []).map(String));
    if (translated) return translated;
  } catch {
    // Not in an extension context; use the fallback below.
  }

  const fallback = fallbackMessages[key]?.message;
  if (!fallback) return `⟦${key}⟧`;
  return substitute(fallback, subs);
}

/**
 * Pick between a singular and a plural key.
 *
 * Chrome's i18n has no plural rules and no ICU support, so plurals are two
 * messages chosen in code. That is enough for English; a language with more
 * than two forms would need this function to grow a rule table.
 */
export function tn(
  oneKey: string,
  otherKey: string,
  count: number,
  subs?: Substitutions,
): string {
  return t(count === 1 ? oneKey : otherKey, subs ?? [count]);
}

/** The browser's UI language, e.g. `en-US`. */
export function uiLocale(): string {
  try {
    const locale = (globalThis as { chrome?: { i18n?: { getUILanguage?: () => string } } })
      .chrome?.i18n?.getUILanguage?.();
    if (typeof locale === 'string' && locale) return locale;
  } catch {
    // Fall through.
  }
  return 'en';
}
