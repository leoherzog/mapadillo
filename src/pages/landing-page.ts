import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';
import { navClick } from '../nav.js';
import { isAuthenticated } from '../auth/auth-state.js';
import { waUtilities } from '../styles/wa-utilities.js';
import { headingStyles } from '../styles/heading-shared.js';

@customElement('landing-page')
export class LandingPage extends LitElement {
  static styles = [waUtilities, headingStyles, css`
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
      font-size: var(--wa-font-size-4xl);
      line-height: 1;
    }

    h1 {
      font-size: clamp(2rem, 6vw, 3.5rem);
      line-height: 1.15;
    }

    .tagline {
      font-size: clamp(1rem, 3vw, 1.35rem);
      color: var(--wa-color-text-quiet);
      max-width: 36ch;
      margin: 0 auto;
    }

    .features {
      margin-top: var(--wa-space-xl);
      max-width: 800px;
    }

    .feature-card {
      flex: 1 1 140px;
      max-width: 200px;
      text-align: center;
    }

    .feature-icon {
      font-size: var(--wa-font-size-2xl);
    }

    .feature-label {
      font-size: var(--wa-font-size-m);
      font-weight: var(--wa-font-weight-bold);
      color: var(--wa-color-text-normal);
    }

    .hero-icon wa-icon {
      color: var(--wa-color-brand-60);
    }
  `];

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

      <div class="wa-cluster wa-gap-m wa-justify-content-center">
        <wa-button
          size="large"
          variant="brand"
          href=${isAuthenticated() ? '/dashboard' : '/sign-in'}
          @click=${navClick(isAuthenticated() ? '/dashboard' : '/sign-in')}
        >
          <wa-icon slot="start" name="paper-plane"></wa-icon>
          Start Planning
        </wa-button>
      </div>

      <div class="features wa-cluster wa-gap-l wa-justify-content-center">
        ${[
          { icon: 'location-dot', label: 'Add Stops' },
          { icon: 'compass', label: 'Draw the Route' },
          { icon: 'star', label: 'Customize Icons' },
          { icon: 'print', label: 'Print or Order' },
        ].map(
          ({ icon, label }) => html`
            <div class="feature-card wa-stack wa-gap-s wa-align-items-center">
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
