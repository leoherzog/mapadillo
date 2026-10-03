/**
 * Stripe client for Workers. The SDK's workerd build defaults to the fetch HTTP client and SubtleCrypto,
 * and requests use the SDK's pinned API version, so create the Dashboard webhook endpoint with that version.
 */
import Stripe from 'stripe';

export function getStripe(secretKey: string): Stripe {
  return new Stripe(secretKey);
}
