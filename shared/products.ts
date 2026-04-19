/**
 * Product catalog for print ordering (M9).
 */

export interface ProductSize {
  label: string;
  size: string;
  priceCents: number;
  shippingPlaceholderCents: number;
}

export interface Product {
  sku: string;
  name: string;
  description: string;
  sizes: ProductSize[];
}

export const PRODUCTS: Product[] = [
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
];

export const PRINTABLE_SIZES = new Set(PRODUCTS.flatMap(p => p.sizes.map(s => s.size)));

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
 * Map a product "size" string to the PaperSize used by the export pipeline.
 * Poster sizes ('18x24', '24x36', '40x60') map directly to the same PaperSize
 * literal values in `src/map/map-export.ts`; this helper centralizes the
 * conversion (and the validation) so callers don't have to hand-cast.
 */
const _PRINTABLE_PAPER_SIZES = ['18x24', '24x36', '40x60'] as const;
export type PrintablePaperSize = typeof _PRINTABLE_PAPER_SIZES[number];

export function skuToPaperSize(size: string): PrintablePaperSize {
  if ((_PRINTABLE_PAPER_SIZES as readonly string[]).includes(size)) {
    return size as PrintablePaperSize;
  }
  throw new Error(`Unknown printable size: ${size}`);
}

import type { OrderStatus } from './types.js';

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
