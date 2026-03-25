/**
 * Order confirmation page — shown after successful Stripe checkout.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { waUtilities } from '../styles/wa-utilities.js';
import { headingStyles } from '../styles/heading-shared.js';
import { navClick } from '../nav.js';
import { getOrder, type Order } from '../services/orders.js';
import { STATUS_VARIANTS } from '../../shared/products.js';

@customElement('order-confirmation-page')
export class OrderConfirmationPage extends LitElement {
  @property() orderId = '';
  @state() private _order: Order | null = null;
  @state() private _loading = true;
  @state() private _error = '';

  static styles = [waUtilities, headingStyles, css`
    :host {
      display: block;
      padding: var(--wa-space-xl) var(--wa-space-m);
      max-width: 600px;
      margin: 0 auto;
    }

    .success-icon {
      font-size: 3rem;
      color: var(--wa-color-success-50);
    }

    .order-ref {
      font-family: monospace;
      font-size: var(--wa-font-size-s);
      color: var(--wa-color-text-quiet);
    }
  `];

  connectedCallback(): void {
    super.connectedCallback();
    this._loadOrder();
  }

  private async _loadOrder() {
    if (!this.orderId) {
      this._loading = false;
      this._error = 'No order ID provided.';
      return;
    }
    this._loading = true;
    this._error = '';
    try {
      this._order = await getOrder(this.orderId);
    } catch {
      this._error = 'Unable to load order details.';
    } finally {
      this._loading = false;
    }
  }

  render() {
    if (this._loading) {
      return html`
        <div class="wa-cluster wa-justify-content-center">
          <wa-spinner></wa-spinner>
        </div>
      `;
    }

    if (this._error) {
      return html`
        <wa-callout variant="danger">
          <wa-icon slot="icon" name="circle-xmark"></wa-icon>
          ${this._error}
        </wa-callout>
      `;
    }

    return html`
      <div class="wa-stack wa-gap-l wa-align-items-center" style="text-align: center;">
        <wa-icon class="success-icon" name="circle-check"></wa-icon>
        <h1>Thank You!</h1>
        <p>We're preparing your map for print! You'll receive a shipping notification within 1\u20132 business days.</p>

        ${this._order ? html`
          <p class="order-ref">Order reference: ${this._order.id.slice(0, 8).toUpperCase()}</p>
          <p>Status: <wa-badge variant=${STATUS_VARIANTS[this._order.status] ?? 'neutral'}>${this._order.status.replace(/_/g, ' ')}</wa-badge></p>

          ${this._order.tracking_url ? html`
            <wa-callout variant="success">
              <wa-icon slot="icon" name="truck"></wa-icon>
              Your order has shipped!
              <br />
              <wa-button variant="brand" size="small" href=${this._order.tracking_url} target="_blank" style="margin-top: var(--wa-space-s)">
                <wa-icon slot="start" name="arrow-up-right-from-square"></wa-icon>
                Track Package
              </wa-button>
            </wa-callout>
          ` : nothing}
        ` : html`
          <p class="order-ref">Order reference: ${this.orderId.slice(0, 8).toUpperCase()}</p>
        `}

        <wa-button variant="brand" href="/dashboard" @click=${navClick('/dashboard')}>
          <wa-icon slot="start" name="map"></wa-icon>
          Back to Dashboard
        </wa-button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'order-confirmation-page': OrderConfirmationPage;
  }
}
