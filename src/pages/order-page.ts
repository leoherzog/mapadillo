/**
 * Order page — pre-checkout form for selecting product, size, and shipping address.
 *
 * Route: /order/:id (mapId)
 * Access: owner + editor only
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { waUtilities } from '../styles/wa-utilities.js';
import { headingStyles } from '../styles/heading-shared.js';
import { contentPageStyles } from '../styles/content-page.js';
import { hiddenMapStyles } from '../styles/hidden-map.js';
import { navigateTo, navClick } from '../nav.js';
import { isAuthenticated } from '../auth/auth-state.js';
import { getMap, type MapWithRole } from '../services/maps.js';
import { uploadPrintImage, createCheckout, getPrintQuote } from '../services/orders.js';
import { PRODUCTS, getProductSize } from '../../shared/products.js';
import { renderToBlob, type PaperSize, type Orientation } from '../map/map-export.js';
import { MapController } from '../map/map-controller.js';
import { MAP_CONTROLLER_OPTIONS } from '../config/map-themes.js';
import { COUNTRIES } from '../utils/countries.js';
import type { MapView } from '../components/map-view.js';
import '../components/map-view.js';

type OrderStep = 'form' | 'rendering' | 'uploading' | 'redirecting';

@customElement('order-page')
export class OrderPage extends LitElement {
  @property() mapId = '';

  @state() private _map: MapWithRole | null = null;
  @state() private _loading = true;
  @state() private _error = '';
  @state() private _mapReady = false;

  // Form state
  @state() private _productSku = PRODUCTS[0].sku;
  @state() private _size = '18x24';
  @state() private _name = '';
  @state() private _line1 = '';
  @state() private _line2 = '';
  @state() private _city = '';
  @state() private _state = '';
  @state() private _postalCode = '';
  @state() private _country = 'US';

  // Quote state
  @state() private _shippingQuote: { cents: number; days: number } | null = null;
  @state() private _quoteLoading = false;
  @state() private _quoteError = '';

  // Order flow
  @state() private _step: OrderStep = 'form';
  @state() private _orderError = '';

  private _mapController?: MapController;
  private _quoteTimer?: ReturnType<typeof setTimeout>;

  static styles = [waUtilities, headingStyles, contentPageStyles('700px'), hiddenMapStyles('800px', '600px'), css`
    h1 {
      font-size: var(--wa-font-size-2xl);
      margin-bottom: var(--wa-space-xs);
    }

    .map-name {
      color: var(--wa-color-text-quiet);
      font-size: var(--wa-font-size-s);
      margin-bottom: var(--wa-space-l);
    }

    .product-card {
      cursor: pointer;
      transition: outline-color 0.15s;
    }

    .product-card[data-selected] {
      outline: 2px solid var(--wa-color-brand-50);
    }

    .price {
      font-size: var(--wa-font-size-l);
      font-weight: var(--wa-font-weight-bold);
      color: var(--wa-color-brand-60);
    }

    .price-note {
      font-size: var(--wa-font-size-xs);
      color: var(--wa-color-text-quiet);
      text-align: center;
    }

    .address-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--wa-space-s);
    }

    .address-grid .full-width {
      grid-column: 1 / -1;
    }

    .order-btn {
      width: 100%;
    }

    .step-status {
      padding-top: var(--wa-space-2xl);
      text-align: center;
    }

    .step-status wa-spinner {
      font-size: 2rem;
    }

    .step-status p {
      margin-top: var(--wa-space-s);
      color: var(--wa-color-text-quiet);
    }

    @media (max-width: 700px) {
      .address-grid {
        grid-template-columns: 1fr;
      }
    }
  `];

  connectedCallback(): void {
    super.connectedCallback();
    if (!isAuthenticated()) {
      navigateTo(`/sign-in?returnTo=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    this._loadMap();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._mapController?.destroy();
    clearTimeout(this._quoteTimer);
  }

  private async _loadMap() {
    if (!this.mapId) return;
    this._loading = true;
    this._error = '';
    try {
      const data = await getMap(this.mapId);
      if (data.role !== 'owner' && data.role !== 'editor') {
        this._error = 'You do not have permission to order prints for this map.';
        return;
      }
      this._map = data;
      this._fetchQuote(); // Get initial shipping estimate
    } catch {
      this._error = 'Failed to load map.';
    } finally {
      this._loading = false;
    }
  }

  private _onMapReady() {
    this._mapReady = true;
    const mapView = this.shadowRoot?.querySelector('map-view') as MapView | null;
    if (!mapView?.map || !this._map) return;

    this._mapController?.destroy();
    this._mapController = new MapController(mapView.map, MAP_CONTROLLER_OPTIONS);
    void this._mapController.drawItems(this._map.stops);
  }

  private get _currentProduct() {
    return PRODUCTS.find(p => p.sku === this._productSku) ?? PRODUCTS[0];
  }

  private get _currentSize() {
    return getProductSize(this._productSku, this._size);
  }

  private get _totalCents(): number {
    const size = this._currentSize;
    if (!size) return 0;
    const shipping = this._shippingQuote?.cents ?? size.shippingPlaceholderCents;
    return size.priceCents + shipping;
  }

  render() {
    if (this._loading) {
      return html`<div class="wa-cluster wa-justify-content-center"><wa-spinner></wa-spinner></div>`;
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
      <!-- Hidden map for rendering (always mounted, persists across steps) -->
      <div class="hidden-map">
        <map-view @map-ready=${this._onMapReady}></map-view>
      </div>

      ${this._step !== 'form' ? this._renderProgress() : this._renderForm()}
    `;
  }

  private _renderForm() {
    const product = this._currentProduct;
    const sizeInfo = this._currentSize;

    return html`
      <wa-button size="small" variant="neutral" appearance="outlined" href="/export/${this.mapId}" @click=${navClick(`/export/${this.mapId}`)}>
        <wa-icon slot="start" name="arrow-left"></wa-icon>
        Back
      </wa-button>

      <h1>
        <wa-icon name="print"></wa-icon>
        Order a Print
      </h1>
      <p class="map-name">${this._map?.name ?? 'Untitled Trip'}</p>

      <div class="wa-stack wa-gap-l">

        <!-- Product type -->
        <wa-radio-group
          label="Product type"
          .value=${this._productSku}
          @change=${this._onProductChange}
        >
          ${PRODUCTS.map(p => html`
            <wa-radio appearance="button" value=${p.sku}>
              ${p.name}
            </wa-radio>
          `)}
        </wa-radio-group>
        <p class="price-note">${product.description}</p>

        <!-- Size -->
        <wa-radio-group
          label="Size"
          .value=${this._size}
          @change=${this._onSizeChange}
        >
          ${product.sizes.map(s => html`
            <wa-radio appearance="button" value=${s.size}>
              ${s.label} — <wa-format-number type="currency" currency="USD" .value=${s.priceCents / 100}></wa-format-number>
            </wa-radio>
          `)}
        </wa-radio-group>

        <wa-divider></wa-divider>

        <!-- Shipping address -->
        <h2>Shipping Address</h2>
        <form class="address-grid" @submit=${(e: Event) => e.preventDefault()}>
          <wa-input
            class="full-width"
            label="Full name"
            required
            autocomplete="name"
            .value=${this._name}
            @input=${(e: Event) => { this._name = (e.target as HTMLElement & { value: string }).value; }}
          ></wa-input>

          <wa-input
            class="full-width"
            label="Address line 1"
            required
            autocomplete="address-line1"
            .value=${this._line1}
            @input=${(e: Event) => { this._line1 = (e.target as HTMLElement & { value: string }).value; }}
          ></wa-input>

          <wa-input
            class="full-width"
            label="Address line 2"
            autocomplete="address-line2"
            .value=${this._line2}
            @input=${(e: Event) => { this._line2 = (e.target as HTMLElement & { value: string }).value; }}
          ></wa-input>

          <wa-input
            label="City"
            required
            autocomplete="address-level2"
            .value=${this._city}
            @input=${(e: Event) => { this._city = (e.target as HTMLElement & { value: string }).value; }}
          ></wa-input>

          <wa-input
            label="State / Province"
            autocomplete="address-level1"
            .value=${this._state}
            @input=${(e: Event) => { this._state = (e.target as HTMLElement & { value: string }).value; }}
          ></wa-input>

          <wa-input
            label="Postal code"
            required
            autocomplete="postal-code"
            .value=${this._postalCode}
            @input=${(e: Event) => { this._postalCode = (e.target as HTMLElement & { value: string }).value; }}
          ></wa-input>

          <wa-select
            label="Country"
            autocomplete="country"
            .value=${this._country}
            @change=${this._onCountryChange}
          >
            ${COUNTRIES.map(c => html`
              <wa-option value=${c.code}>${c.name}</wa-option>
            `)}
          </wa-select>
        </form>

        <!-- Shipping quote -->
        ${this._quoteLoading ? html`
          <div class="wa-cluster wa-gap-s wa-align-items-center">
            <wa-spinner></wa-spinner>
            <span class="price-note">Getting shipping estimate...</span>
          </div>
        ` : this._shippingQuote ? html`
          <div class="wa-cluster wa-gap-m">
            <span>Shipping: <strong><wa-format-number type="currency" currency="USD" .value=${this._shippingQuote.cents / 100}></wa-format-number></strong></span>
            <span class="price-note">Est. ${this._shippingQuote.days} business days</span>
          </div>
        ` : this._quoteError ? html`
          <p class="price-note">${this._quoteError}</p>
        ` : nothing}

        <wa-divider></wa-divider>

        <!-- Total + order button -->
        <div class="wa-split wa-align-items-center">
          <span class="price">Total: <wa-format-number type="currency" currency="USD" .value=${this._totalCents / 100}></wa-format-number></span>
          <span class="price-note">${sizeInfo ? `${product.name} — ${sizeInfo.label}` : ''}</span>
        </div>

        ${this._orderError ? html`
          <wa-callout variant="danger">
            <wa-icon slot="icon" name="circle-xmark"></wa-icon>
            ${this._orderError}
          </wa-callout>
        ` : nothing}

        <wa-button
          variant="brand"
          size="large"
          class="order-btn"
          ?loading=${this._step !== 'form'}
          ?disabled=${this._step !== 'form'}
          @click=${this._onOrder}
        >
          <wa-icon slot="start" name="credit-card"></wa-icon>
          Order Print
        </wa-button>

        <p class="price-note">
          You'll be redirected to Stripe for secure payment.
        </p>
      </div>
    `;
  }

  private _renderProgress() {
    const messages: Record<OrderStep, string> = {
      form: '',
      rendering: 'Rendering your map at print resolution...',
      uploading: 'Uploading print-ready image...',
      redirecting: 'Creating checkout session...',
    };

    return html`
      <div class="step-status wa-stack wa-gap-m wa-align-items-center">
        ${this._orderError ? nothing : html`<wa-spinner></wa-spinner>`}
        <p>${messages[this._step]}</p>
        ${this._orderError ? html`
          <wa-callout variant="danger">
            <wa-icon slot="icon" name="circle-xmark"></wa-icon>
            ${this._orderError}
          </wa-callout>
          <wa-button variant="neutral" appearance="outlined" @click=${() => { this._step = 'form'; this._orderError = ''; }}>
            Try Again
          </wa-button>
        ` : nothing}
      </div>
    `;
  }

  // ── Event handlers ──────────────────────────────────────────────────────

  private _onProductChange(e: Event) {
    this._productSku = (e.target as HTMLElement & { value: string }).value;
    // Reset size if not available for new product
    const product = this._currentProduct;
    if (!product.sizes.find(s => s.size === this._size)) {
      this._size = product.sizes[0].size;
    }
    this._fetchQuote();
  }

  private _onSizeChange(e: Event) {
    this._size = (e.target as HTMLElement & { value: string }).value;
    this._fetchQuote();
  }

  private _onCountryChange(e: Event) {
    this._country = (e.target as HTMLElement & { value: string }).value;
    this._fetchQuote();
  }

  private _fetchQuote() {
    clearTimeout(this._quoteTimer);
    if (!this._country) return;

    this._quoteTimer = setTimeout(async () => {
      this._quoteLoading = true;
      this._quoteError = '';
      try {
        const result = await getPrintQuote({
          product_sku: this._productSku,
          size: this._size,
          country: this._country,
        });
        this._shippingQuote = { cents: result.shipping_cost_cents, days: result.estimated_days };
      } catch {
        this._quoteError = 'Unable to get shipping estimate. A default shipping cost will be used.';
        this._shippingQuote = null;
      } finally {
        this._quoteLoading = false;
      }
    }, 500);
  }

  private async _onOrder() {
    this._orderError = '';

    // Validate form using native constraint validation
    const form = this.shadowRoot?.querySelector('form');
    if (form && !form.reportValidity()) return;

    // Immediately prevent double-click
    this._step = 'rendering';

    if (!this._mapReady || !this._mapController) {
      this._orderError = 'Map is still loading. Please wait a moment.';
      this._step = 'form';
      return;
    }

    const mapView = this.shadowRoot?.querySelector('map-view') as MapView | null;
    if (!mapView?.map) {
      this._orderError = 'Map not ready.';
      this._step = 'form';
      return;
    }

    try {
      // Read saved orientation from export settings
      let orientation: Orientation = 'portrait';
      try {
        const raw = this._map?.export_settings;
        if (raw && raw !== '{}') {
          const parsed = JSON.parse(raw);
          if (parsed.orientation) orientation = parsed.orientation;
        }
      } catch { /* use default */ }

      // Step 1: Render
      const blob = await renderToBlob(
        mapView.map,
        this._mapController.markerFeatures,
        this._size as PaperSize,
        orientation,
      );

      // Step 2: Upload
      this._step = 'uploading';
      const upload = await uploadPrintImage(this.mapId, blob);

      // Step 3: Create checkout
      this._step = 'redirecting';
      const checkout = await createCheckout({
        map_id: this.mapId,
        product_sku: this._productSku,
        size: this._size,
        shipping_address: {
          name: this._name.trim(),
          line1: this._line1.trim(),
          line2: this._line2.trim() || undefined,
          city: this._city.trim(),
          state: this._state.trim(),
          postalCode: this._postalCode.trim(),
          country: this._country,
        },
        image_key: upload.key,
        shipping_cost_cents: this._shippingQuote?.cents,
      });

      // Redirect to Stripe
      window.location.href = checkout.checkout_url;
    } catch (err) {
      this._orderError = err instanceof Error ? err.message : 'Order failed. Please try again.';
      // Stay on progress view to show error with retry button (don't reset to form)
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'order-page': OrderPage;
  }
}
