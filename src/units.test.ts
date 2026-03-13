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

import { getUnits, setUnits, toggleUnits, initUnits } from './units.js';

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

/** Stub Intl.Locale to return a given region. */
function stubLocale(region: string | undefined) {
  vi.spyOn(globalThis, 'Intl', 'get').mockReturnValue({
    ...Intl,
    Locale: class {
      region = region;
      constructor() {}
    },
  } as unknown as typeof Intl);
}

/** Minimal EventTarget-based document stub for Node. */
function createDocumentStub() {
  const target = new EventTarget();
  return {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  };
}

// Provide CustomEvent in Node (not available natively before Node 19+)
if (typeof globalThis.CustomEvent === 'undefined') {
  (globalThis as any).CustomEvent = class CustomEvent extends Event {
    detail: any;
    constructor(type: string, init?: { detail?: any }) {
      super(type);
      this.detail = init?.detail;
    }
  };
}

beforeEach(() => {
  // Provide localStorage, document, and navigator.language for Node environment
  (globalThis as any).localStorage = createLocalStorage();
  (globalThis as any).document = createDocumentStub();
  Object.defineProperty(globalThis, 'navigator', {
    value: { language: 'en-US' },
    writable: true,
    configurable: true,
  });

  mockApiGet.mockReset();
  mockApiPut.mockReset();
  mockIsAuthenticated.mockReturnValue(false);
  mockOnAuthChange.mockReset();
  vi.restoreAllMocks();
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
    stubLocale('DE');
    expect(getUnits()).toBe('km');
  });

  it('defaults to "mi" for US locale', () => {
    stubLocale('US');
    expect(getUnits()).toBe('mi');
  });

  it('defaults to "mi" for GB locale', () => {
    stubLocale('GB');
    expect(getUnits()).toBe('mi');
  });

  it('defaults to "km" for DE locale', () => {
    stubLocale('DE');
    expect(getUnits()).toBe('km');
  });

  it('defaults to "km" for JP locale', () => {
    stubLocale('JP');
    expect(getUnits()).toBe('km');
  });

  it('defaults to "km" when region is undefined', () => {
    stubLocale(undefined);
    expect(getUnits()).toBe('km');
  });
});

// ── setUnits ─────────────────────────────────────────────────────────────────

describe('setUnits', () => {
  it('persists units to localStorage', () => {
    setUnits('mi');
    expect(localStorage.getItem('mapadillo-units')).toBe('mi');
  });

  it('dispatches "units-change" event with detail', () => {
    const handler = vi.fn();
    document.addEventListener('units-change', handler);

    setUnits('km');

    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0][0] as CustomEvent).detail).toEqual({ units: 'km' });

    document.removeEventListener('units-change', handler);
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

  it('swallows apiPut errors silently', async () => {
    mockIsAuthenticated.mockReturnValue(true);
    mockApiPut.mockRejectedValue(new Error('network'));

    // Should not throw
    setUnits('mi');

    // Let the microtask queue flush so the .catch() runs
    await vi.waitFor(() => expect(mockApiPut).toHaveBeenCalled());
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

  it('dispatches event on toggle', () => {
    localStorage.setItem('mapadillo-units', 'km');
    const handler = vi.fn();
    document.addEventListener('units-change', handler);

    toggleUnits();

    expect(handler).toHaveBeenCalledTimes(1);
    expect((handler.mock.calls[0][0] as CustomEvent).detail).toEqual({ units: 'mi' });

    document.removeEventListener('units-change', handler);
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
    await callback();

    // Wait for the async _syncFromServer to complete
    await vi.waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith('/api/user/preferences');
    });
    expect(localStorage.getItem('mapadillo-units')).toBe('mi');
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
    await callback();

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
    await callback();

    await new Promise((r) => setTimeout(r, 0));

    // Should keep existing value
    expect(localStorage.getItem('mapadillo-units')).toBe('mi');
  });

  it('dispatches event when syncing valid units from server', async () => {
    mockIsAuthenticated.mockReturnValue(true);
    mockApiGet.mockResolvedValue({ units: 'km' });
    const handler = vi.fn();
    document.addEventListener('units-change', handler);

    initUnits();

    const callback = mockOnAuthChange.mock.calls[0][0];
    await callback();

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledTimes(1);
    });
    expect((handler.mock.calls[0][0] as CustomEvent).detail).toEqual({ units: 'km' });

    document.removeEventListener('units-change', handler);
  });
});
