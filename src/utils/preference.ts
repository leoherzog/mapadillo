/**
 * A validated string preference persisted in localStorage, with change subscribers.
 * Backs the dark-mode and distance-units modules.
 */

export interface Preference<T extends string> {
  /** The stored value, or null when nothing valid is stored. */
  stored(): T | null;
  /** The stored value, or the fallback when nothing valid is stored. */
  get(): T;
  /** Persist `value` and notify subscribers. */
  set(value: T): void;
  /**
   * Call `fn` after every change.
   * @returns an unsubscribe function
   */
  subscribe(fn: () => void): () => void;
  /** Notify subscribers without writing, for when the fallback itself changed. */
  notify(): void;
}

/**
 * @param key localStorage key
 * @param values the accepted stored values; anything else reads as unset
 * @param fallback value used while nothing valid is stored
 */
export function createPreference<T extends string>(
  key: string,
  values: readonly T[],
  fallback: () => T,
): Preference<T> {
  const listeners = new Set<() => void>();
  const accepted: readonly string[] = values;

  const stored = (): T | null => {
    const raw = localStorage.getItem(key);
    return raw !== null && accepted.includes(raw) ? (raw as T) : null;
  };
  const notify = (): void => {
    listeners.forEach((fn) => fn());
  };

  return {
    stored,
    get: () => stored() ?? fallback(),
    set: (value) => {
      localStorage.setItem(key, value);
      notify();
    },
    subscribe: (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    notify,
  };
}
