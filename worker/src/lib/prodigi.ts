/**
 * Prodigi Print API v4 client.
 * https://www.prodigi.com/print-api/docs/
 */

import type { ShippingAddress } from '../../../shared/types.js';

interface ProdigiQuoteRequest {
  sku: string;
  destinationCountry: string;
}

interface ProdigiQuoteResponse {
  shippingCostCents: number;
}

interface ProdigiCreateOrderRequest {
  orderId: string;
  sku: string;
  imageUrl: string;
  shippingAddress: ShippingAddress;
  /** Recipient email for delivery updates. */
  email?: string;
  /** Public URL Prodigi calls when the order changes. */
  callbackUrl?: string;
}

interface ProdigiCreateOrderResponse {
  prodigiOrderId: string;
}

/** A Prodigi order as returned by GET /orders/{id}. */
export interface ProdigiOrder {
  id: string;
  status: { stage: string };
  shipments?: Array<{ status?: string; tracking?: { url?: string; number?: string } }>;
}

/** Prodigi cannot print or ship the item to the requested destination. */
export class ProdigiNotAvailableError extends Error {
  override name = 'ProdigiNotAvailableError';
}

const SANDBOX_URL = 'https://api.sandbox.prodigi.com/v4.0';
const LIVE_URL = 'https://api.prodigi.com/v4.0';

function getBaseUrl(sandbox: boolean): string {
  return sandbox ? SANDBOX_URL : LIVE_URL;
}

/** Parse PRODIGI_SANDBOX: "true", "1", "yes" or "on" (case-insensitive, trimmed) selects the sandbox; anything else is live. */
export function isSandbox(value: string | undefined): boolean {
  if (!value) return false;
  return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
}

/**
 * Quote Budget shipping in USD for one copy of `sku`.
 * @throws ProdigiNotAvailableError when Prodigi cannot ship the item to the destination
 */
export async function getShippingQuote(
  apiKey: string,
  req: ProdigiQuoteRequest,
  sandbox: boolean,
): Promise<ProdigiQuoteResponse> {
  const baseUrl = getBaseUrl(sandbox);
  const res = await fetch(`${baseUrl}/quotes`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      shippingMethod: 'Budget',
      destinationCountryCode: req.destinationCountry,
      currencyCode: 'USD',
      items: [{
        sku: req.sku,
        copies: 1,
        assets: [{ printArea: 'default' }],
      }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Prodigi quote failed (${res.status}): ${text}`);
  }

  const data = await res.json() as {
    outcome?: string;
    quotes?: Array<{
      costSummary: { shipping: { amount: string; currency: string } };
    }>;
  };

  // A successful response without a quote means the item cannot ship there; it must block ordering.
  const quote = data.quotes?.[0];
  if (!quote || data.outcome?.toLowerCase() === 'notavailable') {
    throw new ProdigiNotAvailableError(`${req.sku} cannot ship to ${req.destinationCountry}`);
  }

  // Checkout charges this amount as USD cents.
  const { amount, currency } = quote.costSummary.shipping;
  if (currency !== 'USD') throw new Error(`Unexpected Prodigi quote currency: ${currency}`);
  // Number('') and Number(null) are 0, so a blank amount must not read as free shipping.
  const shippingAmount = typeof amount === 'string' && amount.trim() !== '' ? Number(amount) : NaN;
  if (!Number.isFinite(shippingAmount) || shippingAmount < 0) {
    throw new Error(`Invalid Prodigi shipping amount: ${amount}`);
  }

  return { shippingCostCents: Math.round(shippingAmount * 100) };
}

export async function createOrder(
  apiKey: string,
  req: ProdigiCreateOrderRequest,
  sandbox: boolean,
): Promise<ProdigiCreateOrderResponse> {
  const baseUrl = getBaseUrl(sandbox);
  const res = await fetch(`${baseUrl}/orders`, {
    method: 'POST',
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      idempotencyKey: req.orderId,
      merchantReference: req.orderId,
      callbackUrl: req.callbackUrl,
      shippingMethod: 'Budget',
      recipient: {
        name: req.shippingAddress.name,
        email: req.email,
        address: {
          line1: req.shippingAddress.line1,
          line2: req.shippingAddress.line2 || undefined,
          postalOrZipCode: req.shippingAddress.postalCode,
          townOrCity: req.shippingAddress.city,
          stateOrCounty: req.shippingAddress.state,
          countryCode: req.shippingAddress.country,
        },
      },
      items: [{
        sku: req.sku,
        copies: 1,
        sizing: 'fillPrintArea',
        assets: [{
          printArea: 'default',
          url: req.imageUrl,
        }],
      }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Prodigi order creation failed (${res.status}): ${text}`);
  }

  const data = await res.json() as { order: { id: string } };
  return { prodigiOrderId: data.order.id };
}

/** Fetch the current state of a Prodigi order. */
export async function getOrder(apiKey: string, prodigiOrderId: string, sandbox: boolean): Promise<ProdigiOrder> {
  const res = await fetch(`${getBaseUrl(sandbox)}/orders/${encodeURIComponent(prodigiOrderId)}`, {
    headers: { 'X-API-Key': apiKey },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Prodigi get order failed (${res.status}): ${text}`);
  }

  const data = await res.json() as { order: ProdigiOrder };
  return data.order;
}
