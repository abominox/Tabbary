/**
 * Apply user appearance settings to the document.
 *
 * Theme was previously only applied inside the options page, so choosing
 * "dark" had no effect anywhere else. This runs in every surface and follows
 * the system preference when set to "system".
 */

export type Theme = 'light' | 'dark' | 'system';
export type Density = 'comfortable' | 'compact';

/** Read the cached settings without needing the service worker. */
export async function applyAppearance(): Promise<void> {
  let theme: Theme = 'system';
  let density: Density = 'comfortable';

  try {
    const stored = await chrome.storage.local.get('tabbary.appearance');
    const cached = stored['tabbary.appearance'] as { theme?: Theme; density?: Density } | undefined;
    if (cached?.theme) theme = cached.theme;
    if (cached?.density) density = cached.density;
  } catch {
    /* storage may be unavailable during teardown */
  }

  setTheme(theme);
  setDensity(density);
}

export function setTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else if (theme === 'light') {
    root.classList.remove('dark');
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.classList.toggle('dark', prefersDark);
  }
  root.dataset.theme = theme;
}

export function setDensity(density: Density): void {
  document.documentElement.dataset.density = density;
}

/** Cache appearance so surfaces can apply it before the SW responds. */
export async function cacheAppearance(theme: Theme, density: Density): Promise<void> {
  await chrome.storage.local.set({ 'tabbary.appearance': { theme, density } });
  setTheme(theme);
  setDensity(density);
}

/** Watch the system preference while the theme is "system". */
export function watchSystemTheme(getTheme: () => Theme): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (getTheme() === 'system') setTheme('system');
  };
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
