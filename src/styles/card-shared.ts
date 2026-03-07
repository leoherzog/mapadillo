import { css } from 'lit';

export const cardSharedStyles = css`
  wa-card {
    --spacing: var(--wa-space-xs) var(--wa-space-s);
  }

  .drag-handle {
    cursor: grab;
    color: var(--wa-color-text-quiet);
    flex-shrink: 0;
    touch-action: none;
  }

  .delete-btn::part(base) {
    color: var(--wa-color-text-quiet);
  }

  .delete-btn::part(base):hover {
    color: var(--wa-color-danger-50);
  }

  .change-btn {
    font-size: var(--wa-font-size-xs);
  }
`;
