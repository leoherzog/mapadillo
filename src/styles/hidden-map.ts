/**
 * Shared styles for off-screen map containers used in export/order rendering.
 * The map needs specific dimensions for rendering but must be invisible.
 */
import { css, unsafeCSS, type CSSResult } from 'lit';

export function hiddenMapStyles(width = '1400px', height = '900px'): CSSResult {
  return css`
    .hidden-map {
      position: fixed;
      left: -99999px;
      top: -99999px;
      width: ${unsafeCSS(width)};
      height: ${unsafeCSS(height)};
      visibility: hidden;
    }
  `;
}
