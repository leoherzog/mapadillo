import { css } from 'lit';

/**
 * Shared page layout styles for sidebar + map-panel pages.
 *
 * Desktop: uses `<wa-split-panel>` for a resizable sidebar + map layout.
 * Mobile: hides the split panel; trip-builder uses a drawer instead.
 */
/** Reusable .family-name subtitle style (quiet, small text). */
export const familyNameStyles = css`
  .family-name {
    font-size: var(--wa-font-size-s);
    color: var(--wa-color-text-quiet);
    margin: 0;
  }
`;

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
    overflow-y: auto;
    background: var(--wa-color-surface-default);
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

  .stat-row wa-icon {
    color: var(--wa-color-brand-60);
    font-size: var(--wa-font-size-m);
  }

  .stat-value {
    font-weight: var(--wa-font-weight-bold);
    color: var(--wa-color-text-normal);
  }

  .stat-label {
    color: var(--wa-color-text-quiet);
  }

  .loading-center {
    display: flex;
    justify-content: center;
    padding: var(--wa-space-2xl);
  }

  /* Responsive: hide split panel on narrow viewports */
  @media (max-width: 700px) {
    wa-split-panel {
      display: none;
    }

    .map-panel {
      flex: 1;
      min-height: 300px;
    }
  }
`;
