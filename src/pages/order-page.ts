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
import { ApiError, apiErrorMessage } from '../services/api-client.js';
import { PRODUCTS, PRINTABLE_SIZES, getProductSize } from '../../shared/products.js';
import { canEditRole, parseExportSettings } from '../../shared/types.js';
import { isPaperSize, type PaperSize, type Orientation } from '../../shared/paper.js';
import { exportDpi, MIN_PRINT_DPI, paperFramePadding, renderToBlob } from '../map/map-export.js';
import { COUNTRIES } from '../utils/countries.js';
import { fieldValue } from '../utils/form.js';
import { MapPageBase } from './map-page-base.js';
import '../components/map-view.js';

type OrderStep = 'form' | 'rendering' | 'uploading' | 'redirecting';

const STEP_MESSAGES: Record<OrderStep, string> = {
  form: '',
  rendering: 'Rendering your map at print resolution...',
  uploading: 'Uploading print-ready image...',
  redirecting: 'Creating checkout session...',
};

@customElement('order-page')
export class OrderPage extends MapPageBase {
  // Form state
  @state() private _productSku: string = PRODUCTS[0].sku;
  @state() private _size: PaperSize = '18x24';
  @state() private _name = '';
  @state() private _line1 = '';
  @state() private _line2 = '';
  @state() private _city = '';
  @state() private _state = '';
  @state() private _postalCode = '';
  @state() private _country = 'US';

  // Quote state
  /** Quote for the current product, size and country; null until one succeeds. */
  @state() private _shippingQuote: { cents: number } | null = null;
  @state() private _quoteLoading = false;
  @state() private _quoteError = '';

  // Order flow
  @state() private _step: OrderStep = 'form';
  @state() private _orderError = '';

  private _quoteTimer?: ReturnType<typeof setTimeout>;
  /** Bumped on every quote request so a slower, older response cannot overwrite a newer one. */
  private _quoteGeneration = 0;
  /** Resolves once drawItems + saved-viewport restore are done; gates the render. */
  private _mapDrawn?: Promise<void>;

  static styles = [waUtilities, headingStyles, contentPageStyles('700px'), hiddenMapStyles, css`
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

    .address-grid {
      --min-column-size: 16rem;
    }

    .order-btn {
      width: 100%;
    }

    .step-status {
      padding-top: var(--wa-space-2xl);
      text-align: center;
    }

    .step-status wa-spinner {
      font-size: var(--wa-font-size-2xl);
    }

    .step-status p {
      margin-top: var(--wa-space-s);
      color: var(--wa-color-text-quiet);
    }
  `];

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('pageshow', this._onPageShow);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('pageshow', this._onPageShow);
    clearTimeout(this._quoteTimer);
  }

  /** Back from Stripe can restore this page from bfcache mid-checkout; reopen the form. */
  private _onPageShow = (e: PageTransitionEvent) => {
    if (e.persisted) {
      this._step = 'form';
      this._orderError = '';
    }
  };

  protected override async _loadMap() {
    await super._loadMap();
    if (!this._map) return;
    if (!canEditRole(this._map.role)) {
      this._error = 'You do not have permission to order prints for this map.';
      this._map = null;
      return;
    }
    const saved = parseExportSettings(this._map.export_settings)?.paperSize;
    if (saved && getProductSize(this._productSku, saved)) this._size = saved;
    this._fetchQuote();
  }

  /** The map is a hidden render source, so its auto-fit jumps instead of animating. */
  protected override _animateFit = false;

  /** Pads the auto-fit to the narrowest printable frame, since it runs before a size is chosen. */
  protected override _fitPadding() {
    const el = this._mapView?.map?.getContainer();
    if (!el) return 60;
    const pads = [...PRINTABLE_SIZES].filter(isPaperSize).map((size) =>
      paperFramePadding(el.clientWidth, el.clientHeight, size, this._orientation));
    const x = Math.max(...pads.map((p) => p.left));
    const y = Math.max(...pads.map((p) => p.top));
    return { top: y, bottom: y, left: x, right: x };
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

  /** Saved preview orientation; landscape matches the preview and export defaults. */
  private get _orientation(): Orientation {
    return parseExportSettings(this._map?.export_settings)?.orientation ?? 'landscape';
  }

  /** Effective DPI of the print render for the selected size on this device. */
  private get _printDpi(): number {
    return exportDpi(this._size, this._orientation);
  }

  private get _totalCents(): number {
    const size = this._currentSize;
    if (!size) return 0;
    return size.priceCents + (this._shippingQuote?.cents ?? 0);
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
        <map-view @map-ready=${this._onMapReady} @map-error=${this._onMapError}></map-view>
      </div>

      <p class="wa-visually-hidden" role="status">${this._orderError ? '' : STEP_MESSAGES[this._step]}</p>

      ${this._step !== 'form' ? this._renderProgress() : this._renderForm()}
    `;
  }

  private _renderForm() {
    const product = this._currentProduct;
    const sizeInfo = this._currentSize;

    return html`
      <wa-button size="s" variant="neutral" appearance="outlined" href="/export/${this.mapId}">
        <wa-icon slot="start" name="arrow-left"></wa-icon>
        Back
      </wa-button>

      <h1>
        <wa-icon name="print"></wa-icon>
        Order a Print
      </h1>
      <p class="map-name">${this._map?.name ?? 'Untitled Trip'}</p>

      <form class="wa-stack wa-gap-l" @submit=${this._onSubmit}>

        <!-- Product type -->
        <wa-radio-group
          label="Product type"
          hint=${product.description}
          .value=${this._productSku}
          @change=${this._onProductChange}
        >
          ${PRODUCTS.map(p => html`
            <wa-radio appearance="button" value=${p.sku}>
              ${p.name}
            </wa-radio>
          `)}
        </wa-radio-group>

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

        ${this._printDpi < MIN_PRINT_DPI ? html`
          <wa-callout variant="warning">
            <wa-icon slot="icon" name="triangle-exclamation"></wa-icon>
            This browser can render this size at about ${Math.round(this._printDpi)} DPI, so fine detail may print soft.
            A desktop browser usually renders sharper.
          </wa-callout>
        ` : nothing}

        <wa-divider></wa-divider>

        <!-- Shipping address -->
        <h2>Shipping Address</h2>
        <div class="address-grid wa-grid wa-gap-s">
          <wa-input
            class="wa-span-grid"
            label="Full name"
            required
            autocomplete="name"
            .value=${this._name}
            @input=${(e: Event) => { this._name = fieldValue(e); }}
          ></wa-input>

          <wa-input
            class="wa-span-grid"
            label="Address line 1"
            required
            autocomplete="address-line1"
            .value=${this._line1}
            @input=${(e: Event) => { this._line1 = fieldValue(e); }}
          ></wa-input>

          <wa-input
            class="wa-span-grid"
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
            .value=${this._country}
            @change=${this._onCountryChange}
          >
            ${COUNTRIES.map(c => html`
              <wa-option value=${c.code}>${c.name}</wa-option>
            `)}
          </wa-select>
        </div>

        <!-- Shipping quote -->
        ${this._quoteLoading ? html`
          <div class="wa-cluster wa-gap-s wa-align-items-center">
            <wa-spinner></wa-spinner>
            <span class="wa-caption-xs">Getting shipping estimate...</span>
          </div>
        ` : this._shippingQuote ? html`
          <div>Shipping: <strong><wa-format-number type="currency" currency="USD" .value=${this._shippingQuote.cents / 100}></wa-format-number></strong></div>
        ` : this._quoteError ? html`
          <wa-callout variant="warning">
            <wa-icon slot="icon" name="triangle-exclamation"></wa-icon>
            ${this._quoteError}
          </wa-callout>
        ` : nothing}

        <wa-divider></wa-divider>

        <!-- Total + order button -->
        <div class="wa-split wa-align-items-center">
          <span class="price">Total: <wa-format-number type="currency" currency="USD" .value=${this._totalCents / 100}></wa-format-number></span>
          <span class="wa-caption-xs">${sizeInfo ? `${product.name} — ${sizeInfo.label}` : ''}</span>
        </div>

        ${this._orderError ? errorCallout(this._orderError) : nothing}

        <wa-button
          type="submit"
          variant="brand"
          size="l"
          class="order-btn"
          ?disabled=${!this._shippingQuote}
        >
          <wa-icon slot="start" name="credit-card"></wa-icon>
          Order Print
        </wa-button>

        <p class="wa-caption-xs wa-text-center">
          You'll be redirected to Stripe for secure payment.
        </p>
      </form>
    `;
  }

  private _renderProgress() {
    return html`
      <div class="step-status wa-stack wa-gap-m wa-align-items-center">
        ${this._orderError ? html`
          ${errorCallout(this._orderError)}
          <wa-button variant="neutral" appearance="outlined" @click=${this._onRetry}>
            Try Again
          </wa-button>
        ` : html`
          <wa-spinner></wa-spinner>
          <p>${STEP_MESSAGES[this._step]}</p>
        `}
      </div>
    `;
  }

  // ── Event handlers ──────────────────────────────────────────────────────

  private _onMapError() {
    this._error = 'The map could not be loaded. Please try again.';
  }

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
    this._size = fieldValue(e) as PaperSize;
    this._fetchQuote();
  }

  private _onCountryChange(e: Event) {
    this._country = fieldValue(e);
    this._fetchQuote();
  }

  private _fetchQuote() {
    clearTimeout(this._quoteTimer);
    // Bump before the debounce so a response already in flight is discarded too.
    const gen = ++this._quoteGeneration;
    // Ordering stays blocked from the change, through the debounce, until a quote for it succeeds.
    this._shippingQuote = null;
    this._quoteError = '';
    this._quoteLoading = Boolean(this._country);
    if (!this._country) return;

    this._quoteTimer = setTimeout(async () => {
      try {
        const result = await getPrintQuote({
          product_sku: this._productSku,
          size: this._size,
          country: this._country,
        });
        if (gen !== this._quoteGeneration) return;
        this._shippingQuote = { cents: result.shipping_cost_cents };
      } catch (err) {
        if (gen !== this._quoteGeneration) return;
        this._quoteError = err instanceof ApiError && err.status === 422
          ? "This product and size can't ship to that country. Choose another size or product."
          : 'Unable to get a shipping quote for this address.';
      } finally {
        if (gen === this._quoteGeneration) this._quoteLoading = false;
      }
    }, 500);
  }

  /** wa-button's submit runs native constraint validation on the address fields before this fires. */
  private _onSubmit(e: SubmitEvent) {
    e.preventDefault();
    void this._onOrder();
  }

  private async _onRetry() {
    this._step = 'form';
    this._orderError = '';
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLElement>('.order-btn')?.focus();
  }

  private async _onOrder() {
    if (!this._shippingQuote) return;
    this._orderError = '';

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
      // Without this wait renderToBlob captures the auto-fit viewport, not the saved one.
      await this._mapDrawn;

      const blob = await renderToBlob(
        map,
        this._mapController.markerFeatures,
        this._size,
        this._orientation,
        parseExportSettings(this._map?.export_settings)?.viewSize,
      );

      this._step = 'uploading';
      const upload = await uploadPrintImage(this.mapId, blob);

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
      });

      // Redirect to Stripe — validate origin so a compromised/misconfigured
      // backend response can't redirect users to an attacker-controlled site.
      const redirectUrl = URL.parse(checkout.checkout_url);
      if (redirectUrl?.protocol !== 'https:' || redirectUrl.host !== 'checkout.stripe.com') {
        throw new Error('Refusing to redirect to non-Stripe checkout URL.');
      }
      window.location.href = redirectUrl.href;
    } catch (err) {
      this._orderError = apiErrorMessage(err, 'Order failed. Please try again.');
      // Stay on progress view to show error with retry button (don't reset to form)
      await this.updateComplete;
      this.renderRoot.querySelector<HTMLElement>('.step-status wa-button')?.focus();
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'order-page': OrderPage;
  }
}
