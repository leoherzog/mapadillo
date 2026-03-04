/**
 * App entry point
 *
 * 1. Load global styles (Web Awesome, Playful theme, app-wide CSS)
 * 2. Register Web Awesome components + Font Awesome Pro Jelly kit
 * 3. Mount the app shell (router + layout)
 */

// ── Styles ─────────────────────────────────────────────────────────────────
import './styles/global.css';
import './styles/theme.css';

// ── Web Awesome Pro + FA Kit ────────────────────────────────────────────────
// The loader's autoloader uses a MutationObserver on the document to
// auto-discover wa-* elements. But our Lit components render wa-* elements
// inside shadow DOM, which the observer can't see. We must explicitly import
// every WA component used in the app so they're registered with
// customElements.define() before our components render.
import {
  setKitCode,
  setDefaultIconFamily,
} from '@awesome.me/webawesome-pro/dist/webawesome.loader.js';

import '@awesome.me/webawesome-pro/dist/components/avatar/avatar.js';
import '@awesome.me/webawesome-pro/dist/components/button/button.js';
import '@awesome.me/webawesome-pro/dist/components/callout/callout.js';
import '@awesome.me/webawesome-pro/dist/components/card/card.js';
import '@awesome.me/webawesome-pro/dist/components/combobox/combobox.js';
import '@awesome.me/webawesome-pro/dist/components/divider/divider.js';
import '@awesome.me/webawesome-pro/dist/components/dropdown/dropdown.js';
import '@awesome.me/webawesome-pro/dist/components/dropdown-item/dropdown-item.js';
import '@awesome.me/webawesome-pro/dist/components/icon/icon.js';
import '@awesome.me/webawesome-pro/dist/components/input/input.js';
import '@awesome.me/webawesome-pro/dist/components/option/option.js';
import '@awesome.me/webawesome-pro/dist/components/page/page.js';
import '@awesome.me/webawesome-pro/dist/components/spinner/spinner.js';
import '@awesome.me/webawesome-pro/dist/components/dialog/dialog.js';
import '@awesome.me/webawesome-pro/dist/components/relative-time/relative-time.js';

// Kit code comes from the package @awesome.me/kit-781a3c6be3
setKitCode('781a3c6be3');

// Default icon family: Jelly — the playful, rounded icon style
setDefaultIconFamily('jelly');

// ── Auth ──────────────────────────────────────────────────────────────────
// Start session check immediately so the auth guard doesn't delay the
// first protected navigation. Non-blocking — components await via initAuth().
import { initAuth } from './auth/auth-state.js';
initAuth();

// ── App Shell ──────────────────────────────────────────────────────────────
// Importing the app-shell module registers the <app-shell> custom element.
// The element is already in index.html, so it upgrades as soon as the
// module registers.
import './components/app-shell.js';
