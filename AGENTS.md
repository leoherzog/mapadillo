# AGENTS.md

This file provides guidance to Claude Code, Codex, Gemini, etc when working with code in this repository.

## Commands

### npm install / npm update

`.npmrc` authenticates against the private Web Awesome Pro registry using `WEBAWESOME_NPM_TOKEN`. The token lives in `.dev.vars`. Export it before running any install or update command:

```bash
export $(cat .dev.vars | xargs) && npm install
export $(cat .dev.vars | xargs) && npm update
```

### Frontend (root)
```bash
npm run dev          # Vite dev server (frontend only)
npm run build        # tsc -b + vite build → dist/
npm run preview      # Preview built dist/
npm run test:ui      # Frontend tests (vitest, node env)
npm test             # Worker typecheck + worker tests
npm run test:all     # Frontend tests, then worker typecheck + worker tests
```

### Worker (full-stack local dev)
```bash
npm run dev:full     # Build frontend + apply local migrations + start Worker dev server
cd worker && npm run dev           # Worker only (wrangler dev)
cd worker && npm run migrate:local # Apply D1 migrations locally
cd worker && npm run deploy        # Deploy to Cloudflare
cd worker && npm run types         # Regenerate wrangler types after provisioning
cd worker && npm run typecheck     # tsc --noEmit
cd worker && npm test              # Worker tests (@cloudflare/vitest-pool-workers)
cd worker && npm run test:watch    # Watch mode
cd worker && npm run test:coverage # Istanbul coverage report
```

### Resetting local D1

If `migrate:local` applies nothing but the local tables lack the CHECK constraints in `0001_initial.sql`, delete `worker/.wrangler/state/v3/d1` and rerun it. This clears local users, sessions and maps.

### Single test file
```bash
# Frontend
npx vitest run src/auth/auth-state.test.ts

# Worker
cd worker && npx vitest run src/routes/maps.test.ts
```

## Architecture

**Mapadillo** is a family road trip map app. Users build trips from geocoded stops, preview them on a MapLibre map, export to PDF/image, and optionally order a printed poster via Prodigi (paid via Stripe).

### Two separate packages

| | Root (`/`) | Worker (`/worker`) |
|--|--|--|
| Runtime | Browser | Cloudflare Workers (workerd) |
| Framework | Vite + Lit + TypeScript | Hono + TypeScript |
| Tests | vitest (node) | @cloudflare/vitest-pool-workers |
| Build output | `dist/` | bundled by wrangler |

The Worker serves **both** the API (`/api/*`) and the Vite-built SPA static assets. `wrangler.toml` uses `run_worker_first = ["/api/*"]` — non-API paths are served directly from `dist/` with SPA fallback to `index.html`.

### Shared code: `shared/`

Imported by the frontend (`tsconfig.json` includes `"shared"`) and by the worker through relative imports. `shared/` is the source of truth for anything both sides validate.

- `types.ts` — `MapData`, `Stop` (`PointStop | RouteStop`), `StopRow` + `rowToStop()`, `ShareData`, `ShareRow`, `MapRole` + `canEditRole()`, `SessionUser`, `ExportSettings` + `parseExportSettings()`, `ShippingAddress` + `parseShippingAddress()`, `CheckoutBody`, `PrintQuoteBody`, `Order`, `OrderStatus`
- `paper.ts` — `PaperSize` and `Orientation` unions used by export settings and print products
- `travel-modes.ts` — `TRAVEL_MODES` (icon, colors, ORS profile) and `isTravelMode()`
- `units.ts` — `Units` and `VALID_UNITS`
- `icons.ts` — `VALID_ICONS` and `DEFAULT_ICON`
- `products.ts` — `PRODUCTS` catalog, `PRINTABLE_SIZES`, `STATUS_VARIANTS`, `ORDER_STATUSES`

### Frontend: `src/`

- **Entry:** `src/index.ts` registers Web Awesome components, sets the Font Awesome kit, initializes dark mode, units and auth, and mounts `<app-shell>`
- **Router:** `src/router.ts` — DIY Lit reactive controller using `URLPattern` + Navigation API, with a `popstate` fallback. Routes are `{ path, render, enter?, fullHeight? }` objects. `enter()` returns a redirect path string or `void`. `fullHeight` makes the page fill the viewport and hides the shell footer; `router.current` is the rendered definition and `router.target` the one being entered, set before its guard runs.
- **Route table:** declared in `src/components/app-shell.ts`. Guarded with `requireAuth`: `/dashboard`, `/map/new`, `/claim/:token`, `/order/:id`, `/order-confirmation/:orderId`, `/admin`. Unguarded: `/`, `/sign-in`, `/map/:id` (public maps), `/preview/:id`, `/export/:id` (redirects to sign-in on download). The admin page additionally authenticates its API calls with the admin secret.
- **Navigation:** `src/nav.ts` — `navigateTo(path, { replace? })` and `signInUrl(returnTo?)`. Links use plain `href`; the router intercepts them through the Navigation API.
- **Auth state:** `src/auth/auth-state.ts` — module-level singleton. Call `initAuth()` on load; `onAuthChange(fn)` to subscribe; `refreshAuth()` after passkey sign-in. `src/auth/auth-controller.ts` exposes `AuthController`, which re-renders a Lit host on auth changes.
- **Auth client:** `src/auth/auth-client.ts` — `createAuthClient()` from `better-auth/client`. Methods: `signIn.social({ provider })`, `signIn.passkey()`, `signUp.email()`, `signOut()`, `getSession()`
- **Auth guard:** `src/auth/auth-guard.ts` — `requireAuth`, used as `enter()`; redirects to `signInUrl()`
- **Preferences:** `src/units.ts` (distance units: locale default, localStorage, server sync via `/api/user/preferences` while signed in) and `src/dark-mode.ts` (explicit choice or `prefers-color-scheme`, applies `wa-dark`). Both are built on `createPreference()` in `src/utils/preference.ts`; components subscribe with `StoreController` from `src/utils/store-controller.ts`.
- **Services:** `src/services/` — `api-client.ts` base fetch wrapper (same-origin, `ApiError`); `maps.ts` typed map, stop and sharing wrappers; `orders.ts` image upload, checkout, quote and order wrappers; `geocoding.ts` → `/api/geocode` (returns `[]` on failure); `routing.ts` → `/api/route` for drive/walk/bike, client-side geometry for plane/boat, straight-line fallback on failure
- **Map:** `src/map/map-controller.ts` (`MapController` draws items as GeoJSON layers; `renderMarkerCanvas()`, `settle()`); `src/map/map-export.ts` (`renderMapCanvas()` renders an offscreen MapLibre map at 300 DPI, capped to 80% of the GPU max texture size or 4096px; PNG/JPEG/PDF downloads via `canvas.toBlob` and jsPDF; `renderToBlob()` for print orders); `src/map/mockup-renderer.ts` (poster mockup on the export page); `src/map/styles/kid-drawn.ts` (transforms the OpenFreeMap Bright style)
- **Config:** `src/config/map.ts` (`MAP_STYLE_URL`, `resolveMapStyle()` returns the cached kid-drawn style); `src/config/travel-modes.ts` re-exports `TRAVEL_MODES` from `shared/` plus color lookup tables
- **Components:** `src/components/` — `app-shell`, `map-view`, `map-card`, `item-list`, `point-card`, `route-card`, `endpoint-editor.ts` (shared endpoint template for both cards), `location-search`, `icon-picker`, `travel-mode-picker`, `share-dialog`, `user-menu`; `ui.ts` has template helpers `errorCallout()`, `roleBadge()`, `orderStatusBadge()`
- **Styles:** `src/styles/` — `theme.css`, `global.css`, `card-shared.ts` (point-card + route-card), `page-layout.ts` (trip builder `wa-split-panel` on desktop, `wa-drawer` on mobile, plus `familyNameStyles`), `content-page.ts` (centered non-map pages), `heading-shared.ts`, `hidden-map.ts` (off-screen render containers), `wa-utilities.ts` (Web Awesome utility classes)
- **Utils:** `src/utils/` — `geo.ts` (`isDraftCoord()`, `formatDistance()`, `haversineDistance()`, `sanitizeFilename()`), `countries.ts` (shipping countries), `existing-locations.ts` (autocomplete suggestions from a map's stops), `form.ts` (`fieldValue()`, `fieldChecked()` for Web Awesome form events), `preference.ts`, `store-controller.ts`
- **Pages:** `landing-page.ts`, `sign-in-page.ts`, `dashboard-page.ts`, `claim-page.ts`, `admin-page.ts`, `order-confirmation-page.ts`, and `map-page-base.ts`, the base class for `trip-builder-page.ts`, `map-preview-page.ts`, `export-page.ts` and `order-page.ts`

### Worker: `worker/src/`

- **Entry:** `worker/src/index.ts` — Hono app: auth wiring, CSRF check, rate limits and route mounting
- **Auth:** Better Auth instance in `worker/src/auth.ts` (`database: env.DB`), mounted at `/api/auth/*`
- **Middleware:** `worker/src/middleware/auth.ts` (`authMiddleware(required)` factory exporting `requireAuth` and `optionalAuth`, attaches `c.get('user')`); `worker/src/middleware/rate-limit.ts` (`rateLimit(binding, keyFn)`, answers 429)
- **Routes:** `maps.ts` (map + stop CRUD; `getMapWithRole()`, `requireMapRole(c, minRole, { param, hideForbidden })`, `insertStopStmt()`), `sharing.ts` (shares, visibility, duplicate, `claimShareHandler`), `user-preferences.ts` (per-account units), `orders.ts` (R2 image upload + serving, Stripe Checkout, Prodigi quote, user + admin order routes), `webhooks.ts` (Stripe + Prodigi), `geocode.ts` (Photon proxy), `route.ts` (ORS proxy)
- **Lib:** `worker/src/lib/` — `hash.ts` (`sha256Hex()`, constant-time `secretsEqual()`), `cached-proxy.ts` (`proxyWithCache()`: KV-cached upstream JSON fetch used by geocode and route), `json-body.ts` (`readJsonBody()`), `orders.ts` (`submitOrderToProdigi()`), `stripe.ts` (Stripe SDK init), `prodigi.ts` (Prodigi API client), `discord.ts` (order notifications)
- **Handler convention:** `requireMapRole()` and `readJsonBody()` set `c.res` to the error response and return `null`; callers `return c.res`
- **Types:** `worker/src/types.ts` defines `Env` (all bindings) and `AppEnv` (Hono generic). D1 row types live in `shared/types.ts`
- **Migrations:** `worker/src/db/migrations/0001_initial.sql` holds the full schema
- **Tests:** `worker/src/test-helpers.ts` — `applyTestSchema()` applies the real migrations (passed in as the `TEST_MIGRATIONS` binding by `vitest.config.ts`), plus `request()`, `createTestSession()`, `jsonRequest()`, `createMap()`, `createStop()`, `grantShare()`

### Cloudflare bindings (`worker/wrangler.toml`)

| Binding | Type | Purpose |
|--|--|--|
| `DB` | D1 | Main relational DB (`roadtrip-db`) |
| `API_CACHE` | KV | Geocoding + routing cache (7d TTL) |
| `ROADTRIP_PRINTS` | R2 | Print-ready images (`roadtrip-prints`) |
| `RATE_LIMITER_PUBLIC` | Rate limit | 60/min per key: public map GET per IP, invite claim per user, invite creation per user |
| `RATE_LIMITER_PROXY` | Rate limit | 30/min per user (geocode + route) |
| `RATE_LIMITER_AUTH` | Rate limit | 10/min per IP (auth routes) |

Secrets set via `wrangler secret put`: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID/SECRET`, `FACEBOOK_CLIENT_ID/SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PRODIGI_API_KEY`, `PRODIGI_SANDBOX` (`"true"` selects the sandbox API), `PRODIGI_WEBHOOK_SECRET` (checked against the `X-Prodigi-Webhook-Secret` header), `ORS_API_KEY`, `ADMIN_SECRET` (Bearer token for `/api/admin/*`), `DISCORD_WEBHOOK_URL` (optional).

### Data model

Two item types stored in the `stops` table:
- **`point`** — standalone map marker (name, lat/lng, icon, label). `travel_mode` is always NULL; the API rejects one.
- **`route`** — A→B segment (start lat/lng/name/icon + `dest_*` fields + `dest_icon` + `travel_mode` + `route_geometry` for cached GeoJSON)

Each endpoint (point or route start/dest) has an icon from the curated Jelly set. The special icon value `'none'` hides the marker and label on the map entirely. When an icon changes, it propagates to all other items sharing the exact same coordinates.

Five travel modes: `drive`, `walk`, `bike`, `plane`, `boat`. New routes default to `drive`. Plane = great-circle arc (client-computed, no ORS call). Boat = straight line. Enum-style columns (`travel_mode`, `type`, `visibility`, `role`, `status`, `units`) carry CHECK constraints in the schema.

`export_settings` (JSON TEXT on `maps` table) persists export preferences and map viewport per map: `{ format, paperSize, orientation, center, zoom, bearing, pitch }`. The preview page saves it with a 1s debounce, only for owners/editors, and restores the viewport after the `drawItems` auto-fit. Per-user preferences (distance units) live on the `user` row under `/api/user/preferences`.

### FK enforcement policy

D1 (Cloudflare's SQLite) does not reliably honour `PRAGMA foreign_keys = ON` on a per-connection basis, so the `ON DELETE CASCADE` / `ON DELETE RESTRICT` clauses in the schema are **advisory only** — they document intent, but are not enforced by the engine. Deletions must therefore be cascaded / restricted explicitly in the application layer.

Current enforcement points:

- `DELETE /api/maps/:id` (`worker/src/routes/maps.ts`) — RESTRICTs on `orders.map_id` (returns 409 if any order references the map) and CASCADEs to `stops` + `map_shares` in a single `DB.batch` with the map row itself.
- User deletion is not exposed by the app. Better Auth's account-deletion flow, if enabled, would need matching cascade logic to clear `maps`, `map_shares.user_id`, `passkey`, etc.

When adding new tables that reference `maps(id)` or `"user"(id)`, either extend the `DELETE /api/maps/:id` batch (CASCADE) or add a pre-check that returns a 4xx (RESTRICT). The schema clauses stay in place so that any future D1 engine that enforces them would behave consistently.

### CSRF protection

All non-GET state-changing API requests (except `/api/webhooks/*`) are validated against `Origin`/`Referer` headers matching `BETTER_AUTH_URL`. This is implemented as a middleware in `worker/src/index.ts`.

### UI components

Web Awesome Pro (`@web.awesome.me/webawesome-pro`) v3.x web components. Font Awesome Pro Jelly icons load from the Font Awesome CDN using the kit id passed to `setKitCode` in `src/index.ts`. Use `<wa-*>` components and `<wa-icon name="...">` throughout. Every `wa-*` component used must be imported in `src/index.ts`, because the autoloader cannot see into shadow DOM. `useDefineForClassFields: false` is required in tsconfig for Lit decorators.

#### Web Awesome event conventions

- **Custom events** are prefixed `wa-` (e.g., `wa-show`, `wa-hide`, `wa-clear`). **Standard DOM events** use native names (`input`, `change`, `focus`, `blur`).
- Components call `this.dispatchEvent()` directly — no `emit()` helper.

**Popup/panel lifecycle** (wa-combobox, wa-select, wa-dialog, wa-details, wa-dropdown, wa-tooltip): `wa-show` (cancelable) → `wa-after-show` → `wa-hide` (cancelable) → `wa-after-hide`. `wa-dialog` and `wa-dropdown` include `event.detail.source` on hide.

**Form inputs** (wa-input, wa-combobox, wa-select, wa-switch, wa-radio-group): emit `input` + `change` on value commit, `wa-clear` on clear button, `wa-invalid` on validation failure, `focus`/`blur` on focus changes. Read values with `fieldValue(e)` / `fieldChecked(e)` from `src/utils/form.ts`.

**wa-combobox `input` caveat:** The component may `stopPropagation()` on native typing events. To listen for typing, use a capture-phase listener: `addEventListener('input', ..., true)`.

**wa-dropdown:** also emits `wa-select` with `event.detail.item` referencing the selected `<wa-dropdown-item>`.

**Utility components:** `wa-copy-button` (one-click clipboard copy, replaces manual `navigator.clipboard` logic), `wa-toast`/`wa-toast-item` (transient notifications via `toast.create()`), `wa-split-panel` (resizable panel layout with drag handle).

**Minimal-event components:** wa-badge, wa-callout, wa-card, wa-copy-button, wa-divider, wa-dropdown-item, wa-option, wa-page, wa-radio, wa-relative-time, wa-spinner, wa-split-panel, wa-toast emit no custom events. wa-icon emits `wa-load`/`wa-error`. wa-button emits `wa-invalid`.

### Passkeys / WebAuthn

Passkeys don't work on plain `localhost`. Use `wrangler dev` with a tunnel (`cloudflared tunnel`) or HTTPS during passkey development. `BETTER_AUTH_URL` must be the canonical HTTPS domain.
