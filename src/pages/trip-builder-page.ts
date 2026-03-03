/**
 * Trip builder page — M1 stub.
 * Full implementation in Milestones 3–5.
 */
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('trip-builder-page')
export class TripBuilderPage extends LitElement {
  @property() mapId: string = '';

  static styles = css`
    :host {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 1;
      padding: var(--wa-space-xl);
    }

    .stub {
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--wa-space-m);
    }

    h1 {
      font-size: 1.75rem;
      font-weight: 900;
      margin: 0;
      color: var(--wa-color-brand-600, #e05e00);
    }
  `;

  render() {
    return html`
      <div class="stub">
        <wa-icon
          name="compass"
          family="jelly"
          style="font-size: 4rem; color: var(--wa-color-brand-500, #ff6b00);"
        ></wa-icon>
        <h1>Trip Builder</h1>
        <p style="color: var(--wa-color-neutral-600);">
          Map ID: <code>${this.mapId || 'new'}</code>
        </p>
        <wa-callout variant="warning">
          <wa-icon slot="icon" name="triangle-exclamation"></wa-icon>
          Full trip builder coming in Milestones 3–5!
        </wa-callout>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'trip-builder-page': TripBuilderPage;
  }
}
