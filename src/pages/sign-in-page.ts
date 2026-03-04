/**
 * Sign-in page — OAuth (Google, Facebook) + Passkey (WebAuthn).
 *
 * Two modes:
 * - "sign-in": returning users sign in via OAuth or existing passkey.
 * - "register": new users enter email + name, then register a passkey
 *   (or sign up via OAuth).
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { authClient } from '../auth/auth-client.js';
import { refreshAuth } from '../auth/auth-state.js';
import { navigateTo } from '../nav.js';
import { waUtilities } from '../styles/wa-utilities.js';

@customElement('sign-in-page')
export class SignInPage extends LitElement {
  @state() private _mode: 'sign-in' | 'register' = 'sign-in';
  @state() private _email = '';
  @state() private _name = '';
  @state() private _error = '';
  @state() private _loading = false;

  static styles = [waUtilities, css`
    :host {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 1;
      padding: var(--wa-space-xl) var(--wa-space-m);
    }

    wa-card {
      width: 100%;
      max-width: 420px;
      --spacing: var(--wa-space-xl);
    }

    wa-card::part(body) {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--wa-space-l);
      text-align: center;
    }

    h1 {
      font-size: 1.75rem;
      font-weight: 900;
      margin: 0;
      color: var(--wa-color-brand-60, #e05e00);
    }

    p {
      color: var(--wa-color-neutral-600);
      margin: 0;
    }

    .auth-buttons wa-button,
    .register-form wa-button {
      width: 100%;
    }

    .hero-icon {
      font-size: 3rem;
      color: var(--wa-color-brand-50, #ff6b00);
    }

    .mode-toggle {
      font-size: var(--wa-font-size-s);
    }
  `];

  render() {
    return html`
      <wa-card>
        <wa-icon
          name="map"
                   label=""
          class="hero-icon"
        ></wa-icon>

        <h1>${this._mode === 'sign-in' ? 'Welcome Back!' : 'Create Account'}</h1>
        <p>Sign in to plan and share your family adventures.</p>

        <div aria-live="assertive" aria-atomic="true">
          ${this._error
            ? html`
                <wa-callout variant="danger" style="width: 100%;">
                  <wa-icon slot="icon" name="circle-exclamation" family="jelly"></wa-icon>
                  ${this._error}
                </wa-callout>
              `
            : nothing}
        </div>

        ${this._mode === 'sign-in' ? this._renderSignIn() : this._renderRegister()}
      </wa-card>
    `;
  }

  // ── Sign-in mode ──────────────────────────────────────────────────────

  private _renderSignIn() {
    return html`
      <div class="auth-buttons wa-stack wa-gap-s" style="width: 100%">
        <wa-button
          variant="neutral"
          appearance="outlined"
          @click=${() => this._signInSocial('google')}
          ?disabled=${this._loading}
          ?loading=${this._loading}
        >
          <wa-icon slot="start" name="google" family="brands"></wa-icon>
          Continue with Google
        </wa-button>
        <wa-button
          variant="neutral"
          appearance="outlined"
          @click=${() => this._signInSocial('facebook')}
          ?disabled=${this._loading}
          ?loading=${this._loading}
        >
          <wa-icon slot="start" name="facebook" family="brands"></wa-icon>
          Continue with Facebook
        </wa-button>
        <wa-button
          variant="brand"
          appearance="outlined"
          @click=${this._signInPasskey}
          ?disabled=${this._loading}
          ?loading=${this._loading}
        >
          <wa-icon slot="start" name="fingerprint" family="duotone"></wa-icon>
          Sign in with Passkey
        </wa-button>
      </div>

      <div class="wa-cluster wa-align-items-center wa-gap-s" style="width: 100%"><wa-divider style="flex:1"></wa-divider><span>or</span><wa-divider style="flex:1"></wa-divider></div>

      <wa-button
        class="mode-toggle"
        appearance="plain"
        variant="neutral"
        @click=${() => { this._mode = 'register'; this._error = ''; }}
      >
        New here? Create an account
      </wa-button>
    `;
  }

  // ── Register mode ─────────────────────────────────────────────────────

  private _renderRegister() {
    return html`
      <div class="register-form wa-stack wa-gap-m" style="width: 100%">
        <wa-input
          label="Name"
          placeholder="Your name"
          autocomplete="name"
          required
          .value=${this._name}
          @input=${(e: Event) => { this._name = (e.target as HTMLInputElement).value; }}
        ></wa-input>
        <wa-input
          label="Email"
          type="email"
          placeholder="you@example.com"
          autocomplete="email"
          required
          .value=${this._email}
          @input=${(e: Event) => { this._email = (e.target as HTMLInputElement).value; }}
        ></wa-input>
        <wa-button
          variant="brand"
          @click=${this._registerPasskey}
          ?disabled=${this._loading}
          ?loading=${this._loading}
        >
          <wa-icon slot="start" name="fingerprint" family="duotone"></wa-icon>
          Register with Passkey
        </wa-button>
      </div>

      <div class="wa-cluster wa-align-items-center wa-gap-s" style="width: 100%"><wa-divider style="flex:1"></wa-divider><span>or</span><wa-divider style="flex:1"></wa-divider></div>

      <div class="auth-buttons wa-stack wa-gap-s" style="width: 100%">
        <wa-button
          variant="neutral"
          appearance="outlined"
          @click=${() => this._signInSocial('google')}
          ?disabled=${this._loading}
          ?loading=${this._loading}
        >
          <wa-icon slot="start" name="google" family="brands"></wa-icon>
          Sign up with Google
        </wa-button>
        <wa-button
          variant="neutral"
          appearance="outlined"
          @click=${() => this._signInSocial('facebook')}
          ?disabled=${this._loading}
          ?loading=${this._loading}
        >
          <wa-icon slot="start" name="facebook" family="brands"></wa-icon>
          Sign up with Facebook
        </wa-button>
      </div>

      <wa-button
        class="mode-toggle"
        appearance="plain"
        variant="neutral"
        @click=${() => { this._mode = 'sign-in'; this._error = ''; }}
      >
        Already have an account? Sign in
      </wa-button>
    `;
  }

  // ── Auth actions ──────────────────────────────────────────────────────

  private get _returnTo(): string {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('returnTo') ?? '';
    // Validate same-origin to prevent open redirect via crafted returnTo param
    try {
      const url = new URL(raw, window.location.origin);
      if (url.origin === window.location.origin) {
        return url.pathname + url.search;
      }
    } catch {
      // Not a valid URL — fall through to default
    }
    return '/dashboard';
  }

  private async _signInSocial(provider: 'google' | 'facebook') {
    this._loading = true;
    this._error = '';
    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: this._returnTo,
      });
      if (result?.error) {
        this._error = result.error.message ?? `Failed to sign in with ${provider}`;
        this._loading = false;
      }
    } catch (e: unknown) {
      this._error = e instanceof Error ? e.message : `Failed to sign in with ${provider}`;
      this._loading = false;
    }
  }

  private async _signInPasskey() {
    this._loading = true;
    this._error = '';
    try {
      const result = await authClient.signIn.passkey();
      if (result?.error) {
        this._error = result.error.message ?? 'Passkey sign-in failed';
        this._loading = false;
        return;
      }
      await refreshAuth();
      this._loading = false;
      navigateTo(this._returnTo);
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'NotAllowedError') {
        this._error = 'Passkey sign-in was cancelled.';
      } else {
        this._error = e instanceof Error ? e.message : 'Passkey sign-in failed';
      }
      this._loading = false;
    }
  }

  private async _registerPasskey() {
    if (!this._email) {
      this._error = 'Please enter your email address';
      return;
    }
    if (!this._name) {
      this._error = 'Please enter your name';
      return;
    }

    this._loading = true;
    this._error = '';
    try {
      // 1. Create the account with email + throwaway password.
      //
      // Better Auth requires an email+password account to exist before a
      // passkey can be added to it. The random UUID password is effectively
      // unguessable and unknown to the user — they will only ever
      // authenticate via their passkey.
      //
      // Risk: if a "forgot password" flow is ever added, users could reset
      // to a known password, giving them a second credential path that
      // bypasses passkey-only intent.
      //
      // Mitigation: the server has emailAndPassword enabled (required by
      // Better Auth for account creation) but no password-reset flow is
      // exposed in the UI or API routes.
      const signUpResult = await authClient.signUp.email({
        email: this._email,
        name: this._name,
        password: crypto.randomUUID(),
      });
      if (signUpResult?.error) {
        this._error = signUpResult.error.message ?? 'Registration failed';
        this._loading = false;
        return;
      }

      // 2. Register a passkey for the new account.
      // If addPasskey() fails (user cancels biometric prompt, authenticator
      // unavailable), the account exists with only a random UUID password
      // the user doesn't know. We must catch this and show an error.
      const passkeyResult = await authClient.passkey.addPasskey();
      if (passkeyResult?.error) {
        this._error = passkeyResult.error.message ?? 'Passkey registration failed. Please try again.';
        this._loading = false;
        return;
      }

      // 3. Refresh session and navigate
      await refreshAuth();
      this._loading = false;
      navigateTo(this._returnTo);
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'NotAllowedError') {
        this._error = 'Passkey registration was cancelled. Please try again.';
      } else {
        this._error = e instanceof Error ? e.message : 'Passkey registration failed';
      }
      this._loading = false;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sign-in-page': SignInPage;
  }
}
