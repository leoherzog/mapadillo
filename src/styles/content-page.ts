/**
 * Shared host styles for centered content pages (non-map pages).
 * Provides responsive padding and max-width with auto margins.
 */
import { css, unsafeCSS, type CSSResult } from 'lit';

export function contentPageStyles(maxWidth = '1000px'): CSSResult {
  return css`
    :host {
      display: block;
      padding: var(--wa-space-xl) var(--wa-space-m);
      max-width: ${unsafeCSS(maxWidth)};
      margin: 0 auto;
      overflow-y: auto;
    }

    @media (max-width: 700px) {
      :host {
        padding: var(--wa-space-m) var(--wa-space-s);
      }
    }
  `;
}
