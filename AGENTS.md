# AGENTS.md

This file provides guidance to Claude Code, Codex, Gemini, etc when working with code in this repository.

## Commands

### npm install / npm update

`.npmrc` authenticates against the private Web Awesome Pro registry using `WEBAWESOME_NPM_TOKEN`, which lives in the root `.dev.vars`. Export it before any install or update at the root; `worker/` needs no token:

```bash
export $(cat .dev.vars | xargs) && npm install
export $(cat .dev.vars | xargs) && npm update
```

### Frontend (root)
```bash
npm run dev          # Vite HMR server on :5173; proxies /api to wrangler dev on :8787, started separately
npm run build        # tsc -b + vite build → dist/
npm run preview      # Preview built dist/
npm run test:ui      # Frontend tests (vitest, node env; router and nav tests opt into happy-dom)
npm test             # Worker typecheck + worker tests
npm run test:all     # Frontend tests, then worker typecheck + worker tests
```

`npm run dev` is read-only against the API. The browser sends `Origin: http://localhost:5173`, which the worker's CSRF check and Better Auth both reject, so sign-in and every state-changing call fail there. Use `npm run dev:full` at `http://localhost:8787` for full flows. It serves the built `dist/`, so rerun it to pick up frontend changes.

### Worker (full-stack local dev)
```bash
npm run dev:full     # Build frontend + apply local migrations + start Worker dev server on :8787
cd worker && npm run dev           # Worker only (wrangler dev)
cd worker && npm run migrate:local # Apply D1 migrations locally
cd worker && npm run deploy        # Deploy to Cloudflare
cd worker && npm run types         # Regenerate worker-configuration.d.ts after changing wrangler.toml bindings or secret names in .dev.vars
cd worker && npm run typecheck     # tsc --noEmit
cd worker && npm test              # Worker tests (@cloudflare/vitest-pool-workers)
cd worker && npm run test:watch    # Watch mode
cd worker && npm run test:coverage # Istanbul coverage report
```

### Resetting local D1

Wrangler records each migration file as applied, so an edit to `0001_initial.sql` never reaches an existing local D1. After one, delete `worker/.wrangler/state/v3/d1` and rerun `migrate:local`. This clears local users, sessions and maps. The usual symptom is a `no such column` error or a missing CHECK constraint. Worker tests apply the migrations to their own D1 and need no reset.

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
| Tests | vitest (node; happy-dom per file) | @cloudflare/vitest-pool-workers |
| Build output | `dist/` | bundled by wrangler |

The Worker serves **both** the API (`/api/*`) and the Vite-built SPA static assets. `wrangler.toml` uses `run_worker_first = ["/api/*"]`, so non-API paths are served directly from `dist/` with SPA fallback to `index.html`.

### Shared code: `shared/`

Imported by the frontend (`tsconfig.json` includes `"shared"`) and by the worker through relative imports. `shared/` is the source of truth for anything both sides validate.

- `types.ts` — `MapData`, `Stop` (`PointStop | RouteStop`), `StopRow` + `rowToStop()`, `GEOMETRY_INVALIDATING_FIELDS`, `ShareData`, `ShareRow`, `ShareRole`, `Visibility`, `MapRole` + `canEditRole()`, `SessionUser`, `ExportSettings` + `parseExportSettings()`, `ShippingAddress` + `toShippingAddress()` + `parseShippingAddress()`, `CheckoutBody`, `PrintQuoteBody`, `Order`, `OrderStatus`
- `paper.ts` — `PaperSize` (from `PAPER_SIZE_VALUES`, guarded by `isPaperSize()`) and `Orientation`, used by export settings and print products
- `travel-modes.ts` — `TRAVEL_MODES` (icon, label, colors, ORS profile) and `isTravelMode()`
- `units.ts` — `Units`, `UNIT_NAMES` and `VALID_UNITS`
- `icons.ts` — `ICON_CATEGORIES` (the icon picker's grouping), `VALID_ICONS` and `DEFAULT_ICON`
- `limits.ts` — `MAX_NAME_LENGTH`, `MAX_LABEL_LENGTH`, `MAX_STOPS_PER_MAP` (worker validation and frontend `maxlength`)
- `products.ts` — `PRODUCTS` catalog, `getProductBySku()`, `getProductSize()`, `buildFullSku()`, `PRINTABLE_SIZES`, `STATUS_VARIANTS`, `ORDER_STATUSES`, `statusLabel()`, `orderRef()`. `ORDER_STATUSES` is in lifecycle order, and the Prodigi webhook never moves an order backwards along it.

### Frontend: `src/`

- **Entry:** `src/index.ts` registers Web Awesome components, sets the Font Awesome kit and Jelly icon family, initializes dark mode, units and auth, and imports `<app-shell>`
- **Router:** `src/router.ts` — DIY Lit reactive controller. Route paths such as `/map/:id` compile to anchored RegExps with one named group per param. Routes are `{ path, render, enter?, fullHeight?, title? }` objects. `enter()` returns a redirect path string, which replaces the history entry, or `void`. `fullHeight` makes the page fill the viewport and hides the shell footer; `title` sets the tab title to `<title> · Mapadillo`. `router.target` is the route being entered, set before its guard runs. With the Navigation API the router intercepts link clicks and Back/Forward. Without it, a `popstate` listener routes `navigateTo` and Back/Forward, and link clicks are full page loads served by the SPA fallback.
- **Route table:** declared in `src/components/app-shell.ts`. Guarded with `requireAuth`: `/dashboard`, `/map/new`, `/claim/:token`, `/order/:id`, `/order-confirmation/:orderId`, `/admin`. Unguarded: `/`, `/sign-in`, `/map/:id` (public maps), `/preview/:id`, `/export/:id` (redirects to sign-in on download). The admin page additionally authenticates its API calls with the admin secret. Only the landing, sign-in and claim pages are bundled with the shell; app-shell's `lazy(load, guard)` enter hook imports every other page on entry, after running the guard.
- **Navigation:** `src/nav.ts` — `navigateTo(path, { replace? })` and `signInUrl(returnTo?)`. `navigateTo` uses the Navigation API when present, otherwise `history.pushState`/`replaceState` plus a synthetic `popstate`. Links use plain `href`.
- **Auth state:** `src/auth/auth-state.ts` — module-level singleton. Call `initAuth()` on load; `onAuthChange(fn)` to subscribe; `refreshAuth()` after a passkey ceremony. `signOut()` clears local state and returns whether the server confirmed. `src/auth/auth-controller.ts` exposes `AuthController`, which re-renders a Lit host on auth changes.
- **Auth client:** `src/auth/auth-client.ts` — `createAuthClient()` from `better-auth/client` with `passkeyClient()`. Methods used: `signIn.social({ provider })`, `signIn.passkey()`, `passkey.addPasskey({ context, createSession })`, `signOut()`, `getSession()`
- **Passkey flows:** `src/auth/passkey.ts` — `registerWithPasskey(email, name)` signs out, then runs one ceremony that creates the account, registers its passkey and signs in. `signInWithPasskey()` signs in usernamelessly. Both return a message to show, or null on success.
- **Auth guard:** `src/auth/auth-guard.ts` — `requireAuth`, used as `enter()`; redirects to `signInUrl()`
- **Preferences:** `src/units.ts` (distance units: locale default, localStorage, server sync via `/api/user/preferences` while signed in) and `src/dark-mode.ts` (explicit choice or `prefers-color-scheme`, applies `wa-dark`). Both are built on `createPreference()` in `src/utils/preference.ts`, which falls back to memory when storage is unavailable; components subscribe with `StoreController` from `src/utils/store-controller.ts`.
- **Services:** `src/services/` — `api-client.ts` base fetch wrapper (same-origin, `ApiError`, `apiErrorMessage()`; `apiPut` takes `keepalive` for small saves during unload); `maps.ts` typed map, stop and sharing wrappers; `orders.ts` image upload, checkout, quote and order wrappers; `geocoding.ts` → `/api/geocode` (returns `[]` on failure); `routing.ts` → `/api/route` for drive/walk/bike, client-side geometry for plane/boat, straight-line fallback on failure
- **Map:** `src/map/maplibre-worker.ts` sets the MapLibre worker URL; import it in any module that constructs a Map. `src/map/map-controller.ts` (`MapController` draws items as GeoJSON layers and re-fits the camera only when the placed extent changes; `drawItems(items, { animate, fitPadding })`, `renderMarkerCanvas()`, `settle()`); `src/map/map-export.ts` (`renderMapCanvas()` renders an offscreen MapLibre map at 300 DPI, capped per side to 80% of the GPU max texture size or 4096px and, on iOS, to 8192 × 8192 px of area; `exportDpi()` gives the DPI after those caps, and the order page warns below `MIN_PRINT_DPI` without blocking; `paperFramePadding()` gives the auto-fit padding for a paper frame; `renderToBlob()` for print orders; `exportMap()` downloads PNG/JPEG via `canvas.toBlob` and PDF via a lazily imported jsPDF); `src/map/mockup-renderer.ts` (poster mockup on the export page); `src/map/styles/kid-drawn.ts` (transforms the OpenFreeMap Bright style)
- **Config:** `src/config/map.ts` (`resolveMapStyle()` returns a copy of the cached kid-drawn style)
- **Components:** `src/components/` — `app-shell`, `map-view`, `map-card`, `item-list`, `point-card`, `route-card`, `item-card-base.ts` (base class for point-card and route-card: shared properties, item events, header with drag handle), `endpoint-editor.ts` (shared endpoint templates and `locationFields()` for both cards), `location-search`, `icon-picker`, `travel-mode-picker`, `share-dialog`, `user-menu`; `ui.ts` has template helpers `errorCallout()`, `roleBadge()`, `orderStatusBadge()`
- **Styles:** `src/styles/` — `theme.css`, `global.css`, `card-shared.ts` (point-card, route-card and map-card), `page-layout.ts` (trip builder `wa-split-panel` on desktop, `wa-drawer` on mobile, plus `familyNameStyles`), `content-page.ts` (centered non-map pages), `heading-shared.ts`, `hidden-map.ts` (the 1400×900 off-screen render container the export and order pages share), `wa-utilities.ts` (Web Awesome utility classes)
- **Utils:** `src/utils/` — `geo.ts` (`isDraftCoord()`, `placedDest()`, `formatDistance()`, `haversineDistance()`, `sanitizeFilename()`), `countries.ts` (shipping countries), `existing-locations.ts` (autocomplete suggestions from a map's stops), `form.ts` (`fieldValue()`, `fieldChecked()` for Web Awesome form events), `preference.ts`, `store-controller.ts`
- **Pages:** `landing-page.ts`, `sign-in-page.ts`, `dashboard-page.ts`, `claim-page.ts`, `admin-page.ts`, `order-confirmation-page.ts`, and `map-page-base.ts`, the base class for `trip-builder-page.ts`, `map-preview-page.ts`, `export-page.ts` and `order-page.ts`

### Worker: `worker/src/`

- **Entry:** `worker/src/index.ts` — Hono app: rate limits, body limits, the Better Auth handler, CSRF check and route mounting. `/api/auth/*` bodies are capped at 64 KB and other JSON bodies at 2 MB; image uploads cap themselves at 100 MB.
- **Auth:** Better Auth 1.7 in `worker/src/auth.ts` (`database: env.DB`), mounted at `/api/auth/*`; `getAuth(env)` keeps one instance per isolate. There is no password login. Accounts come from a passkey or from Google or Facebook OAuth, and each email signs in only through the method that created it. `passkeyRegistration(db)` validates the JSON `{ email, name }` sign-up context, answers 422 for a taken email unless its user is an unreferenced orphan over 5 minutes old, and creates the user only after the passkey verifies. A sign-up context sent with a session gets 409 `SIGNED_IN`. Passkeys must be discoverable (`residentKey: 'required'`).
- **Middleware:** `worker/src/middleware/auth.ts` (`authMiddleware(required)` factory exporting `requireAuth` and `optionalAuth`, attaches `c.get('user')`); `worker/src/middleware/rate-limit.ts` (`rateLimit(binding, keyFn)`, answers 429)
- **Routes:** `maps.ts` (map + stop CRUD; `getMapWithRole()`, `requireMapRole(c, minRole, { param })`, `selectStopsStmt()`, `insertStopStmt()`), `sharing.ts` (shares, visibility, duplicate, `claimShareHandler`), `user-preferences.ts` (per-account units), `orders.ts` (raw PNG upload to R2 + serving, Stripe Checkout, Prodigi quote, user + admin order routes), `webhooks.ts` (Stripe + Prodigi), `geocode.ts` (Photon proxy), `route.ts` (ORS proxy). Checkout quotes shipping from Prodigi on the server and answers 502 when the quote fails, or 422 when Prodigi cannot ship there; the client never sends a shipping cost.
- **Lib:** `worker/src/lib/` — `hash.ts` (`sha256Hex()`, constant-time `secretsEqual()`), `cached-proxy.ts` (`proxyWithCache()`: KV-cached upstream JSON fetch used by geocode and route), `json-body.ts` (`readJsonBody()`), `orders.ts` (`submitOrderToProdigi()`), `stripe.ts` (`getStripe()`), `prodigi.ts` (`getShippingQuote()`, `createOrder()`, `getOrder()`, `isSandbox()`), `discord.ts` (`notifyDiscord()`)
- **Handler convention:** `requireMapRole()` and `readJsonBody()` set `c.res` to the error response and return `null`; callers `return c.res`
- **Types:** `worker/worker-configuration.d.ts` is generated by `npm run types` from `wrangler.toml` and the secret names in `worker/.dev.vars`, and it carries the workerd runtime types. `worker/src/types.ts` aliases `Env` to its `Cloudflare.Env` and defines `AppEnv` (Hono generic). Test-only bindings are declared in `worker/src/env.d.ts`. D1 row types live in `shared/types.ts`.
- **Migrations:** `worker/src/db/migrations/0001_initial.sql` holds the full schema. Better Auth checks its tables (`user`, `session`, `account`, `verification`, `passkey`) on the first auth call in each isolate. Every column it writes must exist and every other column must be nullable or have a default; otherwise every auth call fails and `requireAuth` answers 401 for everyone.
- **Tests:** `worker/src/test-helpers.ts` — `applyTestSchema()` applies the real migrations (passed in as the `TEST_MIGRATIONS` binding by `vitest.config.ts`). Use `request()` rather than `app.request()`: it supplies an ExecutionContext, waits for `waitUntil` work and adds a same-origin `Origin` to writes unless passed `{ origin: false }`. Also `createTestSession()`, `jsonRequest()`, `createMap()`, `createStop()`, `grantShare()`, `createShare()`, `insertMapRow()`, `insertOrder()`, `TEST_ADDRESS`. Test secrets are miniflare bindings in `worker/vitest.config.ts`. Auth route tests use a fresh `cf-connecting-ip` per request to stay under `RATE_LIMITER_AUTH`.

### Cloudflare bindings (`worker/wrangler.toml`)

| Binding | Type | Purpose |
|--|--|--|
| `DB` | D1 | Main relational DB (`roadtrip-db`) |
| `API_CACHE` | KV | Geocoding + routing cache (7d TTL) |
| `ROADTRIP_PRINTS` | R2 | Print-ready images (`roadtrip-prints`) |
| `RATE_LIMITER_PUBLIC` | Rate limit | 60/min per key: public map GET per IP, invite claim per user, invite creation per user, Prodigi callback per IP |
| `RATE_LIMITER_PROXY` | Rate limit | 30/min per key: geocode + route per user, checkout + print-quote per user (`orders:` prefix), image upload per user (`upload:` prefix) |
| `RATE_LIMITER_AUTH` | Rate limit | 10/min per IP: auth routes except `GET /api/auth/get-session` |

The D1 `database_id` is a placeholder; provision the database and set it before deploying. Once a remote D1 has applied `0001_initial.sql`, schema changes need a new migration file.

Secrets set via `wrangler secret put`: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID/SECRET`, `FACEBOOK_CLIENT_ID/SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PRODIGI_API_KEY`, `PRODIGI_SANDBOX` (`true`, `1`, `yes` or `on` selects the sandbox API), `ORS_API_KEY`, `ADMIN_SECRET` (Bearer token for `/api/admin/*`), `DISCORD_WEBHOOK_URL` (optional). A new secret goes in `worker/.dev.vars` and the miniflare bindings in `worker/vitest.config.ts`, then `npm run types`.

The Stripe Dashboard endpoint for `/api/webhooks/stripe` must subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` and `checkout.session.expired`, and use the API version the `stripe` SDK pins. Without these subscriptions, delayed payments never settle and unpaid orders are never deleted, which blocks deleting their maps. Checkout sessions expire after an hour; the failed and expired events delete the unpaid order and its print image when no other order uses it. A Stripe test key never auto-submits to live Prodigi; the order stays `paid` for an admin to submit.

Prodigi callbacks are unauthenticated hints. The webhook re-reads the order with `GET /orders/{id}` and never moves its status backwards. Orders carry a `callbackUrl` only when `BETTER_AUTH_URL` is https, so local dev receives no callbacks.

### Data model

Two item types stored in the `stops` table:
- **`point`** — standalone map marker (name, lat/lng, icon, label). `travel_mode` is always NULL; the API rejects one. The API stores `label`, but no UI edits it.
- **`route`** — A→B segment (start lat/lng/name/icon + `dest_*` fields + `dest_icon` + `travel_mode` + `route_geometry` for cached GeoJSON). A stop update that touches any of `GEOMETRY_INVALIDATING_FIELDS` clears `route_geometry`, on the server and in trip-builder-page.

Each endpoint (point or route start/dest) has an icon from the curated Jelly set. The special icon value `'none'` hides the marker and label on the map entirely. When an icon changes, it propagates to all other items sharing the exact same coordinates.

Five travel modes: `drive`, `walk`, `bike`, `plane`, `boat`. New routes default to `drive`. Plane = curved flight arc (client-computed quadratic Bézier, no ORS call). Boat = straight line. Enum-style columns (`travel_mode`, `type`, `visibility`, `role`, `status`, `units`) carry CHECK constraints in the schema.

`export_settings` (JSON TEXT on `maps` table) persists export preferences and map viewport per map: `{ paperSize, orientation, center, zoom, bearing, pitch, viewSize }`. `viewSize` is the preview map container's CSS size; the export and print renders size their paper frame from it, falling back to the hidden render container. The preview page saves it with a 1s debounce, only for signed-in owners/editors, and restores the viewport after the `drawItems` auto-fit. Per-user preferences (distance units) live in the nullable `user.units` column, read and written through `/api/user/preferences`.

Shares live in `map_shares`. An invite is a row with a `claim_token`, claimable for 30 days. Claiming sets `user_id` and keeps the token, so the claimant can reopen the link after it expires.

### FK enforcement policy

D1 enforces foreign keys on every query and migration, as if `PRAGMA foreign_keys = on`, and queries cannot turn this off. `PRAGMA defer_foreign_keys = on` only defers violation checks to the end of the transaction. SQLite's `DROP TABLE` deletes every row first, which fires ON DELETE actions, so dropping or rebuilding `maps` or `"user"` in a migration deletes their cascading child rows.

The app also deletes child rows explicitly and checks restricting references first, so callers get a 4xx instead of an FK error:

- `DELETE /api/maps/:id` (`worker/src/routes/maps.ts`) deletes `stops`, `map_shares` and the map in one `DB.batch`. Each statement is guarded by `NOT EXISTS` on `orders`, so a map with orders survives and the handler answers 409. R2 print images under `${mapId}/` are deleted after the batch.
- `reclaimOrphanUser()` in `worker/src/auth.ts` deletes an orphan user only when no `passkey`, `account`, `session`, `maps`, `map_shares` or `orders` row references it.
- User deletion is not exposed by the app. If Better Auth's account deletion is enabled, it must first clear the user's `map_shares` rows, since `map_shares.user_id` has no ON DELETE action, and refuse a user who has orders or owns a map with orders. The engine cascades sessions, accounts, passkeys and owned maps.

A new table that references `maps(id)` or `"user"(id)` must either have its rows deleted in the `DELETE /api/maps/:id` batch (CASCADE) or be checked by a guard that returns a 4xx (RESTRICT).

### CSRF protection

A middleware in `worker/src/index.ts` rejects `/api/*` requests other than GET, HEAD and OPTIONS unless `Origin`, or `Referer` when Origin is absent, matches `BETTER_AUTH_URL`. `/api/webhooks/*` is exempt. `/api/auth/*` is handled before this middleware, so it relies on Better Auth's own origin check against `trustedOrigins`, which `worker/src/auth.ts` sets to the `BETTER_AUTH_URL` origin. Register new API routes after the middleware.

### Browser support

Safari/iOS 18 is the oldest supported browser. It has neither URLPattern nor the Navigation API, so the router matches paths with RegExp and falls back to `popstate`, and link clicks there are full page loads. New code that uses either API needs a fallback.

iOS never fires `beforeunload`. trip-builder-page flushes queued saves on `pagehide` and `visibilitychange` with `keepalive`, which browsers refuse once in-flight keepalive bodies pass 64 KiB, so keep those saves small. iOS WebKit also caps a 2D canvas at 8192 × 8192 px, which `fitCanvas()` in `map-export.ts` respects, and Safari cannot encode WebP, so canvas output uses PNG or JPEG.

### UI components

Web Awesome Pro (`@web.awesome.me/webawesome-pro`) v3.x web components. Font Awesome Pro Jelly icons load from the Font Awesome CDN using the kit id passed to `setKitCode` in `src/index.ts`. Use `<wa-*>` components and `<wa-icon name="...">` throughout. Every `wa-*` component used must be imported in `src/index.ts`, because the autoloader cannot see into shadow DOM. `useDefineForClassFields: false` is required in tsconfig for Lit decorators.

The theme classes sit on `<html>` in `index.html`: `wa-theme-playful wa-palette-rudimentary wa-brand-orange`. `src/styles/theme.css` pins `--wa-color-brand-50` and `-60` to hex values that canvas and MapLibre drawing repeat, such as `#ff6b00` in `map-controller.ts` and the drive `hexColor` in `shared/travel-modes.ts`; change them together.

#### Web Awesome event conventions

- **Custom events** are prefixed `wa-` (e.g., `wa-show`, `wa-hide`, `wa-clear`). **Standard DOM events** use native names (`input`, `change`, `focus`, `blur`).
- Components call `this.dispatchEvent()` directly — no `emit()` helper.

**Popup/panel lifecycle** (wa-combobox, wa-select, wa-dialog, wa-drawer, wa-details, wa-dropdown, wa-tooltip): `wa-show` (cancelable) → `wa-after-show` → `wa-hide` (cancelable) → `wa-after-hide`. `wa-dialog`, `wa-drawer` and `wa-dropdown` include `event.detail.source` on hide.

**Form inputs** (wa-input, wa-combobox, wa-select, wa-switch, wa-radio-group): emit `input` + `change` on value commit and `wa-invalid` on validation failure. All but wa-radio-group emit `focus`/`blur`; wa-input, wa-combobox and wa-select emit `wa-clear` from the clear button. Read values with `fieldValue(e)` / `fieldChecked(e)` from `src/utils/form.ts`.

**wa-combobox `input` caveat:** The component may `stopPropagation()` on native typing events. To listen for typing, use a capture-phase listener: `addEventListener('input', ..., true)`.

**wa-dropdown:** also emits `wa-select` with `event.detail.item` referencing the selected `<wa-dropdown-item>`.

**Utility components:** `wa-copy-button` (one-click clipboard copy, replaces manual `navigator.clipboard` logic), `wa-toast`/`wa-toast-item` (transient notifications via `toast.create()`), `wa-split-panel` (resizable panel layout with drag handle).

**Minimal-event components:** wa-badge, wa-callout, wa-card, wa-divider, wa-dropdown-item, wa-option, wa-page, wa-radio, wa-relative-time, wa-spinner, wa-toast emit no custom events. wa-icon emits `wa-load`/`wa-error`. wa-button emits `wa-invalid`. wa-copy-button emits `wa-copy`/`wa-error`. wa-split-panel emits `wa-reposition`.

### Passkeys / WebAuthn

WebAuthn accepts `http://localhost`. The passkey plugin takes its rpID and expected origin from `BETTER_AUTH_URL`, so the page origin must equal it. Test passkeys through `npm run dev:full` at `http://localhost:8787`, which matches `worker/.dev.vars`; the Vite server on :5173 fails that match. LAN IPs from `wrangler dev --ip 0.0.0.0` are not secure contexts, so test other devices through an HTTPS tunnel such as `cloudflared`, with `BETTER_AUTH_URL` set to the tunnel origin. Production sets `BETTER_AUTH_URL` to the canonical HTTPS domain.

Passkey accounts keep `emailVerified` false, which stops Google or Facebook sign-in from linking into them. Do not mark them verified, or set `accountLinking.requireLocalEmailVerified: false`, until the app verifies email. Worker tests cannot run the WebAuthn ceremony, so `auth.test.ts` calls `afterVerification` directly.
