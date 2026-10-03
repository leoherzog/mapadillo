/**
 * Product catalog for print ordering.
 */

import type { PaperSize } from './paper.js';
import type { OrderStatus } from './types.js';

export interface ProductSize {
  label: string;
  size: PaperSize;
  priceCents: number;
  shippingPlaceholderCents: number;
}

export interface Product {
  sku: string;
  name: string;
  description: string;
  sizes: readonly ProductSize[];
}

export const PRODUCTS = [
  {
    sku: 'GLOBAL-BLP',
    name: 'Budget Poster',
    description: 'Affordable matte poster print, perfect for framing.',
    sizes: [
      { label: '18" × 24"', size: '18x24', priceCents: 2999, shippingPlaceholderCents: 999 },
      { label: '24" × 36"', size: '24x36', priceCents: 3999, shippingPlaceholderCents: 999 },
      { label: '40" × 60"', size: '40x60', priceCents: 4999, shippingPlaceholderCents: 999 },
    ],
  },
  {
    sku: 'ECO-ROL',
    name: 'Eco Rolled Canvas',
    description: 'Museum-quality canvas print, rolled and shipped in a tube.',
    sizes: [
      { label: '18" × 24"', size: '18x24', priceCents: 3999, shippingPlaceholderCents: 999 },
      { label: '24" × 36"', size: '24x36', priceCents: 4999, shippingPlaceholderCents: 999 },
      { label: '40" × 60"', size: '40x60', priceCents: 5999, shippingPlaceholderCents: 999 },
    ],
  },
] as const satisfies readonly Product[];

/** Paper sizes offered by at least one product. */
export type PrintablePaperSize = (typeof PRODUCTS)[number]['sizes'][number]['size'];

export const PRINTABLE_SIZES: ReadonlySet<string> = new Set<string>(
  PRODUCTS.flatMap((p) => p.sizes.map((s) => s.size)),
);

export function getProductBySku(sku: string): Product | undefined {
  return PRODUCTS.find((p) => p.sku === sku);
}

export function getProductSize(sku: string, size: string): ProductSize | undefined {
  return getProductBySku(sku)?.sizes.find((s) => s.size === size);
}

export function buildFullSku(productSku: string, size: string): string {
  return `${productSku}-${size.toUpperCase()}`;
}

/**
 * Narrow a product size string to the PaperSize used by the export pipeline.
 * @throws when no product offers the size.
 */
export function skuToPaperSize(size: string): PrintablePaperSize {
  if (PRINTABLE_SIZES.has(size)) return size as PrintablePaperSize;
  throw new Error(`Unknown printable size: ${size}`);
}

/** Maps order status strings to wa-badge variant names. */
export const STATUS_VARIANTS: Record<OrderStatus, string> = {
  pending_payment: 'warning',
  paid: 'warning',
  pending_render: 'warning',
  submitted: 'brand',
  in_production: 'brand',
  shipped: 'success',
  completed: 'success',
  cancelled: 'danger',
  failed: 'danger',
};

/** Every order status, in lifecycle order. */
export const ORDER_STATUSES = Object.keys(STATUS_VARIANTS) as OrderStatus[];
