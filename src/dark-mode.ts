/**
 * Dark mode manager.
 *
 * - Persists preference to localStorage
 * - Falls back to prefers-color-scheme
 * - Toggles `wa-dark` class on <html> and sets color-scheme
 * - Dispatches 'dark-mode-change' on document for reactive updates
 */

const STORAGE_KEY = 'mapadillo-dark-mode';

type Preference = 'light' | 'dark' | 'auto';

function getSystemPrefersDark(): boolean {
  return matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyDark(dark: boolean): void {
  document.documentElement.classList.toggle('wa-dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

/** Read stored preference, defaulting to 'auto'. */
export function getPreference(): Preference {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return 'auto';
}

/** Whether dark mode is currently active. */
export function isDark(): boolean {
  return document.documentElement.classList.contains('wa-dark');
}

/** Set preference and apply immediately. */
export function setDarkMode(pref: Preference): void {
  if (pref === 'auto') {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, pref);
  }
  applyDark(pref === 'auto' ? getSystemPrefersDark() : pref === 'dark');
  document.dispatchEvent(new CustomEvent('dark-mode-change', { detail: { dark: isDark() } }));
}

/** Toggle between light and dark (ignores auto). */
export function toggleDarkMode(): void {
  setDarkMode(isDark() ? 'light' : 'dark');
}

/** Initialize on page load. Call once from index.ts. */
export function initDarkMode(): void {
  const pref = getPreference();
  applyDark(pref === 'auto' ? getSystemPrefersDark() : pref === 'dark');

  // Listen for OS preference changes when set to auto
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (getPreference() === 'auto') {
      applyDark(e.matches);
      document.dispatchEvent(new CustomEvent('dark-mode-change', { detail: { dark: e.matches } }));
    }
  });
}
