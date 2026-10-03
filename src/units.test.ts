import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockApiGet, mockApiPut, mockIsAuthenticated, mockOnAuthChange } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
  mockApiPut: vi.fn(),
  mockIsAuthenticated: vi.fn(() => false),
  mockOnAuthChange: vi.fn(),
}));

vi.mock('./services/api-client.js', () => ({
  apiGet: mockApiGet,
  apiPut: mockApiPut,
}));

vi.mock('./auth/auth-state.js', () => ({
  isAuthenticated: mockIsAuthenticated,
  onAuthChange: mockOnAuthChange,
}));

import { getUnits, setUnits, toggleUnits, initUnits, onUnitsChange } from './units.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Simple in-memory localStorage shim for Node. */
function createLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (_i: number) => null,
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal('localStorage', createLocalStorage());
  vi.stubGlobal('navigator', { language: 'en-US' });
});

// ── getUnits ─────────────────────────────────────────────────────────────────

describe('getUnits', () => {
  it('returns "km" when stored in localStorage', () => {
    localStorage.setItem('mapadillo-units', 'km');
    expect(getUnits()).toBe('km');
  });

  it('returns "mi" when stored in localStorage', () => {
    localStorage.setItem('mapadillo-units', 'mi');
    expect(getUnits()).toBe('mi');
  });

  it('ignores invalid stored values and falls back to locale', () => {
    localStorage.setItem('mapadillo-units', 'meters');
    vi.stubGlobal('navigator', { language: 'de-DE' });
    expect(getUnits()).toBe('km');
  });

  it('defaults to "mi" for US locale', () => {
    vi.stubGlobal('navigator', { language: 'en-US' });
    expect(getUnits()).toBe('mi');
  });

  it('defaults to "mi" for GB locale', () => {
    vi.stubGlobal('navigator', { language: 'en-GB' });
    expect(getUnits()).toBe('mi');
  });

  it('defaults to "km" for DE locale', () => {
    vi.stubGlobal('navigator', { language: 'de-DE' });
    expect(getUnits()).toBe('km');
  });

  it('defaults to "km" for JP locale', () => {
    vi.stubGlobal('navigator', { language: 'ja-JP' });
    expect(getUnits()).toBe('km');
  });

  it('defaults to "km" when region is undefined', () => {
    vi.stubGlobal('navigator', { language: 'en' });
    expect(getUnits()).toBe('km');
  });
});

// ── setUnits ─────────────────────────────────────────────────────────────────

describe('setUnits', () => {
  it('persists units to localStorage', () => {
    setUnits('mi');
    expect(localStorage.getItem('mapadillo-units')).toBe('mi');
  });

  it('notifies subscribers', () => {
    const handler = vi.fn(() => getUnits());
    const unsubscribe = onUnitsChange(handler);

    setUnits('km');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveReturnedWith('km');

    unsubscribe();
  });

  it('stops notifying after unsubscribe', () => {
    const handler = vi.fn();
    onUnitsChange(handler)();

    setUnits('mi');

    expect(handler).not.toHaveBeenCalled();
  });

  it('calls apiPut when authenticated', () => {
    mockIsAuthenticated.mockReturnValue(true);
    mockApiPut.mockResolvedValue(undefined);

    setUnits('mi');

    expect(mockApiPut).toHaveBeenCalledWith('/api/user/preferences', { units: 'mi' });
  });

  it('does not call apiPut when not authenticated', () => {
    mockIsAuthenticated.mockReturnValue(false);

    setUnits('km');

    expect(mockApiPut).not.toHaveBeenCalled();
  });

  it('swallows apiPut errors silently', () => {
    mockIsAuthenticated.mockReturnValue(true);
    const rejection = Promise.reject(new Error('network'));
    const catchSpy = vi.spyOn(rejection, 'catch');
    mockApiPut.mockReturnValue(rejection);

    expect(() => setUnits('mi')).not.toThrow();
    expect(catchSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps the value in memory when storage is blocked', async () => {
    // A failed write pins the preference to memory, so use a fresh module to keep it out of later tests.
    vi.resetModules();
    const fresh = await import('./units.js');
    Object.defineProperty(globalThis, 'localStorage', {
      get() { throw new Error('blocked'); },
      configurable: true,
    });

    expect(() => fresh.setUnits('mi')).not.toThrow();
    expect(fresh.getUnits()).toBe('mi');
  });
});

// ── toggleUnits ──────────────────────────────────────────────────────────────

describe('toggleUnits', () => {
  it('toggles from km to mi', () => {
    localStorage.setItem('mapadillo-units', 'km');
    toggleUnits();
    expect(localStorage.getItem('mapadillo-units')).toBe('mi');
  });

  it('toggles from mi to km', () => {
    localStorage.setItem('mapadillo-units', 'mi');
    toggleUnits();
    expect(localStorage.getItem('mapadillo-units')).toBe('km');
  });

  it('notifies subscribers on toggle', () => {
    localStorage.setItem('mapadillo-units', 'km');
    const handler = vi.fn(() => getUnits());
    const unsubscribe = onUnitsChange(handler);

    toggleUnits();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveReturnedWith('mi');

    unsubscribe();
  });
});

// ── initUnits ────────────────────────────────────────────────────────────────

describe('initUnits', () => {
  it('registers an onAuthChange callback', () => {
    initUnits();
    expect(mockOnAuthChange).toHaveBeenCalledTimes(1);
    expect(typeof mockOnAuthChange.mock.calls[0][0]).toBe('function');
  });

  it('syncs from server when auth changes to authenticated', async () => {
    mockIsAuthenticated.mockReturnValue(true);
    mockApiGet.mockResolvedValue({ units: 'mi' });

    initUnits();

    // Invoke the registered auth-change callback
    const callback = mockOnAuthChange.mock.calls[0][0];
    callback();

    await vi.waitFor(() => expect(localStorage.getItem('mapadillo-units')).toBe('mi'));
    expect(mockApiGet).toHaveBeenCalledWith('/api/user/preferences');
  });

  it('saves the local units to an account that has none', async () => {
    mockIsAuthenticated.mockReturnValue(true);
    mockApiGet.mockResolvedValue({ units: null });
    mockApiPut.mockResolvedValue(undefined);

    initUnits();

    const callback = mockOnAuthChange.mock.calls[0][0];
    callback();

    await vi.waitFor(() => {
      expect(mockApiPut).toHaveBeenCalledWith('/api/user/preferences', { units: 'mi' });
    });
    expect(localStorage.getItem('mapadillo-units')).toBeNull();
  });

  it('does not sync when auth changes but user is not authenticated', () => {
    mockIsAuthenticated.mockReturnValue(false);

    initUnits();

    const callback = mockOnAuthChange.mock.calls[0][0];
    callback();

    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it('keeps localStorage value when server sync fails', async () => {
    localStorage.setItem('mapadillo-units', 'km');
    mockIsAuthenticated.mockReturnValue(true);
    mockApiGet.mockRejectedValue(new Error('offline'));

    initUnits();

    const callback = mockOnAuthChange.mock.calls[0][0];
    callback();

    // Flush microtask queue
    await new Promise((r) => setTimeout(r, 0));

    expect(localStorage.getItem('mapadillo-units')).toBe('km');
  });

  it('ignores invalid units from server', async () => {
    localStorage.setItem('mapadillo-units', 'mi');
    mockIsAuthenticated.mockReturnValue(true);
    mockApiGet.mockResolvedValue({ units: 'meters' });

    initUnits();

    const callback = mockOnAuthChange.mock.calls[0][0];
    callback();

    await new Promise((r) => setTimeout(r, 0));

    // Should keep existing value
    expect(localStorage.getItem('mapadillo-units')).toBe('mi');
  });

  it('notifies subscribers without a PUT when syncing valid units from server', async () => {
    mockIsAuthenticated.mockReturnValue(true);
    mockApiGet.mockResolvedValue({ units: 'km' });
    const handler = vi.fn(() => getUnits());
    const unsubscribe = onUnitsChange(handler);

    initUnits();

    const callback = mockOnAuthChange.mock.calls[0][0];
    callback();

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });
    expect(handler).toHaveReturnedWith('km');
    expect(mockApiPut).not.toHaveBeenCalled();

    unsubscribe();
  });
});
