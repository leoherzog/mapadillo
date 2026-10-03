/**
 * Sign-in page — OAuth (Google, Facebook) + Passkey (WebAuthn).
 *
 * Two modes:
 * - "sign-in": returning users sign in via OAuth or existing passkey.
 * - "register": new users enter email + name; one passkey ceremony creates the
 *   account and its passkey (or they sign up via OAuth).
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { authClient } from '../auth/auth-client.js';
import { registerWithPasskey, signInWithPasskey } from '../auth/passkey.js';
import { navigateTo, signInUrl } from '../nav.js';
import { errorCallout } from '../components/ui.js';
import { waUtilities } from '../styles/wa-utilities.js';
import { headingStyles } from '../styles/heading-shared.js';
import { fieldValue } from '../utils/form.js';

/** Messages for the `error` codes Better Auth appends when an OAuth sign-in fails. */
const OAUTH_ERRORS: Record<string, string> = {
  access_denied: 'Sign-in was cancelled.',
  account_not_linked: 'This email already signs in with a different method. Sign in the way you first signed up.',
  email_not_found: 'That account did not share an email address. Try another sign-in method.',
};

@customElement('sign-in-page')
export class SignInPage extends LitElement {
  @state() private _mode: 'sign-in' | 'register' = 'sign-in';
  @state() private _email = '';
  @state() private _name = '';
  @state() private _error = '';
  /** The auth action in flight; every action button is disabled while one runs. */
  @state() private _pending: 'google' | 'facebook' | 'passkey' | 'register' | null = null;

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

  connectedCallback(): void {
    super.connectedCallback();
    const code = new URLSearchParams(location.search).get('error');
    if (code) this._error = OAUTH_ERRORS[code] ?? 'Sign-in failed. Please try again.';
  }

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

        <div>
          ${this._error ? errorCallout(this._error) : nothing}
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
        ?disabled=${this._pending !== null}
        ?loading=${this._pending === 'passkey'}
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
          maxlength="100"
          required
          .value=${this._name}
          @input=${(e: Event) => { this._name = fieldValue(e); }}
        ></wa-input>
        <wa-input
          label="Email"
          type="email"
          placeholder="you@example.com"
          autocomplete="email"
          maxlength="254"
          required
          .value=${this._email}
          @input=${(e: Event) => { this._email = fieldValue(e); }}
        ></wa-input>
        <wa-button
          variant="brand"
          type="submit"
          ?disabled=${this._pending !== null}
          ?loading=${this._pending === 'register'}
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
          ?disabled=${this._pending !== null}
          ?loading=${this._pending === 'google'}
        >
          <wa-icon slot="start" name="google" family="brands"></wa-icon>
          ${prefix} Google
        </wa-button>
        <wa-button
          variant="neutral"
          appearance="outlined"
          @click=${() => this._signInSocial('facebook')}
          ?disabled=${this._pending !== null}
          ?loading=${this._pending === 'facebook'}
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
    const raw = new URLSearchParams(window.location.search).get('returnTo');
    // Validate same-origin to prevent open redirect via crafted returnTo param
    const url = raw ? URL.parse(raw, window.location.origin) : null;
    return url?.origin === window.location.origin ? url.pathname + url.search : '/dashboard';
  }

  private async _signInSocial(provider: 'google' | 'facebook') {
    this._pending = provider;
    this._error = '';
    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: this._returnTo,
        errorCallbackURL: signInUrl(this._returnTo),
      });
      if (result?.error) {
        this._error = result.error.message ?? `Failed to sign in with ${provider}`;
        this._pending = null;
      }
    } catch (e: unknown) {
      this._error = e instanceof Error ? e.message : `Failed to sign in with ${provider}`;
      this._pending = null;
    }
  }

  private async _signInPasskey() {
    this._pending = 'passkey';
    this._error = '';
    try {
      const error = await signInWithPasskey();
      this._pending = null;
      if (error) {
        this._error = error;
        return;
      }
      navigateTo(this._returnTo, { replace: true });
    } catch (e: unknown) {
      this._error = e instanceof Error ? e.message : 'Passkey sign-in failed.';
      this._pending = null;
    }
  }

  private _onRegisterSubmit(e: SubmitEvent) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    if (!form.reportValidity()) return;
    this._registerPasskey();
  }

  private async _registerPasskey() {
    this._pending = 'register';
    this._error = '';
    try {
      const error = await registerWithPasskey(this._email, this._name);
      this._pending = null;
      if (error) {
        this._error = error;
        return;
      }
      navigateTo(this._returnTo, { replace: true });
    } catch (e: unknown) {
      this._error = e instanceof Error ? e.message : 'Passkey registration failed. Please try again.';
      this._pending = null;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sign-in-page': SignInPage;
  }
}
