import { css } from 'lit';

/**
 * Shared page layout styles for sidebar + map-panel pages.
 *
 * Use `.sidebar-left` or `.sidebar-right` on the sidebar element
 * to control which side gets the border.
 */
export const pageLayoutStyles = css`
  :host {
    display: flex;
    height: calc(100dvh - var(--header-height, 0px));
    min-height: 0;
    overflow: hidden;
  }

  .sidebar {
    width: 380px;
    min-width: 300px;
    flex-shrink: 0;
    padding: var(--wa-space-l);
    overflow-y: auto;
    background: var(--wa-color-surface-default);
  }

  .sidebar-left {
    border-right: var(--wa-border-width-s) solid var(--wa-color-surface-border);
  }

  .sidebar-right {
    border-left: var(--wa-border-width-s) solid var(--wa-color-surface-border);
  }

  .map-panel {
    flex: 1;
    min-width: 0;
    position: relative;
  }

  h1 {
    font-size: var(--wa-font-size-xl);
    font-weight: var(--wa-font-weight-bold);
    margin: 0;
    color: var(--wa-color-brand-60);
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

  /* Responsive: stack on narrow viewports */
  @media (max-width: 700px) {
    :host {
      flex-direction: column;
    }

    .sidebar {
      width: auto;
      min-width: 0;
      border-right: none;
      border-left: none;
      border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      max-height: 45vh;
    }

    .map-panel {
      min-height: 300px;
    }
  }
`;
