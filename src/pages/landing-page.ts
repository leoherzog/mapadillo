import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';
import { navClick } from '../nav.js';

@customElement('landing-page')
export class LandingPage extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      flex: 1;
      padding: var(--wa-space-xl) var(--wa-space-m);
      text-align: center;
      gap: var(--wa-space-l);
    }

    .hero-icon {
      font-size: 5rem;
      line-height: 1;
    }

    h1 {
      font-size: clamp(2rem, 6vw, 3.5rem);
      font-weight: 900;
      margin: 0;
      color: var(--wa-color-brand-600, #e05e00);
      line-height: 1.15;
    }

    .tagline {
      font-size: clamp(1rem, 3vw, 1.35rem);
      color: var(--wa-color-neutral-600);
      max-width: 36ch;
      margin: 0 auto;
    }

    .cta-group {
      display: flex;
      gap: var(--wa-space-m);
      flex-wrap: wrap;
      justify-content: center;
    }

    .features {
      display: flex;
      gap: var(--wa-space-l);
      flex-wrap: wrap;
      justify-content: center;
      margin-top: var(--wa-space-xl);
      max-width: 800px;
    }

    .feature-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--wa-space-s);
      flex: 1 1 140px;
      max-width: 200px;
      text-align: center;
    }

    .feature-icon {
      font-size: 2.25rem;
    }

    .feature-label {
      font-size: 0.95rem;
      font-weight: 700;
      color: var(--wa-color-neutral-700);
    }

    .hero-icon wa-icon {
      color: var(--wa-color-brand-600, #e05e00);
    }
  `;

  render() {
    return html`
      <div class="hero-icon">
        <wa-icon name="map" family="jelly-duo" label=""></wa-icon>
      </div>

      <h1>Map Your Next<br />Adventure!</h1>

      <p class="tagline">
        Add stops, draw the route, and create a paper map
        the whole family will love.
      </p>

      <div class="cta-group">
        <wa-button
          size="large"
          variant="brand"
          href="/sign-in"
          @click=${navClick('/sign-in')}
        >
          <wa-icon slot="start" name="paper-plane"></wa-icon>
          Start Planning
        </wa-button>
      </div>

      <div class="features">
        ${[
          { icon: 'location-dot', label: 'Add Stops' },
          { icon: 'compass', label: 'Draw the Route' },
          { icon: 'star', label: 'Customize Icons' },
          { icon: 'print', label: 'Print or Order' },
        ].map(
          ({ icon, label }) => html`
            <div class="feature-card">
              <span class="feature-icon">
                <wa-icon name=${icon} label=""></wa-icon>
              </span>
              <span class="feature-label">${label}</span>
            </div>
          `
        )}
      </div>
    `;
  }

}

declare global {
  interface HTMLElementTagNameMap {
    'landing-page': LandingPage;
  }
}
