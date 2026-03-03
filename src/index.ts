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
// The loader registers all WA components and wires up the FA Pro icon kit.
// setKitCode tells WA to load icons from the npm kit package instead of the CDN.
import {
  setKitCode,
  setDefaultIconFamily,
} from '@awesome.me/webawesome-pro/dist/webawesome.loader.js';

// Kit code comes from the package @awesome.me/kit-781a3c6be3
setKitCode('781a3c6be3');

// Default icon family: Jelly — the playful, rounded icon style
setDefaultIconFamily('jelly');

// ── App Shell ──────────────────────────────────────────────────────────────
// Importing the app-shell module registers the <app-shell> custom element.
// The element is already in index.html, so it upgrades as soon as the
// module registers.
import './components/app-shell.js';
