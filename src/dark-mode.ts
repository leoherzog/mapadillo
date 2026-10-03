/**
 * Dark mode manager.
 *
 * Persists an explicit light/dark choice to localStorage and otherwise follows
 * prefers-color-scheme. Applies the `wa-dark` class and color-scheme to <html>.
 */
import { createPreference } from './utils/preference.js';

const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)';

const preference = createPreference<'light' | 'dark'>(
  'mapadillo-dark-mode',
  ['light', 'dark'],
  () => (matchMedia(SYSTEM_DARK_QUERY).matches ? 'dark' : 'light'),
);

/** Whether dark mode is currently active. */
export function isDark(): boolean {
  return preference.get() === 'dark';
}

/**
 * Call `fn` whenever dark mode turns on or off.
 * @returns an unsubscribe function
 */
export const onDarkModeChange = preference.subscribe;

/** Store the opposite of the current mode as an explicit choice. */
export function toggleDarkMode(): void {
  preference.set(isDark() ? 'light' : 'dark');
}

function applyDark(): void {
  const dark = isDark();
  document.documentElement.classList.toggle('wa-dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

/** Apply the current mode and keep <html> in sync. Call once from index.ts. */
export function initDarkMode(): void {
  applyDark();
  preference.subscribe(applyDark);

  // The OS setting only matters while no explicit choice is stored.
  matchMedia(SYSTEM_DARK_QUERY).addEventListener('change', () => {
    if (preference.stored() === null) preference.notify();
  });
}
