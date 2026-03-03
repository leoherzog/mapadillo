/**
 * User menu — avatar + dropdown with sign-out.
 *
 * Shown in the header when the user is authenticated.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { signOut, type User } from '../auth/auth-state.js';
import { navigateTo } from '../nav.js';

@customElement('user-menu')
export class UserMenu extends LitElement {
  @property({ type: Object }) user: User | null = null;

  @state() private _signingOut = false;

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
      font-size: 0.9rem;
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `;

  render() {
    if (!this.user) return nothing;

    return html`
      <wa-dropdown>
        <wa-button slot="trigger" variant="neutral" appearance="plain" size="small">
          <wa-avatar
            image=${this.user.image ?? ''}
            initials=${this._initials}
            label=${this.user.name ?? 'User avatar'}
          ></wa-avatar>
          <span class="trigger-label">${this.user.name}</span>
        </wa-button>

        <wa-dropdown-item @click=${this._goToDashboard}>
          <wa-icon slot="icon" name="grid-2" family="jelly"></wa-icon>
          My Trips
        </wa-dropdown-item>
        <wa-divider></wa-divider>
        <wa-dropdown-item
          @click=${this._handleSignOut}
          ?disabled=${this._signingOut}
        >
          <wa-icon slot="icon" name=${this._signingOut ? 'spinner' : 'arrow-right-from-bracket'} family="jelly"></wa-icon>
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

  private _goToDashboard() {
    navigateTo('/dashboard');
  }

  private _handleSignOut = async () => {
    if (this._signingOut) return;
    this._signingOut = true;

    try {
      await signOut();
    } catch (err) {
      console.error('Sign-out failed:', err);
    } finally {
      this._signingOut = false;
      navigateTo('/');
    }
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'user-menu': UserMenu;
  }
}
