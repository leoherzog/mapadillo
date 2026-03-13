/**
 * Stripe client initialization for Cloudflare Workers.
 * Uses SubtleCrypto provider for WebCrypto compatibility.
 */
import Stripe from 'stripe';

export function getStripe(secretKey: string): Stripe {
  return new Stripe(secretKey, {
    httpClient: Stripe.createFetchHttpClient(),
  });
}
