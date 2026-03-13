/**
 * Admin page — order management with self-authentication via admin secret.
 *
 * Route: /admin
 * Auth: prompts for admin secret, stores in sessionStorage
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { waUtilities } from '../styles/wa-utilities.js';
import { headingStyles } from '../styles/heading-shared.js';
import { STATUS_VARIANTS } from '../../shared/products.js';
import type { Order } from '../../shared/types.js';

interface AdminOrder extends Order {
  map_name: string;
  user_email: string;
}

@customElement('admin-page')
export class AdminPage extends LitElement {
  @state() private _secret = '';
  @state() private _authenticated = false;
  @state() private _orders: AdminOrder[] = [];
  @state() private _loading = false;
  @state() private _error = '';
  @state() private _statusFilter = '';
  @state() private _actionLoading: string | null = null;

  static styles = [waUtilities, headingStyles, css`
    :host {
      display: block;
      padding: var(--wa-space-xl) var(--wa-space-m);
      max-width: 1200px;
      margin: 0 auto;
      overflow-y: auto;
    }

    h1 { font-size: var(--wa-font-size-2xl); margin-bottom: var(--wa-space-l); }

    .auth-form {
      max-width: 400px;
      margin: var(--wa-space-2xl) auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--wa-font-size-s);
    }

    th, td {
      padding: var(--wa-space-xs) var(--wa-space-s);
      text-align: left;
      border-bottom: 1px solid var(--wa-color-border-normal);
    }

    th {
      font-weight: var(--wa-font-weight-semibold);
      color: var(--wa-color-text-quiet);
      font-size: var(--wa-font-size-xs);
      text-transform: uppercase;
    }

    .mono { font-family: monospace; font-size: var(--wa-font-size-xs); }

    @media (max-width: 700px) {
      :host { padding: var(--wa-space-m) var(--wa-space-xs); }
      table { font-size: var(--wa-font-size-xs); }
      th, td { padding: var(--wa-space-2xs) var(--wa-space-xs); }
    }
  `];

  connectedCallback(): void {
    super.connectedCallback();
    const stored = sessionStorage.getItem('admin_secret');
    if (stored) {
      this._secret = stored;
      this._authenticated = true;
      this._fetchOrders();
    }
  }

  private get _headers(): HeadersInit {
    return { 'Authorization': `Bearer ${this._secret}`, 'Content-Type': 'application/json' };
  }

  private async _authenticate() {
    if (!this._secret.trim()) return;
    this._error = '';
    sessionStorage.setItem('admin_secret', this._secret);
    this._authenticated = true;
    await this._fetchOrders();
    // If fetchOrders got a 401, _authenticated is already reset
  }

  private async _fetchOrders() {
    this._loading = true;
    this._error = '';
    try {
      const query = this._statusFilter ? `?status=${this._statusFilter}` : '';
      const res = await fetch(`/api/admin/orders${query}`, { headers: this._headers });
      if (res.status === 401) {
        sessionStorage.removeItem('admin_secret');
        this._authenticated = false;
        this._error = 'Session expired. Please re-authenticate.';
        return;
      }
      if (!res.ok) throw new Error('Failed to fetch orders');
      this._orders = await res.json() as AdminOrder[];
    } catch {
      this._error = 'Failed to load orders.';
    } finally {
      this._loading = false;
    }
  }

  private async _submitToProdigi(orderId: string) {
    this._actionLoading = orderId;
    try {
      const res = await fetch(`/api/admin/orders/${orderId}`, {
        method: 'PATCH',
        headers: this._headers,
        body: JSON.stringify({ action: 'submit_to_prodigi' }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? 'Failed');
      }
      await this._fetchOrders();
    } catch (err) {
      this._error = err instanceof Error ? err.message : 'Action failed.';
    } finally {
      this._actionLoading = null;
    }
  }

  render() {
    if (!this._authenticated) {
      return html`
        <div class="auth-form wa-stack wa-gap-m">
          <h1><wa-icon name="lock"></wa-icon> Admin</h1>
          <wa-input
            label="Admin Secret"
            type="password"
            .value=${this._secret}
            @input=${(e: Event) => { this._secret = (e.target as HTMLInputElement).value; }}
            @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') this._authenticate(); }}
          ></wa-input>
          ${this._error ? html`<wa-callout variant="danger"><wa-icon slot="icon" name="circle-xmark"></wa-icon>${this._error}</wa-callout>` : nothing}
          <wa-button variant="brand" ?loading=${this._loading} @click=${this._authenticate}>Sign In</wa-button>
        </div>
      `;
    }

    return html`
      <h1><wa-icon name="lock"></wa-icon> Admin — Orders</h1>

      <div class="wa-cluster wa-gap-s wa-align-items-end" style="margin-bottom: var(--wa-space-l);">
        <wa-select
          label="Status filter"
          placeholder="All statuses"
          with-clear
          .value=${this._statusFilter}
          @change=${(e: Event) => { this._statusFilter = (e.target as HTMLSelectElement).value; this._fetchOrders(); }}
          @wa-clear=${() => { this._statusFilter = ''; this._fetchOrders(); }}
        >
          <wa-option value="pending_payment">Pending Payment</wa-option>
          <wa-option value="paid">Paid</wa-option>
          <wa-option value="pending_render">Pending Render</wa-option>
          <wa-option value="submitted">Submitted</wa-option>
          <wa-option value="in_production">In Production</wa-option>
          <wa-option value="shipped">Shipped</wa-option>
          <wa-option value="completed">Completed</wa-option>
          <wa-option value="cancelled">Cancelled</wa-option>
        </wa-select>
        <wa-button size="small" variant="neutral" appearance="outlined" ?loading=${this._loading} @click=${() => this._fetchOrders()}>
          <wa-icon slot="start" name="arrows-rotate"></wa-icon> Refresh
        </wa-button>
      </div>

      ${this._error ? html`<wa-callout variant="danger"><wa-icon slot="icon" name="circle-xmark"></wa-icon>${this._error}</wa-callout>` : nothing}

      ${this._loading && this._orders.length === 0
        ? html`<div class="wa-cluster wa-justify-content-center"><wa-spinner></wa-spinner></div>`
        : this._orders.length === 0
          ? html`<wa-callout variant="neutral"><wa-icon slot="icon" name="box-open"></wa-icon>No orders found.</wa-callout>`
          : html`
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>User</th>
                    <th>Map</th>
                    <th>Product</th>
                    <th>Size</th>
                    <th>Status</th>
                    <th>Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${this._orders.map(o => html`
                    <tr>
                      <td class="mono">${o.id.slice(0, 8)}</td>
                      <td>${o.user_email}</td>
                      <td>${o.map_name}</td>
                      <td>${o.product_type}</td>
                      <td>${o.poster_size}</td>
                      <td>
                        <wa-badge variant=${STATUS_VARIANTS[o.status] ?? 'neutral'}>${o.status.replace(/_/g, ' ')}</wa-badge>
                      </td>
                      <td><wa-relative-time .date=${new Date(o.created_at)}></wa-relative-time></td>
                      <td>
                        ${(o.status === 'pending_render' || o.status === 'paid') ? html`
                          <wa-button
                            size="small"
                            variant="brand"
                            ?loading=${this._actionLoading === o.id}
                            ?disabled=${this._actionLoading !== null}
                            @click=${() => this._submitToProdigi(o.id)}
                          >Submit</wa-button>
                        ` : o.tracking_url ? html`
                          <a href=${o.tracking_url} target="_blank" rel="noopener">Track</a>
                        ` : nothing}
                      </td>
                    </tr>
                  `)}
                </tbody>
              </table>
            `}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'admin-page': AdminPage;
  }
}
