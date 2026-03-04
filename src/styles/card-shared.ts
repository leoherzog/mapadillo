import { css } from 'lit';

export const cardSharedStyles = css`
  .drag-handle {
    cursor: grab;
    color: var(--wa-color-neutral-400);
    flex-shrink: 0;
    touch-action: none;
  }

  .delete-btn::part(base) {
    color: var(--wa-color-neutral-400);
  }

  .delete-btn::part(base):hover {
    color: var(--wa-color-danger-50);
  }
`;
