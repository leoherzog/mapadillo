import { css } from 'lit';

export const cardSharedStyles = css`
  wa-card {
    --spacing: var(--wa-space-s);
  }

  .card-header {
    margin-bottom: var(--wa-space-3xs);
  }

  .item-title {
    flex: 1;
    min-width: 0;
    font-weight: var(--wa-font-weight-semibold);
    font-size: var(--wa-font-size-s);
  }

  .endpoint-icon {
    color: var(--wa-color-brand-60);
  }

  .endpoint-name {
    min-width: 0;
    font-weight: var(--wa-font-weight-semibold);
    font-size: var(--wa-font-size-s);
  }

  .drag-handle {
    flex-shrink: 0;
    touch-action: none;
  }

  .drag-handle::part(button) {
    cursor: grab;
    color: var(--wa-color-text-quiet);
  }

  .delete-btn::part(button) {
    color: var(--wa-color-text-quiet);
  }

  .delete-btn::part(button):hover {
    color: var(--wa-color-danger-50);
  }

  .change-btn::part(button) {
    font-size: var(--wa-font-size-xs);
    color: var(--wa-color-text-quiet);
  }

  .change-btn::part(button):hover {
    color: var(--wa-color-brand-50);
  }

  .name-input {
    flex: 1;
    min-width: 0;
  }
`;
