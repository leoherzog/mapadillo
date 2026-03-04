/**
 * Save indicator — shows saving/saved/error status inline.
 *
 * Automatically hides after 3 seconds when status is 'saved'.
 */
import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('save-indicator')
export class SaveIndicator extends LitElement {
  @property({ reflect: true }) status: 'idle' | 'saving' | 'saved' | 'error' = 'idle';

  private _fadeTimer?: ReturnType<typeof setTimeout>;

  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.8rem;
    }

    :host([status='idle']) {
      display: none;
    }

    .saving {
      color: var(--wa-color-neutral-500);
    }

    .saved {
      color: var(--wa-color-success-600, #16a34a);
    }

    .error {
      color: var(--wa-color-danger-600, #dc2626);
    }
  `;

  updated(changed: Map<string, unknown>) {
    if (changed.has('status')) {
      clearTimeout(this._fadeTimer);
      if (this.status === 'saved') {
        this._fadeTimer = setTimeout(() => {
          this.dispatchEvent(new CustomEvent('status-idle', { bubbles: true, composed: true }));
        }, 3000);
      }
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this._fadeTimer);
  }

  render() {
    switch (this.status) {
      case 'saving':
        return html`<span class="saving"><wa-spinner style="font-size: 0.8rem;"></wa-spinner> Saving...</span>`;
      case 'saved':
        return html`<span class="saved"><wa-icon name="check"></wa-icon> Saved</span>`;
      case 'error':
        return html`<span class="error"><wa-icon name="circle-xmark"></wa-icon> Save failed</span>`;
      default:
        return nothing;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'save-indicator': SaveIndicator;
  }
}
