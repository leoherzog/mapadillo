/**
 * Global distance-units manager.
 *
 * - Syncs to server when authenticated (per-account preference)
 * - Falls back to localStorage / browser locale for anonymous users
 * - Dispatches 'units-change' on document for reactive updates
 */

import { apiGet, apiPut } from './services/api-client.js';
import { isAuthenticated, onAuthChange } from './auth/auth-state.js';

const STORAGE_KEY = 'mapadillo-units';

export type Units = 'km' | 'mi';

/** Detect sensible default from browser locale via Intl API. */
function detectDefault(): Units {
  const region = new Intl.Locale(navigator.language).region?.toUpperCase();
  return region === 'US' || region === 'GB' ? 'mi' : 'km';
}

/** Read stored preference, falling back to locale-based default. */
export function getUnits(): Units {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'km' || stored === 'mi') return stored;
  return detectDefault();
}

function _apply(units: Units): void {
  localStorage.setItem(STORAGE_KEY, units);
  document.dispatchEvent(new CustomEvent('units-change', { detail: { units } }));
}

/** Set units and notify listeners. Saves to server if authenticated. */
export function setUnits(units: Units): void {
  _apply(units);
  if (isAuthenticated()) {
    apiPut('/api/user/preferences', { units }).catch(() => {});
  }
}

/** Toggle between km and mi. */
export function toggleUnits(): void {
  setUnits(getUnits() === 'km' ? 'mi' : 'km');
}

/**
 * Fetch units from server and sync to localStorage.
 * Called automatically when auth state changes.
 */
async function _syncFromServer(): Promise<void> {
  try {
    const { units } = await apiGet<{ units: Units }>('/api/user/preferences');
    if (units === 'km' || units === 'mi') {
      _apply(units);
    }
  } catch {
    // Offline or not authenticated — keep localStorage value
  }
}

/** Initialize: sync from server on sign-in, clear on sign-out. */
export function initUnits(): void {
  onAuthChange(() => {
    if (isAuthenticated()) {
      _syncFromServer();
    }
  });
}
