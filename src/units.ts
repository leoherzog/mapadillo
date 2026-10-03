/**
 * Global distance-units manager.
 *
 * Persists to localStorage with a locale-based default for anonymous users, and
 * syncs with the per-account server preference while signed in.
 */

import { apiGet, apiPut } from './services/api-client.js';
import { isAuthenticated, onAuthChange } from './auth/auth-state.js';
import { createPreference } from './utils/preference.js';
import { UNIT_NAMES, VALID_UNITS, type Units } from '../shared/units.js';

/** Detect sensible default from browser locale via Intl API. */
function detectDefault(): Units {
  const region = new Intl.Locale(navigator.language).region?.toUpperCase();
  return region === 'US' || region === 'GB' ? 'mi' : 'km';
}

const preference = createPreference<Units>('mapadillo-units', UNIT_NAMES, detectDefault);

/** Read stored preference, falling back to locale-based default. */
export const getUnits = preference.get;

/**
 * Call `fn` whenever the units change.
 * @returns an unsubscribe function
 */
export const onUnitsChange = preference.subscribe;

/** Set units and notify listeners. Saves to server if authenticated. */
export function setUnits(units: Units): void {
  preference.set(units);
  if (isAuthenticated()) {
    apiPut('/api/user/preferences', { units }).catch(() => {});
  }
}

/** Toggle between km and mi. */
export function toggleUnits(): void {
  setUnits(getUnits() === 'km' ? 'mi' : 'km');
}

/** Adopt the account's units locally, or save the local units to an account that has none. */
async function _syncFromServer(): Promise<void> {
  try {
    const { units } = await apiGet<{ units: Units | null }>('/api/user/preferences');
    if (units === null) {
      await apiPut('/api/user/preferences', { units: getUnits() });
    } else if (VALID_UNITS.has(units)) {
      preference.set(units);
    }
  } catch {
    // Offline or not authenticated — keep localStorage value
  }
}

/** Initialize: sync from server whenever the user signs in. */
export function initUnits(): void {
  onAuthChange(() => {
    if (isAuthenticated()) {
      _syncFromServer();
    }
  });
}
