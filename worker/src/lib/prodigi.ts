/**
 * Prodigi Print API v4 client.
 * https://www.prodigi.com/print-api/docs/
 */

interface ProdigiQuoteRequest {
  sku: string;
  destinationCountry: string;
}

interface ProdigiQuoteResponse {
  shippingCostCents: number;
  estimatedDays: number;
}

interface ProdigiCreateOrderRequest {
  orderId: string;
  sku: string;
  imageUrl: string;
  shippingAddress: {
    name: string;
    line1: string;
    line2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
}

interface ProdigiCreateOrderResponse {
  prodigiOrderId: string;
}

const SANDBOX_URL = 'https://api.sandbox.prodigi.com/v4.0';
const LIVE_URL = 'https://api.prodigi.com/v4.0';

function getBaseUrl(sandbox: boolean): string {
  return sandbox ? SANDBOX_URL : LIVE_URL;
}

/**
 * Parse the PRODIGI_SANDBOX env var as a boolean. Accepts the common truthy
 * spellings ("true", "1", "yes", "on"); anything else — including undefined —
 * resolves to false (live mode). Consolidating this avoids subtle drift where
 * one call site interprets the flag differently from another.
 */
export function isSandbox(value: string | boolean | undefined | null): boolean {
  if (typeof value === 'boolean') return value;
  if (!value) return false;
  return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
}

export async function getShippingQuote(
  apiKey: string,
  req: ProdigiQuoteRequest,
  sandbox = false,
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
    quotes: Array<{
      costSummary: { shipping: { amount: string; currency: string } };
      shipments: Array<{ fulfillmentLocation: { countryCode: string }; carrier: { deliveryEstimate?: { estimatedDays?: number } } }>;
    }>;
  };

  const quote = data.quotes[0];
  if (!quote) throw new Error('No quote returned from Prodigi');

  const shippingAmount = parseFloat(quote.costSummary.shipping.amount);
  const shippingCostCents = Math.round(shippingAmount * 100);
  const estimatedDays = quote.shipments?.[0]?.carrier?.deliveryEstimate?.estimatedDays ?? 14;

  return { shippingCostCents, estimatedDays };
}

export async function createOrder(
  apiKey: string,
  req: ProdigiCreateOrderRequest,
  sandbox = false,
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
      shippingMethod: 'Budget',
      recipient: {
        name: req.shippingAddress.name,
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
