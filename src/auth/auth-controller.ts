/**
 * Lit reactive controller that re-renders its host on sign-in and sign-out.
 */
import type { ReactiveControllerHost } from 'lit';
import { StoreController } from '../utils/store-controller.js';
import { getUser, onAuthChange, type User } from './auth-state.js';

export class AuthController extends StoreController<User | null> {
  constructor(host: ReactiveControllerHost) {
    super(host, getUser, onAuthChange);
  }

  /** The signed-in user, or null. */
  get user(): User | null {
    return this.value;
  }
}
