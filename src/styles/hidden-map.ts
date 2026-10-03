/**
 * Shared styles for the off-screen map container used in export and order rendering.
 * renderMapCanvas sizes the print frame from this container when no preview size was
 * saved, so every page that renders prints must share it.
 */
import { css } from 'lit';

export const hiddenMapStyles = css`
  .hidden-map {
    position: fixed;
    left: -99999px;
    top: -99999px;
    width: 1400px;
    height: 900px;
    visibility: hidden;
  }
`;
