import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAddPasskey, mockSignInPasskey, mockRefreshAuth, mockSignOut } = vi.hoisted(() => ({
  mockAddPasskey: vi.fn(),
  mockSignInPasskey: vi.fn(),
  mockRefreshAuth: vi.fn(),
  mockSignOut: vi.fn(),
}));

vi.mock('./auth-client.js', () => ({
  authClient: {
    passkey: { addPasskey: mockAddPasskey },
    signIn: { passkey: mockSignInPasskey },
  },
}));

vi.mock('./auth-state.js', () => ({
  refreshAuth: mockRefreshAuth,
  signOut: mockSignOut,
}));

import { registerWithPasskey, signInWithPasskey } from './passkey.js';

const failure = (code: string, message: string) => ({ data: null, error: { code, message, status: 400 } });

describe('registerWithPasskey()', () => {
  beforeEach(() => {
    mockSignOut.mockResolvedValue(true);
  });

  it('sends the email and name as registration context and asks for a session', async () => {
    mockAddPasskey.mockResolvedValue({ data: {}, error: null });

    expect(await registerWithPasskey('ada@example.com', 'Ada')).toBeNull();

    expect(mockAddPasskey).toHaveBeenCalledWith({
      context: JSON.stringify({ email: 'ada@example.com', name: 'Ada' }),
      createSession: true,
    });
    expect(mockRefreshAuth).toHaveBeenCalledTimes(1);
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('signs out first, whatever the cached auth state says', async () => {
    const calls: string[] = [];
    mockSignOut.mockImplementation(async () => {
      calls.push('signOut');
      return true;
    });
    mockAddPasskey.mockImplementation(async () => {
      calls.push('addPasskey');
      return { data: {}, error: null };
    });

    await registerWithPasskey('ada@example.com', 'Ada');

    expect(calls).toEqual(['signOut', 'addPasskey']);
  });

  it('stops before the ceremony when the server does not confirm the sign-out', async () => {
    mockSignOut.mockResolvedValue(false);

    expect(await registerWithPasskey('ada@example.com', 'Ada')).toMatch(/could not start/);
    expect(mockAddPasskey).not.toHaveBeenCalled();
    expect(mockRefreshAuth).not.toHaveBeenCalled();
  });

  it('returns the server message, such as an email that is taken', async () => {
    const message = 'An account with this email already exists. Sign in the way you first signed up.';
    mockAddPasskey.mockResolvedValue(failure('USER_ALREADY_EXISTS', message));

    expect(await registerWithPasskey('ada@example.com', 'Ada')).toBe(message);
    expect(mockRefreshAuth).not.toHaveBeenCalled();
  });

  it('reports a dismissed prompt as a retryable cancel', async () => {
    mockAddPasskey.mockResolvedValue(failure('ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY', 'The operation either timed out or was not allowed.'));

    expect(await registerWithPasskey('ada@example.com', 'Ada')).toMatch(/cancelled.*try again/);
  });

  it('explains an authenticator that cannot store a discoverable passkey', async () => {
    mockAddPasskey.mockResolvedValue(failure('ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT', 'Discoverable credentials were required'));

    expect(await registerWithPasskey('ada@example.com', 'Ada')).toMatch(/cannot save a passkey/);
  });
});

describe('signInWithPasskey()', () => {
  it('refreshes auth state on success', async () => {
    mockSignInPasskey.mockResolvedValue({ data: {}, error: null });

    expect(await signInWithPasskey()).toBeNull();
    expect(mockRefreshAuth).toHaveBeenCalledTimes(1);
  });

  it('reports a dismissed prompt as cancelled', async () => {
    mockSignInPasskey.mockResolvedValue(failure('AUTH_CANCELLED', 'Auth cancelled'));

    expect(await signInWithPasskey()).toBe('Passkey sign-in was cancelled.');
    expect(mockRefreshAuth).not.toHaveBeenCalled();
  });
});
