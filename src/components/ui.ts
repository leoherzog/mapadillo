/**
 * Small Lit template helpers for Web Awesome markup repeated across pages.
 * They render into the caller's shadow root, so they carry no styles of their own.
 */
import { html, type TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import { STATUS_VARIANTS, statusLabel } from '../../shared/products.js';
import type { OrderStatus } from '../../shared/types.js';

/** Danger callout with the standard error icon, announced to screen readers when it appears. */
export function errorCallout(msg: string): TemplateResult {
  return html`
    <wa-callout variant="danger" role="alert">
      <wa-icon slot="icon" name="circle-xmark"></wa-icon>
      ${msg}
    </wa-callout>
  `;
}

/**
 * Badge naming a map role; editors are highlighted.
 * @param slot Optional slot name for placement inside a parent component.
 */
export function roleBadge(role: string, slot?: string): TemplateResult {
  return html`<wa-badge slot=${ifDefined(slot)} variant=${role === 'editor' ? 'brand' : 'neutral'}>${role}</wa-badge>`;
}

/** Badge showing an order status with its lifecycle colour. */
export function orderStatusBadge(status: OrderStatus): TemplateResult {
  return html`<wa-badge variant=${STATUS_VARIANTS[status] ?? 'neutral'}>${statusLabel(status)}</wa-badge>`;
}
