/**
 * Better Auth client — browser-side auth helpers.
 *
 * Talks to the Worker's /api/auth/* endpoints for sign-in, sign-up,
 * session management, and passkey (WebAuthn) flows.
 */

import { createAuthClient } from 'better-auth/client';
// @better-auth/passkey is listed as a dependency in package.json
import { passkeyClient } from '@better-auth/passkey/client';

export const authClient = createAuthClient({
  baseURL: window.location.origin,
  plugins: [passkeyClient()],
});
