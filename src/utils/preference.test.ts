import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPreference } from './preference.js';

/** In-memory localStorage shim whose writes throw while `full` is set. */
function createLocalStorage() {
  const store = new Map<string, string>();
  const storage = {
    full: false,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (storage.full) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      store.set(key, value);
    },
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (_i: number) => null,
  };
  return storage;
}

let storage: ReturnType<typeof createLocalStorage>;

beforeEach(() => {
  storage = createLocalStorage();
  vi.stubGlobal('localStorage', storage);
});

const create = () => createPreference<'a' | 'b'>('pref', ['a', 'b'], () => 'a');

describe('createPreference', () => {
  it('reads a valid stored value', () => {
    storage.setItem('pref', 'b');
    expect(create().get()).toBe('b');
  });

  it('treats an unknown stored value as unset', () => {
    storage.setItem('pref', 'c');
    const pref = create();
    expect(pref.stored()).toBeNull();
    expect(pref.get()).toBe('a');
  });

  it('serves the new value when the write fails but storage still reads', () => {
    storage.setItem('pref', 'a');
    storage.full = true;
    const pref = create();
    const listener = vi.fn();
    pref.subscribe(listener);

    pref.set('b');

    expect(pref.get()).toBe('b');
    expect(storage.getItem('pref')).toBe('a');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('reads storage again after a later write succeeds', () => {
    storage.full = true;
    const pref = create();
    pref.set('b');

    storage.full = false;
    pref.set('a');
    storage.setItem('pref', 'b');

    expect(pref.get()).toBe('b');
  });
});
