/**
 * User menu — avatar dropdown with My Trips, dark-mode and units toggles, and sign-out.
 *
 * Shown in the header when the user is authenticated.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { signOut, type User } from '../auth/auth-state.js';
import { navigateTo } from '../nav.js';
import { isDark, onDarkModeChange, toggleDarkMode } from '../dark-mode.js';
import { getUnits, onUnitsChange, toggleUnits } from '../units.js';
import { StoreController } from '../utils/store-controller.js';
import { waUtilities } from '../styles/wa-utilities.js';

@customElement('user-menu')
export class UserMenu extends LitElement {
  @property({ type: Object }) user: User | null = null;

  private _dark = new StoreController(this, isDark, onDarkModeChange);
  private _units = new StoreController(this, getUnits, onUnitsChange);

  static styles = [waUtilities, css`
    :host {
      display: inline-flex;
      align-items: center;
    }

    wa-avatar {
      --size: var(--wa-space-2xl);
    }

    .trigger-label {
      display: inline-block;
      vertical-align: middle;
      margin-left: var(--wa-space-xs);
      font-size: var(--wa-font-size-s);
      max-width: 120px;
    }
  `];

  render() {
    if (!this.user) return nothing;

    return html`
      <wa-dropdown placement="bottom-end" @wa-select=${this._onSelect}>
        <wa-button slot="trigger" variant="neutral" appearance="plain" size="s" with-caret>
          <wa-avatar
            image=${ifDefined(this.user.image ?? undefined)}
            initials=${this._initials}
            label=${this.user.name}
          ></wa-avatar>
          <span class="trigger-label wa-text-truncate">${this.user.name}</span>
        </wa-button>

        <wa-dropdown-item href="/dashboard">
          <wa-icon slot="icon" name="map"></wa-icon>
          My Trips
        </wa-dropdown-item>

        <wa-dropdown-item value="dark">
          <wa-icon slot="icon" name=${this._dark.value ? 'sun' : 'moon'}></wa-icon>
          ${this._dark.value ? 'Light Mode' : 'Dark Mode'}
        </wa-dropdown-item>

        <wa-dropdown-item value="units">
          <wa-icon slot="icon" name="globe"></wa-icon>
          ${this._units.value === 'km' ? 'Switch to Miles' : 'Switch to Kilometers'}
        </wa-dropdown-item>

        <wa-divider></wa-divider>

        <wa-dropdown-item value="sign-out">
          <wa-icon slot="icon" name="arrow-right-from-bracket"></wa-icon>
          Sign Out
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

  private _onSelect(e: CustomEvent<{ item: { value: string } }>) {
    const { value } = e.detail.item;
    if (value === 'dark') toggleDarkMode();
    else if (value === 'units') toggleUnits();
    else if (value === 'sign-out') void signOut().then(() => navigateTo('/'));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'user-menu': UserMenu;
  }
}
