/**
 * Claim page — claims a share invite token and redirects to the map.
 *
 * Route: /claim/:token
 * On mount, calls the claim API. On success, navigates to the map.
 * On error, shows an appropriate message.
 */
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { claimShareToken } from '../services/maps.js';
import { ApiError } from '../services/api-client.js';
import { navigateTo } from '../nav.js';
import { waUtilities } from '../styles/wa-utilities.js';

@customElement('claim-page')
export class ClaimPage extends LitElement {
  @property() token = '';

  @state() private _error = '';
  @state() private _loading = true;

  static styles = [waUtilities, css`
    :host {
      display: block;
      max-width: 500px;
      margin: var(--wa-space-3xl) auto;
      padding: 0 var(--wa-space-m);
      text-align: center;
    }

    .spinner {
      font-size: var(--wa-font-size-2xl);
    }

    .mt-l {
      margin-top: var(--wa-space-l);
    }
  `];

  connectedCallback(): void {
    super.connectedCallback();
    this._claim();
  }

  private async _claim() {
    if (!this.token) {
      this._error = 'No invite token provided.';
      this._loading = false;
      return;
    }

    try {
      const result = await claimShareToken(this.token);
      navigateTo(`/map/${result.map_id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403) {
          this._error = 'This invite has already been claimed by someone else.';
        } else if (err.status === 404) {
          this._error = 'This invite link is invalid or has been removed.';
        } else {
          this._error = 'Something went wrong. Please try again.';
        }
      } else {
        this._error = 'Something went wrong. Please try again.';
      }
      this._loading = false;
    }
  }

  render() {
    if (this._loading) {
      return html`
        <div class="wa-stack wa-gap-m wa-align-items-center">
          <wa-spinner class="spinner"></wa-spinner>
          <p>Claiming your invite...</p>
        </div>
      `;
    }

    return html`
      <wa-callout variant="danger">
        <wa-icon slot="icon" name="circle-xmark"></wa-icon>
        ${this._error}
      </wa-callout>
      <div class="mt-l">
        <wa-button variant="brand" @click=${() => navigateTo('/dashboard')}>
          Go to Dashboard
        </wa-button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'claim-page': ClaimPage;
  }
}
