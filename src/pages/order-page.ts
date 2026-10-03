/**
 * Order page — pre-checkout form for selecting product, size, and shipping address.
 *
 * Route: /order/:id (mapId)
 * Access: owner + editor only
 */
import { html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { waUtilities } from '../styles/wa-utilities.js';
import { headingStyles } from '../styles/heading-shared.js';
import { contentPageStyles } from '../styles/content-page.js';
import { hiddenMapStyles } from '../styles/hidden-map.js';
import { errorCallout } from '../components/ui.js';
import { uploadPrintImage, createCheckout, getPrintQuote } from '../services/orders.js';
import { PRODUCTS, getProductSize, skuToPaperSize } from '../../shared/products.js';
import { canEditRole, parseExportSettings } from '../../shared/types.js';
import { renderToBlob } from '../map/map-export.js';
import { COUNTRIES } from '../utils/countries.js';
import { fieldValue } from '../utils/form.js';
import { MapPageBase } from './map-page-base.js';
import '../components/map-view.js';

type OrderStep = 'form' | 'rendering' | 'uploading' | 'redirecting';

@customElement('order-page')
export class OrderPage extends MapPageBase {
  // Form state
  @state() private _productSku: string = PRODUCTS[0].sku;
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

  private _quoteTimer?: ReturnType<typeof setTimeout>;
  /** Resolves once drawItems + saved-viewport restore are done; gates the render. */
  private _mapDrawn?: Promise<void>;

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

  disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this._quoteTimer);
  }

  protected override async _loadMap() {
    await super._loadMap();
    if (!this._map) return;
    if (!canEditRole(this._map.role)) {
      this._error = 'You do not have permission to order prints for this map.';
      this._map = null;
      return;
    }
    this._fetchQuote();
  }

  /** Draw stops, then restore the saved viewport so renderToBlob captures it rather than the auto-fit view. */
  protected override _syncMap(): Promise<void> {
    this._mapDrawn = (async () => {
      await super._syncMap();
      await this._applyRestoredViewport(parseExportSettings(this._map?.export_settings) ?? {});
    })();
    return this._mapDrawn;
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
    // _loadMap's role check runs after the base has set _map, so hold the form until it has.
    if (this._loading || (this._map && !canEditRole(this._map.role))) {
      return html`<div class="wa-cluster wa-justify-content-center"><wa-spinner></wa-spinner></div>`;
    }
    if (this._error) {
      return errorCallout(this._error);
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
      <wa-button size="small" variant="neutral" appearance="outlined" href="/export/${this.mapId}">
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
            @input=${(e: Event) => { this._name = fieldValue(e); }}
          ></wa-input>

          <wa-input
            class="full-width"
            label="Address line 1"
            required
            autocomplete="address-line1"
            .value=${this._line1}
            @input=${(e: Event) => { this._line1 = fieldValue(e); }}
          ></wa-input>

          <wa-input
            class="full-width"
            label="Address line 2"
            autocomplete="address-line2"
            .value=${this._line2}
            @input=${(e: Event) => { this._line2 = fieldValue(e); }}
          ></wa-input>

          <wa-input
            label="City"
            required
            autocomplete="address-level2"
            .value=${this._city}
            @input=${(e: Event) => { this._city = fieldValue(e); }}
          ></wa-input>

          <wa-input
            label="State / Province"
            autocomplete="address-level1"
            .value=${this._state}
            @input=${(e: Event) => { this._state = fieldValue(e); }}
          ></wa-input>

          <wa-input
            label="Postal code"
            required
            autocomplete="postal-code"
            .value=${this._postalCode}
            @input=${(e: Event) => { this._postalCode = fieldValue(e); }}
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

        ${this._orderError ? errorCallout(this._orderError) : nothing}

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
          ${errorCallout(this._orderError)}
          <wa-button variant="neutral" appearance="outlined" @click=${() => { this._step = 'form'; this._orderError = ''; }}>
            Try Again
          </wa-button>
        ` : nothing}
      </div>
    `;
  }

  // ── Event handlers ──────────────────────────────────────────────────────

  private _onProductChange(e: Event) {
    this._productSku = fieldValue(e);
    // Reset size if not available for new product
    const product = this._currentProduct;
    if (!product.sizes.find(s => s.size === this._size)) {
      this._size = product.sizes[0].size;
    }
    this._fetchQuote();
  }

  private _onSizeChange(e: Event) {
    this._size = fieldValue(e);
    this._fetchQuote();
  }

  private _onCountryChange(e: Event) {
    this._country = fieldValue(e);
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

    const map = this._mapView?.map;
    if (!map) {
      this._orderError = 'Map not ready.';
      this._step = 'form';
      return;
    }

    try {
      const orientation = parseExportSettings(this._map?.export_settings)?.orientation ?? 'portrait';

      // Without this wait renderToBlob captures the auto-fit viewport, not the saved one.
      await this._mapDrawn;

      // Convert the selected size (e.g. '18x24') to a PaperSize. Validates
      // the size is a known printable paper; renderToBlob's paper-size aware
      // render path needs a PaperSize literal, not a raw SKU size string.
      const paperSize = skuToPaperSize(this._size);

      // Step 1: Render
      const blob = await renderToBlob(
        map,
        this._mapController.markerFeatures,
        paperSize,
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

      // Redirect to Stripe — validate origin so a compromised/misconfigured
      // backend response can't redirect users to an attacker-controlled site.
      let redirectUrl: URL;
      try {
        redirectUrl = new URL(checkout.checkout_url);
      } catch {
        throw new Error('Invalid checkout URL returned by server.');
      }
      if (redirectUrl.protocol !== 'https:' || redirectUrl.host !== 'checkout.stripe.com') {
        throw new Error('Refusing to redirect to non-Stripe checkout URL.');
      }
      window.location.href = redirectUrl.toString();
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
