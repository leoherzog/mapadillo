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
    border-right: 1px solid var(--wa-color-neutral-200);
  }

  .sidebar-right {
    border-left: 1px solid var(--wa-color-neutral-200);
  }

  .map-panel {
    flex: 1;
    min-width: 0;
    position: relative;
  }

  h1 {
    font-size: var(--wa-font-size-xl);
    font-weight: 900;
    margin: 0;
    color: var(--wa-color-brand-60, #e05e00);
  }

  h1 wa-icon {
    font-size: 1.3rem;
  }

  .stat-row {
    font-size: 0.9rem;
  }

  .stat-row wa-icon {
    color: var(--wa-color-brand-60, #e05e00);
    font-size: 1rem;
  }

  .stat-value {
    font-weight: 700;
    color: var(--wa-color-neutral-900);
  }

  .stat-label {
    color: var(--wa-color-neutral-500);
  }

  /* Responsive: stack on narrow viewports */
  @media (max-width: 700px) {
    :host {
      flex-direction: column;
    }

    .sidebar {
      width: 100%;
      min-width: 0;
      border-right: none;
      border-left: none;
      border-bottom: 1px solid var(--wa-color-neutral-200);
      max-height: 40vh;
    }

    .map-panel {
      min-height: 300px;
    }
  }
`;
