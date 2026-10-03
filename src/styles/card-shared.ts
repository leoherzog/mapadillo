import { css } from 'lit';

export const cardSharedStyles = css`
  wa-card {
    --spacing: var(--wa-space-s);
  }

  .drag-handle {
    cursor: grab;
    color: var(--wa-color-text-quiet);
    flex-shrink: 0;
    touch-action: none;
  }

  .delete-btn::part(button) {
    color: var(--wa-color-text-quiet);
  }

  .delete-btn::part(button):hover {
    color: var(--wa-color-danger-50);
  }

  .change-btn {
    font-size: var(--wa-font-size-xs);
    cursor: pointer;
    color: var(--wa-color-text-quiet);
  }

  .change-btn:hover {
    color: var(--wa-color-brand-50);
  }

  .name-input {
    flex: 1;
    min-width: 0;
  }

  icon-picker {
    --wa-font-size-l: var(--wa-font-size-m);
  }
`;
