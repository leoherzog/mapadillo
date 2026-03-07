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
      gap: var(--wa-space-2xs);
      font-size: var(--wa-font-size-s);
    }

    :host([status='idle']) {
      display: none;
    }

    wa-spinner {
      font-size: var(--wa-font-size-s);
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
        return html`<wa-badge variant="neutral"><wa-spinner></wa-spinner> Saving...</wa-badge>`;
      case 'saved':
        return html`<wa-badge variant="success"><wa-icon name="check"></wa-icon> Saved</wa-badge>`;
      case 'error':
        return html`<wa-badge variant="danger"><wa-icon name="circle-xmark"></wa-icon> Save failed</wa-badge>`;
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
