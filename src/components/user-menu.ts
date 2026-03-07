/**
 * User menu — avatar + dropdown with sign-out.
 *
 * Shown in the header when the user is authenticated.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { signOut, type User } from '../auth/auth-state.js';
import { navigateTo } from '../nav.js';
import { isDark, toggleDarkMode } from '../dark-mode.js';

@customElement('user-menu')
export class UserMenu extends LitElement {
  @property({ type: Object }) user: User | null = null;

  @state() private _signingOut = false;
  @state() private _dark = isDark();

  private _onDarkModeChange = () => { this._dark = isDark(); };

  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
    }

    wa-avatar {
      --size: 2rem;
    }

    .trigger-label {
      margin-left: var(--wa-space-xs);
      font-size: var(--wa-font-size-s);
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    wa-spinner {
      font-size: 1em;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('dark-mode-change', this._onDarkModeChange);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('dark-mode-change', this._onDarkModeChange);
  }

  render() {
    if (!this.user) return nothing;

    return html`
      <wa-dropdown placement="bottom-end">
        <wa-button slot="trigger" variant="neutral" appearance="plain" size="small" with-caret>
          <wa-avatar
            image=${ifDefined(this.user.image ?? undefined)}
            initials=${this._initials}
            label=${this.user.name ?? 'User avatar'}
          ></wa-avatar>
          <span class="trigger-label">${this.user.name}</span>
        </wa-button>

        <wa-dropdown-item @click=${this._handleToggleDark}>
          <wa-icon slot="icon" name=${this._dark ? 'sun' : 'moon'}></wa-icon>
          ${this._dark ? 'Light Mode' : 'Dark Mode'}
        </wa-dropdown-item>

        <wa-divider></wa-divider>

        <wa-dropdown-item
          @click=${this._handleSignOut}
          ?disabled=${this._signingOut}
        >
          ${this._signingOut
            ? html`<wa-spinner slot="icon"></wa-spinner>`
            : html`<wa-icon slot="icon" name="arrow-right-from-bracket"></wa-icon>`}
          ${this._signingOut ? 'Signing Out\u2026' : 'Sign Out'}
        </wa-dropdown-item>
      </wa-dropdown>
    `;
  }

  private get _initials(): string {
    return (
      this.user?.name
        ?.split(' ')
        .filter((n) => n.length > 0)
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2) ?? ''
    );
  }

  private _handleToggleDark = () => {
    toggleDarkMode();
  };

  private _handleSignOut = async () => {
    if (this._signingOut) return;
    this._signingOut = true;

    try {
      await signOut();
      navigateTo('/');
    } catch (err) {
      console.error('Sign-out failed:', err);
    } finally {
      this._signingOut = false;
    }
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'user-menu': UserMenu;
  }
}
