/**
 * Sign-in page — M1 stub.
 * Full implementation in Milestone 2 (Better Auth, OAuth, Passkeys).
 */
import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';
import { navClick } from '../nav.js';

@customElement('sign-in-page')
export class SignInPage extends LitElement {
  static styles = css`
    :host {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 1;
      padding: var(--wa-space-xl) var(--wa-space-m);
    }

    wa-card {
      width: 100%;
      max-width: 420px;
      --spacing: var(--wa-space-xl);
    }

    wa-card::part(body) {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--wa-space-l);
      text-align: center;
    }

    h1 {
      font-size: 1.75rem;
      font-weight: 900;
      margin: 0;
      color: var(--wa-color-brand-600, #e05e00);
    }

    p {
      color: var(--wa-color-neutral-600);
      margin: 0;
    }

    wa-button {
      width: 100%;
    }
  `;

  render() {
    return html`
      <wa-card>
        <wa-icon
          name="map"
          family="jelly"
          style="font-size: 3rem; color: var(--wa-color-brand-500, #ff6b00);"
        ></wa-icon>

        <h1>Welcome Back!</h1>
        <p>Sign in to plan and share your family road trips.</p>

        <!-- Milestone 2: real auth buttons go here -->
        <wa-callout variant="neutral">
          <wa-icon slot="icon" name="circle-info" family="jelly"></wa-icon>
          Authentication coming in Milestone 2!
        </wa-callout>

        <wa-button variant="neutral" appearance="outlined" href="/" @click=${navClick('/')}>
          <wa-icon slot="start" name="arrow-left"></wa-icon>
          Back to Home
        </wa-button>
      </wa-card>
    `;
  }

}

declare global {
  interface HTMLElementTagNameMap {
    'sign-in-page': SignInPage;
  }
}
