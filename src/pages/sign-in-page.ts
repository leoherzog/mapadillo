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
import { headingStyles } from '../styles/heading-shared.js';

@customElement('sign-in-page')
export class SignInPage extends LitElement {
  @state() private _mode: 'sign-in' | 'register' = 'sign-in';
  @state() private _email = '';
  @state() private _name = '';
  @state() private _error = '';
  @state() private _loading = false;

  static styles = [waUtilities, headingStyles, css`
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
      font-size: var(--wa-font-size-xl);
    }

    p {
      color: var(--wa-color-text-quiet);
      margin: 0;
    }

    .auth-buttons wa-button,
    .register-form wa-button {
      width: 100%;
    }

    .hero-icon {
      font-size: var(--wa-font-size-3xl);
      color: var(--wa-color-brand-50);
    }

    .mode-toggle {
      font-size: var(--wa-font-size-s);
    }

    .full-width {
      width: 100%;
    }

    wa-callout {
      width: 100%;
    }

    .divider-row wa-divider {
      flex: 1;
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
                <wa-callout variant="danger">
                  <wa-icon slot="icon" name="circle-exclamation"></wa-icon>
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
      ${this._renderSocialButtons('Continue with')}
      <wa-button
        class="full-width"
        variant="brand"
        appearance="outlined"
        @click=${this._signInPasskey}
        ?disabled=${this._loading}
        ?loading=${this._loading}
      >
        <wa-icon slot="start" name="fingerprint" family="duotone"></wa-icon>
        Sign in with Passkey
      </wa-button>

      ${this._renderDivider()}

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
      <form class="register-form wa-stack wa-gap-m full-width" @submit=${this._onRegisterSubmit}>
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
          type="submit"
          ?disabled=${this._loading}
          ?loading=${this._loading}
        >
          <wa-icon slot="start" name="fingerprint" family="duotone"></wa-icon>
          Register with Passkey
        </wa-button>
      </form>

      ${this._renderDivider()}

      ${this._renderSocialButtons('Sign up with')}

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

  private _renderSocialButtons(prefix: string) {
    return html`
      <div class="auth-buttons wa-stack wa-gap-s full-width">
        <wa-button
          variant="neutral"
          appearance="outlined"
          @click=${() => this._signInSocial('google')}
          ?disabled=${this._loading}
          ?loading=${this._loading}
        >
          <wa-icon slot="start" name="google" family="brands"></wa-icon>
          ${prefix} Google
        </wa-button>
        <wa-button
          variant="neutral"
          appearance="outlined"
          @click=${() => this._signInSocial('facebook')}
          ?disabled=${this._loading}
          ?loading=${this._loading}
        >
          <wa-icon slot="start" name="facebook" family="brands"></wa-icon>
          ${prefix} Facebook
        </wa-button>
      </div>
    `;
  }

  private _renderDivider() {
    return html`
      <div class="divider-row wa-cluster wa-align-items-center wa-gap-s full-width"><wa-divider></wa-divider><span>or</span><wa-divider></wa-divider></div>
    `;
  }

  // ── Auth actions ──────────────────────────────────────────────────────

  private get _returnTo(): string {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('returnTo');
    
    if (raw) {
      // Validate same-origin to prevent open redirect via crafted returnTo param
      try {
        const url = new URL(raw, window.location.origin);
        if (url.origin === window.location.origin) {
          return url.pathname + url.search;
        }
      } catch {
        // Not a valid URL — fall through to default
      }
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
        this._error = String(result.error.message ?? 'Passkey sign-in failed');
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

  private _onRegisterSubmit(e: SubmitEvent) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    if (!form.reportValidity()) return;
    this._registerPasskey();
  }

  private async _registerPasskey() {
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
      // the user doesn't know. Sign out to clear the half-authenticated state.
      // TODO: Add server-side cleanup job to garbage-collect accounts with no
      // passkeys and no OAuth links.
      let passkeyResult;
      try {
        passkeyResult = await authClient.passkey.addPasskey();
      } catch (passkeyErr) {
        try { await authClient.signOut(); } catch { /* best-effort */ }
        throw passkeyErr;
      }
      if (passkeyResult?.error) {
        try { await authClient.signOut(); } catch { /* best-effort */ }
        this._error = String(passkeyResult.error.message ?? 'Passkey registration failed. Please try again.');
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
