/**
 * Lit reactive controller that re-renders its host whenever a module-level store
 * changes. Subscribes while the host is connected.
 */
import type { ReactiveController, ReactiveControllerHost } from 'lit';

export class StoreController<T> implements ReactiveController {
  private readonly _host: ReactiveControllerHost;
  private readonly _get: () => T;
  private readonly _subscribe: (fn: () => void) => () => void;
  private _unsubscribe?: () => void;

  /**
   * @param host the element to re-render
   * @param get reads the store's current value
   * @param subscribe registers a change listener and returns its unsubscribe function
   */
  constructor(
    host: ReactiveControllerHost,
    get: () => T,
    subscribe: (fn: () => void) => () => void,
  ) {
    this._host = host;
    this._get = get;
    this._subscribe = subscribe;
    host.addController(this);
  }

  /** The store's current value. */
  get value(): T {
    return this._get();
  }

  hostConnected(): void {
    this._unsubscribe = this._subscribe(() => this._host.requestUpdate());
  }

  hostDisconnected(): void {
    this._unsubscribe?.();
    this._unsubscribe = undefined;
  }
}
