/**
 * A validated string preference persisted in localStorage, or in memory when storage
 * is unavailable, with change subscribers. Backs the dark-mode and distance-units modules.
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

  // Blocked site data makes the localStorage getter throw and a full quota makes setItem throw.
  // After a failed write, storage may still hold an older value, so the in-memory value wins.
  let memory: string | null = null;
  let useMemory = false;
  const read = (): string | null => {
    if (useMemory) return memory;
    try {
      return localStorage.getItem(key);
    } catch {
      return memory;
    }
  };

  const stored = (): T | null => {
    const raw = read();
    return raw !== null && accepted.includes(raw) ? (raw as T) : null;
  };
  const notify = (): void => {
    listeners.forEach((fn) => fn());
  };

  return {
    stored,
    get: () => stored() ?? fallback(),
    set: (value) => {
      memory = value;
      try {
        localStorage.setItem(key, value);
        useMemory = false;
      } catch {
        useMemory = true;
      }
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
