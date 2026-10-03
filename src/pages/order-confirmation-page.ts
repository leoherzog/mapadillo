/**
 * Order confirmation page — shown after successful Stripe checkout.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { waUtilities } from '../styles/wa-utilities.js';
import { headingStyles } from '../styles/heading-shared.js';
import { contentPageStyles } from '../styles/content-page.js';
import { getOrder, type Order } from '../services/orders.js';
import { errorCallout, orderStatusBadge } from '../components/ui.js';

@customElement('order-confirmation-page')
export class OrderConfirmationPage extends LitElement {
  @property() orderId = '';
  @state() private _order: Order | null = null;
  @state() private _loading = true;
  @state() private _error = '';

  static styles = [waUtilities, headingStyles, contentPageStyles('600px'), css`
    .success-icon {
      font-size: 3rem;
      color: var(--wa-color-success-50);
    }

    wa-callout wa-button {
      margin-top: var(--wa-space-s);
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
      return errorCallout(this._error);
    }

    const order = this._order;
    if (!order) return nothing;

    return html`
      <div class="wa-stack wa-gap-l wa-align-items-center wa-text-center">
        <wa-icon class="success-icon" name="circle-check"></wa-icon>
        <h1>Thank You!</h1>
        <p>We're preparing your map for print! You'll receive a shipping notification within 1\u20132 business days.</p>

        <p class="order-ref">Order reference: ${order.id.slice(0, 8).toUpperCase()}</p>
        <p>Status: ${orderStatusBadge(order.status)}</p>

        ${order.tracking_url ? html`
          <wa-callout variant="success">
            <wa-icon slot="icon" name="truck"></wa-icon>
            Your order has shipped!
            <br />
            <wa-button variant="brand" size="small" href=${order.tracking_url} target="_blank">
              <wa-icon slot="start" name="arrow-up-right-from-square"></wa-icon>
              Track Package
            </wa-button>
          </wa-callout>
        ` : nothing}

        <wa-button variant="brand" href="/dashboard">
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
