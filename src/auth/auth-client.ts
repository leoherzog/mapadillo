/**
 * Better Auth client — browser-side auth helpers.
 *
 * Talks to the Worker's /api/auth/* endpoints for sign-in, sign-up,
 * session management, and passkey (WebAuthn) flows.
 */

import { createAuthClient } from 'better-auth/client';
import { passkeyClient } from '@better-auth/passkey/client';

export const authClient = createAuthClient({
  baseURL: window.location.origin,
  plugins: [passkeyClient()],
});
