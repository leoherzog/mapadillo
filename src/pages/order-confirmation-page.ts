/**
 * Order confirmation page — shown after successful Stripe checkout.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { waUtilities } from '../styles/wa-utilities.js';
import { headingStyles } from '../styles/heading-shared.js';
import { contentPageStyles } from '../styles/content-page.js';
import { getOrder, type Order } from '../services/orders.js';
import { orderRef } from '../../shared/products.js';
import { errorCallout, orderStatusBadge } from '../components/ui.js';

@customElement('order-confirmation-page')
export class OrderConfirmationPage extends LitElement {
  @property() orderId = '';
  @state() private _order: Order | null = null;
  @state() private _loading = true;
  @state() private _error = '';
  @state() private _pollsLeft = 15;
  private _pollTimer?: ReturnType<typeof setTimeout>;

  static styles = [waUtilities, headingStyles, contentPageStyles('600px'), css`
    .success-icon {
      font-size: var(--wa-font-size-3xl);
      color: var(--wa-color-success-50);
    }

    wa-callout wa-button {
      margin-top: var(--wa-space-s);
    }

    .order-ref {
      font-family: var(--wa-font-family-code);
      font-size: var(--wa-font-size-s);
      color: var(--wa-color-text-quiet);
    }
  `];

  connectedCallback(): void {
    super.connectedCallback();
    this._loadOrder();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this._pollTimer);
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
    this._schedulePoll();
  }

  /** Re-fetches every 2 s while the Stripe webhook has not yet moved the order out of pending_payment. */
  private _schedulePoll() {
    if (!this.isConnected || this._order?.status !== 'pending_payment' || this._pollsLeft <= 0) return;
    this._pollTimer = setTimeout(async () => {
      this._pollsLeft--;
      try {
        this._order = await getOrder(this.orderId);
      } catch {
        // Keep showing the last loaded order.
      }
      this._schedulePoll();
    }, 2000);
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

    const headline = order.status === 'cancelled' || order.status === 'failed'
      ? errorCallout(order.status === 'cancelled' ? 'This order was cancelled.' : 'This order could not be completed.')
      : order.status === 'pending_payment'
        ? html`
            <wa-spinner></wa-spinner>
            <h1>Confirming your payment…</h1>
            ${this._pollsLeft > 0 ? nothing : html`<p>Payment is still being confirmed. Refresh this page in a minute.</p>`}`
        : html`
            <wa-icon class="success-icon" name="circle-check"></wa-icon>
            <h1>Thank You!</h1>
            <p>We're preparing your map for print. Check this page or your dashboard for its status and tracking link.</p>`;

    return html`
      <div class="wa-stack wa-gap-l wa-align-items-center wa-text-center">
        ${headline}

        <p class="order-ref">Order reference: ${orderRef(order.id)}</p>
        <p>Status: ${orderStatusBadge(order.status)}</p>

        ${order.tracking_url ? html`
          <wa-callout variant="success">
            <wa-icon slot="icon" name="truck"></wa-icon>
            Your order has shipped!
            <br />
            <wa-button variant="brand" size="s" href=${order.tracking_url} target="_blank">
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
