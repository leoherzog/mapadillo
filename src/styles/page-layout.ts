/**
 * Page-level styles: the trip builder's sidebar + map-panel layout and the
 * `.family-name` subtitle used by the export and preview pages.
 */

import { css } from 'lit';

/** Reusable .family-name subtitle style (quiet, small text). */
export const familyNameStyles = css`
  .family-name {
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
    margin: 0;
  }
`;

/**
 * Trip builder layout. Desktop uses `<wa-split-panel>` for a resizable
 * sidebar + map; mobile hides the split panel in favour of a drawer.
 */
export const pageLayoutStyles = css`
  :host {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  wa-split-panel {
    flex: 1;
    min-height: 0;
    --min: 300px;
    --max: 50%;
  }

  .sidebar {
    height: 100%;
    padding: var(--wa-space-l);
    display: flex;
    flex-direction: column;
    gap: var(--wa-space-m);
    overflow-y: hidden;
    background: var(--wa-color-surface-default);
  }

  .sidebar-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .map-panel {
    height: 100%;
    position: relative;
  }

  h1 {
    font-size: var(--wa-font-size-xl);
  }

  h1 wa-icon {
    font-size: var(--wa-font-size-l);
  }

  .stat-row {
    font-size: var(--wa-font-size-s);
  }

  .stat-value {
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
  }

  .stat-label {
    color: var(--wa-color-text-quiet);
  }

  .loading-center {
    padding: var(--wa-space-2xl);
  }

  /* Responsive: collapse sidebar, keep map visible */
  @media (max-width: 700px) {
    /* Block layout drops the split panel's inline grid template, which would put the map in a 0-width column. */
    wa-split-panel {
      display: block;
    }

    wa-split-panel::part(start) {
      display: none;
    }

    wa-split-panel::part(divider) {
      display: none;
    }

    .map-panel {
      min-height: 300px;
    }
  }
`;
