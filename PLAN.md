# Mapadillo — Implementation Plan

## Context

Mapadillo is a family road trip map app. A parent enters the trip's places and the app draws a bright, kid-friendly map, which can be downloaded as a PDF or image or ordered as a printed poster through Prodigi. The UI uses Web Awesome Pro components and Font Awesome Pro Jelly icons for a playful, childlike look.

**Accounts use Better Auth.** People sign up with Google, Facebook or a passkey (WebAuthn: biometrics, a hardware key or a platform authenticator). There is no password login. An email signs in only through the method that created its account, so a passkey account has no OAuth recovery.

**Maps and sharing.** A map belongs to the user who created it. It is shared as **Owner** (full control and delete), **Editor** (edits the trip and can order prints) or **Viewer** (read-only). A map is **private** (owner and shared users only) or **public**: anyone with the `/map/{id}` link can view it, and signed-in visitors can duplicate it.

**International scope.** Trips can be anywhere in the world, with no geographic bias. Distances show in km or miles. Print orders ship to the countries listed in `src/utils/countries.ts`.

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Framework** | Vite + Lit (TypeScript) | Web Awesome Pro is built on Lit, so the app uses one component model throughout |
| **UI Components** | Web Awesome Pro (`@web.awesome.me/webawesome-pro`) v3.x | Playful theme, Rudimentary palette and `wa-brand-orange` give a kid-friendly look out of the box |
| **Icons** | Font Awesome Pro+ Jelly icons (via Kit code) | Rounded, bubbly icons suited to a children's UI; requires a Pro+ subscription |
| **Map Renderer** | MapLibre GL JS v6.x | Open-source WebGL2 vector maps with full style control and offscreen rendering for print |
| **Map Tiles** | OpenFreeMap | Free OpenStreetMap vector tiles, no API key, commercial use allowed |
| **Map Style** | OpenFreeMap "Bright", transformed at runtime into a kid-drawn look | `src/map/styles/kid-drawn.ts` rewrites colors, line widths, dash arrays and label sizes, reusing Bright's tiles and sprites |
| **PDF/Image Export** | Offscreen MapLibre render + Canvas 2D + jsPDF | High-resolution map render with a decorative poster layout |
| **Print Service** | Prodigi API (print-on-demand) | Free sandbox, poster sizes up to 40x60", no minimums, global fulfillment |
| **Payments** | Stripe Checkout | We charge the customer through Stripe, then place the order with Prodigi at wholesale cost |
| **Auth** | Better Auth 1.7.7 (`better-auth`, `@better-auth/passkey`) | TypeScript-first; takes the D1 binding directly; OAuth, passkeys and sessions |
| **Auth Providers** | Google, Facebook, Passkeys (WebAuthn) | OAuth covers most parents; passkeys add a passwordless option with no third party |
| **Database** | Cloudflare D1 (SQLite) | Users, sessions, maps, sharing and orders |
| **Backend + Hosting** | Cloudflare Workers (Hono) + D1 + KV + R2 | One Worker serves the API and the Vite-built SPA from one origin, so there is no CORS and auth cookies are first-party. KV caches upstream API responses; R2 stores print images |
| **Geocoding** | Photon by Komoot (`photon.komoot.io`) | Free OSM geocoder with autocomplete, no API key and no strict rate limit |
| **Directions** | OpenRouteService | Free tier with drive, walk and bike profiles |
| **Client Routing** | DIY Lit controller: RegExp matcher, Navigation API with a `popstate` fallback | No dependency. The browser floor is Safari/iOS 18 |

---

## Core User Flow

```
1. Landing page → "Start Planning" (dashboard when signed in, sign-in otherwise)
2. Sign in / create account
   - Google or Facebook OAuth
   - "Sign in with Passkey" (usernameless)
   - Create account: name + email, then one passkey prompt creates the account
   - Returns to the page that asked for sign-in, or the dashboard
3. Dashboard ("My Trips")
   - Trips the user owns, trips shared with them (with role badge), print orders
   - "Create New Trip"
4. Trip Builder, /map/:id (owners and editors edit; viewers and public visitors see it read-only)
   - Trip name and family name
   - Add points and A→B routes through location search; pick icons and travel modes
   - Reorder items by drag and drop; live map with routes and markers
   - Debounced auto-save with a save indicator
   - Owner: Share dialog (public/private, Viewer or Editor invite links)
   - Viewers and public visitors: "Duplicate this trip"; signed-out visitors are sent to sign in first
5. Preview, /preview/:id
   - Full-screen map under a paper frame; choose paper size and orientation, position the map
   - Owners and editors save the framing; "Continue" goes to export
6. Export, /export/:id (downloads require sign-in)
   - Poster mockup; download PNG, JPEG or PDF at up to 300 DPI, optionally with trip details
   - Owners and editors: "Order a Print"
7. Order, /order/:id
   - Product, size and shipping address; live shipping quote
   - Warning when this device would render the size below 150 DPI
   - Render, upload, then Stripe Checkout
8. Order confirmation, /order-confirmation/:orderId
   - Stripe webhook confirms payment → Worker submits the order to Prodigi
   - Status and tracking link, also listed on the dashboard
```

---

## Project Structure

```
mapadillo/
├── index.html                      # Theme classes (playful, rudimentary, wa-brand-orange) + <app-shell>
├── package.json
├── vite.config.ts                  # ES2022 build, vendor chunks, ES-module workers for MapLibre, /api proxy to :8787
├── tsconfig.json
├── vitest.config.ts                # Frontend tests (node env; router and nav tests opt into happy-dom)
├── .npmrc                          # Web Awesome Pro registry + token
├── map-jelly-regular-full.svg      # Favicon source icon
├── map-jelly-duo-regular-full.svg  # Duotone variant of the map icon
├── public/
│   └── favicon.svg
├── src/
│   ├── index.ts                    # Entry: styles, WA component imports, FA kit, dark mode, units, auth, app-shell
│   ├── router.ts                   # DIY router: RegExp matcher, Navigation API with popstate fallback
│   ├── nav.ts                      # navigateTo() + signInUrl()
│   ├── units.ts                    # Distance units preference (locale default, localStorage, server sync)
│   ├── dark-mode.ts                # Dark mode preference (explicit choice or prefers-color-scheme)
│   ├── vite-env.d.ts
│   ├── styles/
│   │   ├── theme.css               # Playful theme overrides: brand shades pinned for canvas use, rounded font
│   │   ├── global.css              # App-wide styles
│   │   ├── card-shared.ts          # Shared CSS for point-card + route-card
│   │   ├── page-layout.ts          # Trip builder layout (wa-split-panel on desktop, wa-drawer on mobile) + familyNameStyles
│   │   ├── content-page.ts         # Centered layout for non-map pages
│   │   ├── heading-shared.ts       # Brand h1 styles
│   │   ├── hidden-map.ts           # Off-screen map containers for export/order rendering
│   │   └── wa-utilities.ts         # Web Awesome utility classes for shadow roots
│   ├── auth/
│   │   ├── auth-client.ts          # Better Auth client with the passkey plugin
│   │   ├── auth-controller.ts      # Lit controller that re-renders its host on auth changes
│   │   ├── auth-guard.ts           # requireAuth route guard: redirect to sign-in if unauthenticated
│   │   ├── auth-state.ts           # Reactive auth state (current user, session)
│   │   └── passkey.ts              # registerWithPasskey(), signInWithPasskey()
│   ├── config/
│   │   └── map.ts                  # resolveMapStyle(): cached kid-drawn style
│   ├── map/
│   │   ├── map-controller.ts       # MapController: route line layers + marker symbol layers; renderMarkerCanvas()
│   │   ├── map-export.ts           # Offscreen render, PNG/JPEG/PDF export, renderToBlob() for print orders
│   │   ├── maplibre-worker.ts      # Sets the MapLibre worker URL; import wherever a Map is constructed
│   │   ├── mockup-renderer.ts      # Canvas 2D poster mockup for the export page
│   │   └── styles/
│   │       └── kid-drawn.ts        # Transforms OpenFreeMap Bright into the kid-drawn style
│   ├── pages/
│   │   ├── landing-page.ts
│   │   ├── sign-in-page.ts         # OAuth buttons, passkey sign-in, passkey-first registration
│   │   ├── dashboard-page.ts       # "My Trips" + "Shared with Me" + print orders
│   │   ├── claim-page.ts           # Auto-claims an invite link
│   │   ├── map-page-base.ts        # Base class: map loading, MapController lifecycle, item sync
│   │   ├── trip-builder-page.ts
│   │   ├── map-preview-page.ts     # Full map preview with paper frame; saves export_settings
│   │   ├── export-page.ts          # Downloads, poster mockup, "Order a Print" (owner/editor)
│   │   ├── order-page.ts           # Product/size picker, address, Prodigi quote, DPI warning, render + R2 upload, Stripe redirect
│   │   ├── order-confirmation-page.ts # Order status + tracking URL
│   │   └── admin-page.ts           # Order list and Prodigi submission (admin secret as Bearer token)
│   ├── utils/
│   │   ├── geo.ts                  # isDraftCoord(), placedDest(), formatDistance(), haversineDistance(), sanitizeFilename()
│   │   ├── countries.ts            # Shipping countries (top destinations first)
│   │   ├── existing-locations.ts   # Autocomplete suggestions from a map's stops
│   │   ├── form.ts                 # fieldValue() / fieldChecked() for Web Awesome form events
│   │   ├── preference.ts           # createPreference(): validated localStorage value with subscribers
│   │   └── store-controller.ts     # Lit controller that re-renders on store changes
│   ├── components/
│   │   ├── location-search.ts      # Geocoding autocomplete (biased toward the active map center)
│   │   ├── item-list.ts            # Pointer-based drag-and-drop item list (points + routes)
│   │   ├── item-card-base.ts       # Base class for point-card and route-card: shared properties, item events, header
│   │   ├── point-card.ts           # Standalone point card (icon picker, name)
│   │   ├── route-card.ts           # A→B route card (start/end search, travel mode, distance)
│   │   ├── endpoint-editor.ts      # Shared endpoint templates and locationFields() for both cards
│   │   ├── map-view.ts             # MapLibre GL wrapper component
│   │   ├── map-card.ts             # Dashboard card with a snapshot map preview
│   │   ├── share-dialog.ts         # Visibility, invite links, collaborator roles and removal
│   │   ├── icon-picker.ts          # Dialog-based Jelly icon picker grouped by category
│   │   ├── travel-mode-picker.ts   # Five-mode wa-radio-group with per-mode colors
│   │   ├── ui.ts                   # Template helpers: errorCallout(), roleBadge(), orderStatusBadge()
│   │   ├── user-menu.ts            # Avatar, My Trips, dark mode and units toggles, sign-out
│   │   └── app-shell.ts            # Layout wrapper (header, footer) + route table
│   └── services/
│       ├── api-client.ts           # Base fetch wrapper (same-origin cookies, ApiError, optional keepalive PUTs)
│       ├── maps.ts                 # Typed wrappers for maps, items and sharing
│       ├── geocoding.ts            # Calls the Worker proxy → Photon
│       ├── routing.ts              # Calls the Worker proxy → OpenRouteService; plane/boat computed client-side
│       └── orders.ts               # Upload print image, checkout, quote, list/get orders
├── worker/                         # Cloudflare Worker backend
│   ├── wrangler.toml               # Worker config: static assets, D1, KV, R2, rate limit bindings
│   ├── worker-configuration.d.ts   # Generated Env types (npm run types)
│   ├── vitest.config.ts            # Workers pool, test secrets, TEST_MIGRATIONS binding, istanbul coverage
│   ├── src/
│   │   ├── index.ts                # Worker entry: Better Auth handler, CSRF, body and rate limits, route mounting
│   │   ├── auth.ts                 # Better Auth instance: OAuth, passkey-first registration
│   │   ├── types.ts                # Env (generated Cloudflare.Env) + AppEnv
│   │   ├── env.d.ts                # TEST_MIGRATIONS binding type for cloudflare:test
│   │   ├── test-helpers.ts         # Schema setup, request/session helpers, D1 fixtures
│   │   ├── middleware/
│   │   │   ├── auth.ts             # requireAuth + optionalAuth: validate the session, attach the user
│   │   │   └── rate-limit.ts       # rateLimit(binding, keyFn) middleware factory
│   │   ├── routes/
│   │   │   ├── maps.ts             # Map + item CRUD, role checks (getMapWithRole, requireMapRole)
│   │   │   ├── sharing.ts          # Shares, visibility, duplicate, claim handler
│   │   │   ├── user-preferences.ts # Per-account preferences (units)
│   │   │   ├── orders.ts           # Image upload + serving (R2), Stripe Checkout, Prodigi quote, user/admin order routes
│   │   │   ├── webhooks.ts         # Stripe Checkout events + Prodigi order callbacks
│   │   │   ├── geocode.ts          # Photon geocoding proxy (KV cache)
│   │   │   └── route.ts            # OpenRouteService routing proxy (KV cache)
│   │   ├── db/
│   │   │   └── migrations/
│   │   │       └── 0001_initial.sql # Full D1 schema. Shared row types live in shared/types.ts
│   │   └── lib/
│   │       ├── cached-proxy.ts     # proxyWithCache(): KV-cached upstream JSON fetch
│   │       ├── json-body.ts        # readJsonBody(): parse a JSON body or answer 400
│   │       ├── hash.ts             # sha256Hex(), constant-time secretsEqual()
│   │       ├── orders.ts           # submitOrderToProdigi()
│   │       ├── prodigi.ts          # Prodigi API client (quote, create order, get order)
│   │       ├── stripe.ts           # Stripe SDK init
│   │       └── discord.ts          # Discord webhook notifications (order events)
│   └── package.json
└── shared/
    ├── types.ts                    # Shared types (MapData, Stop, StopRow, ShareData, Order, ShippingAddress, request bodies)
    ├── paper.ts                    # PaperSize (PAPER_SIZE_VALUES, isPaperSize()) + Orientation
    ├── travel-modes.ts             # TRAVEL_MODES + isTravelMode()
    ├── units.ts                    # Units + VALID_UNITS
    ├── icons.ts                    # ICON_CATEGORIES, VALID_ICONS, DEFAULT_ICON
    ├── limits.ts                   # Name and label lengths, stops per map
    └── products.ts                 # Product catalog, PRINTABLE_SIZES, status badges, ORDER_STATUSES, statusLabel(), orderRef()
```

---

## Key Implementation Details

### Authentication (Better Auth)
- **Library:** Better Auth 1.7.7 with `@better-auth/passkey`. `worker/src/auth.ts` passes `database: env.DB`, and Better Auth's Kysely adapter uses its bundled D1 dialect.
- **Schema check:** On the first auth call in each isolate, Better Auth checks the `user`, `session`, `account`, `verification` and `passkey` tables against its schema. A mismatch fails every auth request, including the session check behind `requireAuth`, so change those tables only in step with Better Auth.
- **Registration is passkey-first:** The sign-in page sends name and email as the context of one passkey ceremony. The server validates them and refuses an email that already has an account (422) before any prompt. It creates the user only after the passkey verifies, so a cancelled prompt leaves nothing behind. Email and password sign-up is disabled.
- **Signed-in callers:** A sign-up context sent with a session is refused (409 `SIGNED_IN`), because the plugin would add the passkey to the signed-in account. `registerWithPasskey()` therefore signs out first.
- **Sign-in:** Google or Facebook OAuth, or usernameless passkey sign-in. Passkeys must be discoverable credentials (`residentKey: 'required'`).
- **One method per email:** Passkey accounts keep `emailVerified` false, so OAuth never links into them. A Google or Facebook sign-in with such an email returns to `/sign-in` with `error=account_not_linked`. Until email verification exists, never mark passkey accounts verified and never set `accountLinking.requireLocalEmailVerified: false`.
- **Orphan users:** D1 has no transactions, so a passkey insert that fails after the user insert leaves a user with no credential. The next registration for that email deletes such a user once it is five minutes old and nothing references it.
- **Sessions:** Cookie-based sessions in D1. Better Auth's cookie cache is off: it would skip the D1 lookup, but a revoked session would stay valid until the cached cookie expired.
- **Server setup:** `getAuth(env)` builds the instance once per isolate; Hono mounts it on `/api/auth/*`. `BETTER_AUTH_URL` supplies `baseURL`, `trustedOrigins` and the passkey `rpID` and `origin`, never the request URL. Better Auth's own rate limiter is off because `RATE_LIMITER_AUTH` covers these routes. Failed OAuth sign-ins redirect to `/sign-in` with an `error` code, which the page shows as a message.
- **Client setup:** `src/auth/auth-client.ts` creates the client with `passkeyClient()`. The app calls `signIn.social({ provider })`, `signIn.passkey()`, `passkey.addPasskey({ context, createSession })`, `signOut()` and `getSession()`. `src/auth/passkey.ts` wraps the passkey ceremonies as `registerWithPasskey(email, name)` and `signInWithPasskey()`, which return a message to show or null.
- **Route protection:** `worker/src/middleware/auth.ts` exports `requireAuth` and `optionalAuth`, which validate the session and set `c.get('user')`. On the frontend, `requireAuth` in `src/auth/auth-guard.ts` is a route `enter()` hook that redirects to `signInUrl()`.
- **OAuth app setup:** Google Cloud Console (OAuth consent screen + credentials) and Meta Developer Portal (Facebook Login app). Redirect URIs are listed under Deployment.
- **Passkey setup:** No third-party registration. The page origin must equal `BETTER_AUTH_URL`. Locally, `http://localhost:8787` via `npm run dev:full` works; the Vite server on :5173 and LAN IPs do not (see Local development).

### Sharing & Permissions
- **Roles:** Owner (creator, full control and delete), Editor (edits the trip and its export settings, orders prints), Viewer (read-only)
- **Visibility:** Each map is `private` (default) or `public`
  - **Public maps:** Anyone with the link can view without signing in. Signed-in visitors can "Duplicate this trip"
  - **Private maps:** Only the owner and users who claimed a share can open them
- **Invite links:** `POST /api/maps/:id/shares` creates a `map_shares` row with a random `claim_token`, the chosen role and a 30-day expiry. The share dialog builds the `/claim/{token}` URL and offers a copy button. The owner shares it however they like
- **Claiming:** `/claim/:token` requires sign-in and returns there afterwards. The claim page calls `POST /api/shares/claim/:token`, which sets `user_id` on the share and returns `{ map_id }`; the page then opens the map. The link keeps working for whoever claimed it, and anyone else gets 403. An expired, unclaimed invite is deleted when used. A user who already has a share keeps the higher of the two roles
- **Access checks:** Every map route checks whether the user is the owner, holds a claimed share, or is reading a public map. No access → 404; a role too low for the action → 403

### Client-Side Routing (DIY)
- **No library dependency.** `src/router.ts` is a Lit reactive controller. Route paths such as `/map/:id` compile to anchored RegExps with one named group per parameter. The query and fragment are ignored, and the first matching route wins
- **Route config:** `{ path, render, enter?, fullHeight?, title? }` objects declared in `app-shell.ts`. `enter()` may return a redirect path. `fullHeight` makes the page fill the viewport and hides the footer. `title` sets the tab title to `<title> · Mapadillo`. `router.target` is the route being entered, set before its guard runs
- **Route guards:** `requireAuth` guards `/dashboard`, `/map/new`, `/claim/:token`, `/order/:id`, `/order-confirmation/:orderId` and `/admin`. `/`, `/sign-in`, `/map/:id`, `/preview/:id` and `/export/:id` are open; the export page sends signed-out users to sign-in when they download
- **With the Navigation API:** One `navigate` listener intercepts link clicks, `navigateTo()` and Back/Forward, with `scroll: 'after-transition'` and the browser's focus reset. A push or replace to a path with no route falls through to a full page load, so `/api` paths and static files still work. Back/Forward to such a path renders the 404 in place
- **Without it (Safari/iOS 18):** A `popstate` listener renders Back/Forward and `navigateTo()`, which calls `history.pushState`/`replaceState` and dispatches a synthetic `popstate`. Plain link clicks are full page loads served by the SPA fallback. These pushes do not reset scroll or focus
- **Auth guard pattern:** The router awaits the route's `enter()` hook; `requireAuth` returns `signInUrl()` when unauthenticated, and the router replaces the entry with it
- **Page loading:** The landing, sign-in and claim pages are bundled with the shell. The other pages load on entry through app-shell's `lazy(load, guard)` hook, which runs the auth guard first
- **SPA hosting:** Workers Static Assets serve `dist/` for non-API paths and fall back to `index.html`

### Map Style
- `resolveMapStyle()` in `src/config/map.ts` fetches the OpenFreeMap "Bright" style once, passes it through `transformToKidDrawn()` in `src/map/styles/kid-drawn.ts`, and caches the result
- The transform rewrites colors, line widths, dash arrays and label sizes for a crayon-like, hand-drawn look, reusing Bright's vector tile sources and sprites
- Label colors (`LABEL_BROWN`, `LABEL_HALO`) are exported from `kid-drawn.ts` so marker labels match base-map labels
- Marker icons are drawn from the curated Jelly set onto canvases by `renderMarkerCanvas()` (see Map Elements below)

### Map Elements

Maps contain two kinds of items, both stored in the `stops` table: **points** (standalone markers) and **routes** (A→B segments with a travel mode).

#### Points and Endpoints
- Each point, and each end of a route, has a name, lat/lng and an **icon** chosen from the curated Jelly picker. An endpoint with no icon shows `location-dot` (`DEFAULT_ICON`)
- Items also carry an optional `label`, which the API stores and accepts but no UI reads or edits
- The special icon value `'none'` hides the marker and label on the map entirely; the picker shows it as `eye-slash`
- When an icon changes on any endpoint, it propagates to all other items sharing the exact same coordinates
- The icon picker groups the icons from `ICON_CATEGORIES` in `shared/icons.ts`:

| Category | Icons |
|----------|-------|
| Basic | `location-dot`, `none` (hides marker) |
| Outdoors | `tree`, `leaf`, `flower`, `compass`, `fire`, `snowflake`, `sun`, `umbrella` |
| Food & Drink | `utensils`, `mug-hot`, `cake-candles`, `martini-glass`, `fish` |
| Sightseeing | `camera`, `landmark`, `globe`, `ticket`, `crown` |
| Accommodation | `house`, `bed` |
| Fun | `star`, `trophy`, `gift`, `shop`, `paw`, `sparkles` |
| Transport | `plane`, `ship`, `train`, `bus`, `car`, `suitcase` |
| People | `heart`, `anchor` |
| Checklist | `circle`, `square`, `circle-check`, `circle-plus`, `circle-info`, `circle-xmark` |

- `person-biking` is reserved for the travel mode picker and is not offered as a stop icon
- Jelly lacks `tent`, `mountain`, `campfire` (use `fire`), `ice-cream`, `burger` and `pizza-slice` (use `utensils`), `umbrella-beach` (use `umbrella`) and `bicycle` (use `person-biking`)

#### Routes (Travel Mode)
- Each route item (`type = 'route'`) has its own start and destination and a `travel_mode`
- Points always have `travel_mode = NULL`, and the API rejects one. New routes default to `drive`; a route's `travel_mode` is NULL only if a client clears it
- Five modes, each with its own line style (all lines use round caps; colors come from `shared/travel-modes.ts`):

| Mode | ORS Profile | Line Style | Color | Picker icon |
|------|------------|------------|-------|-------------|
| Drive | `driving-car` | Solid | Orange | `car` |
| Walk | `foot-walking` | Dotted | Green | `compass` |
| Bike | `cycling-regular` | Dashed | Cyan | `person-biking` |
| Plane | none | Dotted, curved arc | Blue | `plane` |
| Boat | none | Long dashes, straight line | Indigo | `ship` |

- **Plane:** The client computes a curved arc (quadratic Bézier, interpolated GeoJSON `LineString`) with no routing call; its distance is the haversine distance
- **Boat:** A straight `LineString` between the endpoints, since ORS has no free sailing profile. It may cross land; users add an intermediate item when a strait matters

### Route Drawing
- **OpenRouteService** Directions API routes drive, walk and bike segments, **proxied through the Worker** with KV caching
- Endpoint: `POST https://api.openrouteservice.org/v2/directions/{profile}/geojson` with exactly two coordinates per call
- **One ORS call per routed segment.** Per-segment calls maximize KV cache hits, because two trips sharing a leg reuse the cached response. Cache key: `route:{profile}:{sha256(start_lon,start_lat,end_lon,end_lat)}`
- The proxy returns ORS's GeoJSON `FeatureCollection`; the client takes the `LineString` coordinates and the summary distance
- The trip builder caches each drawn segment's coordinates and distance in the item's `route_geometry`, which later draws and the dashboard map cards reuse. Changing coordinates or `travel_mode` clears it
- When ORS finds no route (422 from the proxy), the client draws a straight line it may cache. Any other failure draws a straight line flagged as a fallback, which is not cached
- Free tier: **2,000 requests/day**, 40/min
- Auth: API key in the `Authorization` header (free signup at openrouteservice.org)
- Each segment is its own MapLibre source and line layer. Endpoint markers show the chosen Jelly icon and name as symbol layers, with `route-markers` below `point-markers`

### Export (PDF / Image)
- `renderMapCanvas()` in `src/map/map-export.ts` renders the map in an offscreen MapLibre map at **300 DPI** for the paper size and orientation. When the preview saved a `viewSize`, the render frames the area the preview's paper frame showed
- **Canvas limits:** Each dimension is capped at 80% of the GPU's WebGL2 `MAX_TEXTURE_SIZE`, or 4096 px without WebGL2. Where the browser cannot back a larger 2D canvas, as on iOS, the area is also capped at 8192 × 8192 px. `exportDpi()` reports the DPI after these caps
- A tile error, a render error or a 30 s timeout aborts the render with a message; a render error suggests a desktop browser
- Paper sizes come from `shared/paper.ts`: letter, A4, A3, tabloid, A2, A1, 18x24, 24x36 and 40x60. Only the last three are printable products
- With "Include trip details", the render is composited onto a Canvas 2D poster layout:
  - Trip title and family name
  - Itinerary of waypoint names
  - Rounded inset border
  - Stats (total distance, number of stops and routes)
  - "Made with Mapadillo" footer and map attribution
- Without it, the map gets only the OpenStreetMap attribution
- PNG and JPEG encode with `canvas.toBlob`; PDF embeds a JPEG of the canvas with jsPDF at the paper size
- Print orders use `renderToBlob()`: the plain map with attribution, as a PNG

### Print-and-Mail (Prodigi)
- Products, sizes and **customer-facing prices** live in `shared/products.ts` (Budget Poster and Eco Rolled Canvas at 18x24", 24x36" and 40x60"; see Milestone 9)
- **Shipping** is a separate Stripe line item. The order page shows a live Prodigi quote fetched through the Worker. Checkout re-quotes on the server and never accepts a cost from the client; it answers 502 when the quote fails and 422 when Prodigi cannot ship there
- **Print resolution:** The order page warns when this device would render the chosen size below 150 DPI (`MIN_PRINT_DPI`) and never blocks the order
- **Image delivery:** The client renders the map with `renderToBlob()` and uploads the PNG to R2 through the Worker. The order stores `/api/images/<mapId>/<uuid>.png`, and submission resolves that path against `BETTER_AUTH_URL` so Prodigi can fetch it
- **Image serving:** `GET /api/images/*` streams the object from R2 with a one-year immutable cache header. Image keys are unguessable UUIDs
- **Callbacks:** Orders are created with a `callbackUrl` when `BETTER_AUTH_URL` is https. Callbacks are unauthenticated hints; the Worker re-reads the order with `GET /orders/{id}`
- **Test safety:** A Stripe test-mode key never auto-submits to live Prodigi; the order waits at `paid` for an admin, who may still submit it by hand
- Prodigi sandbox for development (free, orders not fulfilled)

### Geocoding (International)
- **Photon by Komoot** (`photon.komoot.io`), **proxied through the Worker**
- No API key and no strict rate limit. Autocomplete via `/api?q=...&limit=5`
- The Worker caches responses in KV for 7 days
- Response format: GeoJSON `FeatureCollection` with `properties.name`, `properties.city`, `properties.country`, etc.
- Works globally. The client biases results toward the active map center without restricting them
- The client waits for 2 characters and debounces input by 300 ms
- `lang` query parameter (`en`, `de`, `fr` or `it`) for localized results

### Units
- Km or miles is a per-account preference (`user.units`, NULL until first set, via `GET/PUT /api/user/preferences`), mirrored in localStorage
- The default comes from the browser locale: miles for the US and GB regions, km elsewhere. When the account has no value, signing in uploads the local choice
- ORS returns meters; the client converts

---

## Print Service: Prodigi

**Why Prodigi over alternatives:**
- Best API documentation with full Postman collection
- Free sandbox environment (`api.sandbox.prodigi.com`)
- Order callbacks on status changes
- Poster sizes from 4x6" to 40x60"
- Global fulfillment (UK, EU, US, CA, AU, SE)
- No minimums, no monthly fees
- Customer payments stay with Stripe

**Alternatives considered:** Gelato (larger network, $25/mo optional), Printful (largest catalog), Cloudprinter (enterprise-scale). All viable fallbacks.

**Note:** No POD service offers folded maps, only flat or rolled poster prints.

---

## Backend: Cloudflare Workers

A single Cloudflare Worker (using the **Hono** router) handles all server-side concerns, and Workers Static Assets serve the Vite-built SPA from the same origin. There is no CORS and auth cookies are first-party.

### Rate Limiting
- **Implementation:** Workers `ratelimits` bindings, applied with the `rateLimit(binding, keyFn)` middleware factory, which answers 429. Client IPs come from `cf-connecting-ip`
- **`RATE_LIMITER_PUBLIC` (60/min per key):** `GET /api/maps/:id` per IP, signed in or not; invite claims and invite creation per user; Prodigi callbacks per IP
- **`RATE_LIMITER_PROXY` (30/min per key):** geocode and route per user; checkout and print-quote per user (`orders:` prefix); print image upload per user (`upload:` prefix). Each prefix has its own budget
- **`RATE_LIMITER_AUTH` (10/min per IP):** `/api/auth/*` except `GET /api/auth/get-session`, which runs on every load and refocus
- **Body limits:** 64 KiB on `/api/auth/*`, 2 MiB on other `/api/*` bodies, and 100 MB for image uploads, enforced in their handler

### CSRF Protection
- A middleware in `worker/src/index.ts` rejects `/api/*` requests other than GET, HEAD and OPTIONS unless `Origin`, or `Referer` when `Origin` is absent, matches `BETTER_AUTH_URL`
- `/api/webhooks/*` is exempt. Admin routes are not
- `/api/auth/*` is handled before this middleware, so it relies on Better Auth's origin check against `trustedOrigins`
- Register new API routes after the middleware

### D1 Database (Users, Maps, Sharing, Orders)
- **Database:** `roadtrip-db`. The `database_id` in `wrangler.toml` is a placeholder until the database is provisioned
- **Schema:** `worker/src/db/migrations/0001_initial.sql` is the only migration and the canonical schema. Enum-style TEXT columns carry CHECK constraints. It is edited in place, so a local D1 built from an older copy must be reset (see Local development). Once production D1 exists, schema changes need a new migration file
- **Better Auth tables:** `user` (plus the app's nullable `units` column, `'km' | 'mi'`), `session`, `account`, `verification`, `passkey`
- **`maps`:** `id`, `owner_id`, `name`, `family_name`, `visibility` (`'public' | 'private'`), `export_settings`, `created_at`, `updated_at`. `export_settings` is JSON TEXT (default `'{}'`, at most 10,000 characters): `{paperSize, orientation, center, zoom, bearing, pitch, viewSize}`. `viewSize` is the preview map's CSS size, which the export and print renders use to frame the same area
- **`stops`:** `id`, `map_id`, `position`, `type` (`'point' | 'route'`), `name`, `label`, `latitude`, `longitude`, `icon`, `travel_mode` (NULL on points), `dest_name`, `dest_latitude`, `dest_longitude`, `dest_icon`, `route_geometry` (cached segment coordinates and distance, JSON), `created_at`. Indexed on `(map_id, position)`
- **`map_shares`:** `id`, `map_id`, `user_id` (NULL until claimed), `role` (`'viewer' | 'editor'`), `claim_token` (UNIQUE; kept after the claim so the claimant can reopen the link), `claim_token_expires_at`, `created_at`, `UNIQUE(map_id, user_id)`
- **`orders`:** `id`, `map_id` and `user_id` (RESTRICT), `product_type`, `product_sku`, `poster_size`, `status` (`pending_payment`, `paid`, `pending_render`, `submitted`, `in_production`, `shipped`, `completed`, `cancelled`, `failed`), `stripe_session_id` (UNIQUE), `prodigi_order_id` (indexed), `image_url`, `shipping_address` (JSON), `subtotal`, `shipping_cost`, `currency`, `tracking_url`, `customer_email` (from Stripe Checkout, sent to Prodigi as the recipient email), `discord_notified`, `created_at`, `updated_at`
- **Foreign keys:** D1 enforces the FK clauses. The application still deletes child rows explicitly and pre-checks RESTRICTed references, so callers get a 4xx instead of an FK error. `DELETE /api/maps/:id` answers 409 while any order references the map

### KV Cache (Geocoding + Routing)
- **Namespace:** `API_CACHE`
- **Keys:**
  - `geocode:{sha256(query, lang, limit, bias rounded to 0.1°)}`: Photon geocoding response
  - `route:{profile}:{sha256(start_lon,start_lat,end_lon,end_lat)}`: ORS single-segment response (profile = `driving-car` | `foot-walking` | `cycling-regular`)
- **Value:** the upstream JSON. Upstream calls time out after 10 s, and responses over 1 MiB are refused with 502
- **TTL:** 7 days for both, set in `worker/src/lib/cached-proxy.ts`

### R2 Storage (Print Images)
- **Bucket:** `roadtrip-prints` (binding `ROADTRIP_PRINTS`)
- **Key:** `{mapId}/{uuid}.png`
- **Value:** PNG rendered by the client with `renderToBlob()`, uploaded as a raw `image/png` body with `Content-Length` (max 100 MB)
- **Access:** served by the Worker at `GET /api/images/{mapId}/{uuid}.png`. Keys use unguessable UUIDs
- **Cleanup:** An expired or failed checkout deletes its image unless another order uses it. Deleting a map deletes everything under `{mapId}/`. An upload whose checkout never started stays until its map is deleted

### API Routes (Hono)

**Auth (handled by Better Auth, mounted at `/api/auth/*`):**
| Method | Route | Description |
|--------|-------|-------------|
| `*` | `/api/auth/*` | Better Auth handles all auth routes (OAuth, passkey registration and sign-in, sign-out, session) |

**Maps (authenticated, except GET /:id which uses optional auth):**
| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/maps` | Create a map (owner = current user) |
| `GET` | `/api/maps` | List the user's owned and shared maps with their items |
| `GET` | `/api/maps/:id` | Load map metadata, items and the caller's role. **Optional auth**: public maps are served to anyone, private maps need a session and access |
| `PUT` | `/api/maps/:id` | Update `name`, `family_name` or `export_settings` (owner/editor) |
| `DELETE` | `/api/maps/:id` | Delete the map, its items, shares and R2 print images (owner only); 409 if any order references the map |
| `POST` | `/api/maps/:id/duplicate` | Copy a readable map and its items into a new private map owned by the caller |

**Items (authenticated, owner/editor only):**
| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/maps/:id/stops` | Add a point or route (type, name, lat, lng, label, icon; routes also `travel_mode`, defaulting to `drive`, plus `dest_name`, `dest_lat`, `dest_lng`, `dest_icon`). Position is assigned server-side; at most 200 items per map |
| `PUT` | `/api/maps/:id/stops/:stop_id` | Update name, label, lat/lng, icon, `dest_*`, `travel_mode` or `route_geometry`. Geometry is cleared when coordinates or `travel_mode` change; `type` is immutable (400); position changes only via `/reorder` |
| `DELETE` | `/api/maps/:id/stops/:stop_id` | Remove an item and close the gap in positions |
| `PUT` | `/api/maps/:id/stops/reorder` | Set positions from `{ order }`, which must list every item id once |

**Sharing (authenticated, owner only except claim and duplicate):**
| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/maps/:id/shares` | List collaborators and open invites; claimed tokens and expired invites are hidden |
| `POST` | `/api/maps/:id/shares` | Create an invite (role). Returns `{ id, claim_token, claim_token_expires_at, role }`; the frontend builds the invite URL. 60/min per user |
| `PUT` | `/api/maps/:id/shares/:share_id` | Update a collaborator's role |
| `DELETE` | `/api/maps/:id/shares/:share_id` | Remove a collaborator or invite |
| `PUT` | `/api/maps/:id/visibility` | Set public or private |
| `POST` | `/api/shares/claim/:token` | Claim an invite and return `{ map_id }` (any signed-in user, 60/min per user) |

**User preferences (authenticated):**
| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/user/preferences` | Current user's preferences (`{ units }`, null until set) |
| `PUT` | `/api/user/preferences` | Update `units` (`'km' \| 'mi'`) |

**Proxy (authenticated, 30/min per user):**
| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/geocode?q=...` | Proxy Photon geocoding (KV-cached) |
| `POST` | `/api/route` | Proxy one ORS segment: `{profile, start: [lon,lat], end: [lon,lat]}` → GeoJSON (KV-cached per segment and profile). Plane and boat segments never call it |

**Print (authenticated):**
| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/images/:mapId` | Upload a raw `image/png` body with `Content-Length` (≤100 MB) to R2 (owner/editor); returns `{ key, url }` |
| `GET` | `/api/images/*` | Serve an R2 image (public, unguessable key) |
| `POST` | `/api/print-quote` | Prodigi shipping quote (SKU + size + country → USD cost; 422 when it cannot ship there) |
| `POST` | `/api/checkout` | Check the uploaded image, quote shipping, create a Stripe Checkout session (1 h expiry) and insert a `pending_payment` order |
| `GET` | `/api/orders` | List the user's orders, excluding unpaid checkouts |
| `GET` | `/api/orders/:id` | Single order for the current user, with map name |

**Admin (Bearer token, not user-facing):**
| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/admin/orders` | List orders, optional `?status=` filter |
| `GET` | `/api/admin/orders/:id` | Single order with map name and user email |
| `PATCH` | `/api/admin/orders/:id` | Set `image_url`; `action: 'submit_to_prodigi'` submits a `paid` or `pending_render` order that has an image and a valid address (502 on Prodigi failure) |

All admin routes require `Authorization: Bearer {ADMIN_SECRET}`, compared in constant time, and reject every request when the secret is unset.

**Webhooks (no session auth):**
| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/webhooks/stripe` | Handle `checkout.session.completed` when paid, `async_payment_succeeded`, `async_payment_failed` and `expired`. Signature-verified; idempotent by atomically moving the order out of `pending_payment`; failed and expired sessions delete the unpaid order |
| `POST` | `/api/webhooks/prodigi` | Handle Prodigi order callbacks. The payload is only a hint; the order is re-read with `GET /orders/{id}`. 60/min per IP |

**Health:**
| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/health` | Returns `{ status: 'ok' }` |

### Bindings (wrangler.toml)
- **D1 Database:** `DB` → `roadtrip-db`
- **KV Namespace:** `API_CACHE`
- **R2 Bucket:** `ROADTRIP_PRINTS` → `roadtrip-prints`
- **Rate Limiters:** `RATE_LIMITER_PUBLIC` (60/min), `RATE_LIMITER_PROXY` (30/min), `RATE_LIMITER_AUTH` (10/min)
- **Static assets:** `../dist` with SPA fallback; `run_worker_first = ["/api/*"]` sends only API paths through the Worker

### Secrets (via `wrangler secret put`)
- `BETTER_AUTH_SECRET`: session signing key
- `BETTER_AUTH_URL`: canonical app URL. Used for Better Auth's `baseURL`, `trustedOrigins` and passkey `rpID`/`origin`, the CSRF check, Stripe return URLs, and the image URL and `callbackUrl` sent to Prodigi (callbacks only when it is https)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- `FACEBOOK_CLIENT_ID` / `FACEBOOK_CLIENT_SECRET`
- `STRIPE_SECRET_KEY`: a test-mode key (`sk_test_` or `rk_test_`) never auto-submits to live Prodigi
- `STRIPE_WEBHOOK_SECRET`
- `PRODIGI_API_KEY`
- `PRODIGI_SANDBOX`: `"true"` selects the Prodigi sandbox API; anything other than true, 1, yes or on selects live
- `ORS_API_KEY`: OpenRouteService Directions API key (free tier)
- `ADMIN_SECRET`: Bearer token protecting `/api/admin/*`
- `DISCORD_WEBHOOK_URL`: optional; order notifications are skipped when unset

Local values live in `worker/.dev.vars`. `Env` is generated into `worker/worker-configuration.d.ts` from `wrangler.toml` and the secret names in `.dev.vars`; run `cd worker && npm run types` after changing bindings or secret names.

### Payment + Fulfillment Flow

The client renders the map at 300 DPI, capped to the device's canvas limit, before checkout. If rendering or upload fails, the order page shows an error and checkout does not start.

```
Owner or editor opens /order/:id from the export page
  → Frontend calls POST /api/print-quote (SKU, size, country) → Worker asks Prodigi → USD shipping cost, or 422 if it cannot ship there
  → Frontend shows product price + shipping; Order stays disabled until a quote succeeds
  → User clicks "Order Print" → client renders the map with renderToBlob()
  → Client uploads the PNG → POST /api/images/:mapId → R2 key
  → Frontend calls POST /api/checkout (map ID, SKU, size, shipping address, image key)
  → Worker checks the image key exists under the map and quotes shipping (502 on quote failure, 422 if it cannot ship there)
  → Worker creates the Stripe Checkout session (product + shipping line items, order ID in metadata, 1 h expiry)
  → Worker inserts the order row (status: 'pending_payment') and returns the session URL
  → User pays on Stripe
  → Stripe → POST /api/webhooks/stripe (signature-verified)
  → completed with payment_status 'paid', or async_payment_succeeded:
      Worker atomically moves the order out of 'pending_payment' and stores the buyer email
      (a repeat delivery matches nothing and is acknowledged)
      → [Auto path] image and parseable address → 'paid' → background submit to Prodigi → 'submitted'
      → [Test mode] Stripe test key with live Prodigi → stays 'paid' for an admin
      → [Review path] no image, unparseable address, or Prodigi submission failed → 'pending_render'
      → Discord notification in every case (when DISCORD_WEBHOOK_URL is set)
  → expired or async_payment_failed:
      Worker deletes the unpaid order and its print image unless another order uses it
  → Prodigi prints and ships direct to the customer
  → Prodigi calls the order's callbackUrl → POST /api/webhooks/prodigi
  → Worker re-reads the order (GET /orders/{id}) and updates status + tracking URL, never moving it backwards

--- Manual fulfillment (paid or pending_render) ---
  → Admin sees the order (Discord notification or /admin)
  → Admin calls PATCH /api/admin/orders/:id { image_url?, action: 'submit_to_prodigi' } (Bearer token)
  → Worker places the Prodigi order → status: 'submitted' (502 on Prodigi failure)
```

**Confirmation page copy:** "We're preparing your map for print. Check this page or your dashboard for its status and tracking link." This covers every path without exposing the manual step. While payment is still confirming, the page polls the order.

---

## Milestones

Milestones 1–5 are sequential; each builds on the prior one. After M5, milestones 6 and 7 are semi-independent. M8 is a polish pass across everything. M9 depends on M7, because export renders the image that gets uploaded for printing.

### Milestone 1: Scaffold & Navigation Shell
- **Goal:** App boots, theme works, you can click between pages.
- **Scope:** Vite + Lit app with the Web Awesome theme and Jelly kit; DIY router and app shell; landing page; Hono Worker serving the API and the SPA.
- **Status:** Complete.

### Milestone 2: Authentication
- **Goal:** Users can sign up, sign in, and see a protected dashboard.
- **Scope:** D1 schema; Better Auth with Google, Facebook and passkey-first registration; auth middleware; client auth state, route guard and sign-in page; user menu; dashboard.
- **Status:** Complete. The real-browser passkey and OAuth checks are in the Deployment checklist.

### Milestone 3: Map Display & Geocoding
- **Goal:** A working map with place search.
- **Scope:** `map-view` wrapping MapLibre with the kid-drawn style; `/api/geocode` Photon proxy with KV cache; `location-search` autocomplete.
- **Status:** Complete.

### Milestone 4: Trip Builder (CRUD)
- **Goal:** Users can create trips, add and reorder items, and everything persists.
- **Scope:** Map and item CRUD routes with role checks; `services/maps.ts`; trip builder with drag-and-drop reorder and debounced auto-save; icon picker; dashboard map cards.
- **Status:** Complete.

### Milestone 5: Route Drawing
- **Goal:** Colored, mode-specific route segments connect the trip's stops on the map.
- **Scope:** `/api/route` ORS proxy with KV cache; `services/routing.ts` with client-side plane arcs and boat lines; per-mode line layers; travel mode picker; distance totals in km or miles.
- **Status:** Complete.

### Milestone 6: Sharing & Collaboration
- **Goal:** Maps can be shared through invite links or made public.
- **Scope:** Point and route item model; sharing routes and share dialog; claim page; read-only public view with "Duplicate this trip"; "Shared with Me" on the dashboard.
- **Status:** Complete.

### Milestone 7: Export (PDF / Image)
- **Goal:** Users can download print-quality maps.
- **Scope:** Preview page with paper frame and saved framing; offscreen 300 DPI render; PNG, JPEG and PDF downloads with an optional poster layout; export page with poster mockup.
- **Status:** Complete.

### Milestone 8: Polish & Launch Prep
- **Goal:** Production-ready quality.
- **Scope:** Responsive layouts (split panel on desktop, drawer on mobile); loading, error and empty states; map attribution; dark mode; locale-based units.
- **Status:** Complete. Launch steps are in the Deployment checklist.

### Milestone 9: Print Ordering (Stripe + Prodigi)

**Goal:** Users can order a printed poster and receive it in the mail.

**Status:** Built. The Verify checks below are pending.

*Depends on M7: export renders the image that gets uploaded for printing.*

#### Product Catalog (`shared/products.ts`)

Two product types with three sizes each:

| Product | SKU Prefix | 18×24" | 24×36" | 40×60" |
|---------|-----------|--------|--------|--------|
| **Budget Poster** (silk) | GLOBAL-BLP | $29.99 | $39.99 | $49.99 |
| **Eco Rolled Canvas** (museum-quality) | ECO-ROL | $39.99 | $49.99 | $59.99 |

Shipping is always a live Prodigi quote (Budget method, USD); ordering is blocked until one succeeds.

#### Database Schema

The `orders` table in `0001_initial.sql`:
- **Core:** `id`, `map_id` (FK → maps, RESTRICT), `user_id` (FK → user, RESTRICT)
- **Product:** `product_type` (poster/canvas), `product_sku` (full Prodigi SKU), `poster_size` (18x24/24x36/40x60)
- **Payment:** `stripe_session_id` (UNIQUE), `subtotal` and `shipping_cost` (cents), `currency`
- **Fulfillment:** `status`, `prodigi_order_id`, `image_url` (`/api/images/<key>`), `shipping_address` (JSON), `customer_email`, `tracking_url`
- **Observability:** `discord_notified` flag, `created_at`, `updated_at`

#### Order Lifecycle

```
1. Owner or editor clicks "Order a Print" on the export page
2. /order/:id: select product + size, enter shipping address
3. Shipping quote fetched from Prodigi (500 ms debounce); Order stays disabled until it succeeds.
   A warning shows when this device would render the size below 150 DPI
4. "Order Print" → render map PNG (300 DPI, capped to the canvas limit) → upload to R2
   → checkout re-quotes shipping, creates the Stripe session and the pending_payment order → redirect
5. User pays on Stripe → webhook moves the order out of pending_payment
6. Image and address valid: auto-submit to Prodigi (status: submitted).
   Otherwise, or if submission fails: status = pending_render (admin submits via /admin).
   A Stripe test key with live Prodigi leaves the order at paid for an admin
7. Abandoned checkout (the session expires after 1 h) or failed delayed payment: the webhook deletes the order and its unshared image
8. Prodigi callbacks trigger a re-read of the order: in_production → shipped (+ tracking URL) → completed
9. User sees status + tracking on /order-confirmation/:orderId and the dashboard
```

#### API Routes (`worker/src/routes/orders.ts`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/images/:mapId` | Owner/Editor | Upload print image to R2 (raw `image/png` body with Content-Length, ≤100 MB) |
| GET | `/api/images/*` | Public | Serve R2 images (1-year immutable cache) |
| POST | `/api/checkout` | Auth | Quote shipping, create Stripe Checkout session (1 h expiry), insert order row |
| POST | `/api/print-quote` | Auth | Prodigi shipping quote (SKU + size + country → USD cost; 422 when it cannot ship there) |
| GET | `/api/orders` | Auth | List user's orders, excluding unpaid checkouts (100 max) |
| GET | `/api/orders/:id` | Auth | Single order with map name |
| GET | `/api/admin/orders` | Bearer | List orders (200 max, optional `?status=` filter) |
| GET | `/api/admin/orders/:id` | Bearer | Single order with user email |
| PATCH | `/api/admin/orders/:id` | Bearer | Update image_url or submit to Prodigi |

#### Webhook Routes (`worker/src/routes/webhooks.ts`)

**Stripe** (`POST /api/webhooks/stripe`):
- Verifies the signature. Handles `checkout.session.completed` (only when `payment_status` is `paid`), `async_payment_succeeded`, `async_payment_failed` and `expired`; the last two delete the unpaid order and its unshared print image
- Idempotent via a conditional `UPDATE ... WHERE status = 'pending_payment'`; a repeat delivery changes no row and is acknowledged
- Auto-submits to Prodigi in `waitUntil` if the order has an image and a parseable address, falling back to `pending_render`
- Skips auto-submit when a Stripe test key is paired with live Prodigi; the order stays `paid` for an admin
- Sends a Discord notification

**Prodigi** (`POST /api/webhooks/prodigi`, unauthenticated; the order is re-read via `GET /orders/{id}`):
- Status mapping: `InProgress` → `in_production`, or `shipped` once any shipment is `Shipped` (stores an http(s) tracking URL); `Complete` → `completed`; `Cancelled` → `cancelled` (Discord alert). A late callback never moves an order backwards

#### Client Pages

**Order Page** (`/order/:id`):
- Product radio group + size picker
- Shipping address form (name, two address lines, city, state, postal code, country from `utils/countries.ts`)
- Real-time Prodigi shipping quote (debounced); Order stays disabled until a quote succeeds
- Warning below 150 effective DPI; ordering is never blocked on resolution
- Multi-step flow: form → rendering → uploading → Stripe redirect
- Error handling with retry UI

**Order Confirmation** (`/order-confirmation/:orderId`):
- Order reference (`orderRef()`: first 8 characters, uppercase), status badge, tracking link; polls while payment is confirming

**Admin Page** (`/admin`, requires sign-in):
- Admin secret entered on the page and kept in sessionStorage
- Order table filterable by status (ID, user, map, product, size, image, status, date)
- "Submit to Prodigi" action for `paid` and `pending_render` orders that have an image

#### Integration Libraries (`worker/src/lib/`)

- **stripe.ts**: Stripe SDK; its workerd build uses fetch and SubtleCrypto, and requests use the SDK's pinned API version
- **prodigi.ts**: `getShippingQuote()` (POST `/v4.0/quotes`, Budget shipping in USD; throws `ProdigiNotAvailableError` when the item cannot ship), `createOrder()` (POST `/v4.0/orders`; order ID as idempotency key and merchant reference, buyer email, `callbackUrl` on https origins) and `getOrder()` (GET `/v4.0/orders/{id}`); sandbox or live via `PRODIGI_SANDBOX`
- **orders.ts**: `submitOrderToProdigi()`, shared by the Stripe webhook and the admin route; marks the order `submitted`
- **discord.ts**: webhook POST for order notifications

#### Client Service (`src/services/orders.ts`)

Typed API wrappers: `uploadPrintImage()`, `createCheckout()`, `getOrder()`, `listOrders()`, `getPrintQuote()`

#### Component Integrations

- **export-page.ts**: "Order a Print" button for owners and editors; the order page offers only printable sizes
- **dashboard-page.ts**: "Print Orders" section with status badges and tracking links
- **app-shell.ts**: Routes `/order/:id`, `/order-confirmation/:orderId` and `/admin`, all behind `requireAuth`

#### Environment Variables

| Variable | Purpose |
|----------|---------|
| `STRIPE_SECRET_KEY` | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature verification |
| `PRODIGI_API_KEY` | Prodigi API key |
| `PRODIGI_SANDBOX` | `"true"` for sandbox API |
| `ADMIN_SECRET` | Bearer token for `/api/admin/*` |
| `DISCORD_WEBHOOK_URL` | (optional) Order event notifications |
| `ROADTRIP_PRINTS` (R2) | Print image storage bucket |

#### Dependencies

- `stripe` in worker/package.json

#### Key Design Decisions

- **Idempotency:** Conditional status claim on the Stripe webhook; the order ID is Prodigi's idempotency key
- **Server-side shipping:** Checkout quotes shipping itself; a failed quote refuses checkout (502)
- **Graceful degradation:** A failed Prodigi auto-submit leaves the order at `pending_render` for an admin
- **Test safety:** A Stripe test key never auto-submits to live Prodigi; manual admin submission stays allowed
- **Untrusted callbacks:** Prodigi callbacks only trigger a re-read from the Prodigi API, and status never moves backwards
- **Security:** Admin routes use a Bearer token, webhooks skip CSRF, R2 images use unguessable UUIDs
- **Financial integrity:** Orders RESTRICT deletion of their map and user; deleting a map with orders answers 409
- **Observability:** Discord notification after payment (submitted, needs review, or test mode) and on a Prodigi cancellation

**Verify:**
- Image uploaded, checkout completes, webhook places the Prodigi sandbox order automatically (status: `submitted`)
- Missing upload: checkout is refused with 400 `Invalid image_key`
- A Prodigi failure after payment leaves the order at `pending_render` and notifies Discord
- Admin calls `PATCH /api/admin/orders/:id` with the submit action → Prodigi sandbox order placed, status `submitted`
- Stripe webhook idempotency: the same event delivered twice → one claim, one Prodigi order
- An abandoned checkout's order and image are deleted when the session expires, and the map can then be deleted
- Stripe Checkout with test keys and test card numbers
- A Prodigi callback updates status and tracking in D1
- Order confirmation page shows appropriate copy at each status
- End-to-end: sign up → create map → add stops → order print → pay → confirm order → track shipment

---

## Deployment

| Component | Platform | How |
|-----------|----------|-----|
| **Worker (API + SPA)** | Cloudflare Workers | `npm run build` at the root, then `cd worker && npm run deploy`. One Worker serves the API and the Vite-built static assets |
| **D1 Database** | Cloudflare D1 | `wrangler d1 create roadtrip-db`, copy the id into `wrangler.toml`, then `wrangler d1 migrations apply roadtrip-db --remote` |
| **KV Namespace** | Cloudflare KV | `wrangler kv namespace create API_CACHE`; its id goes in `wrangler.toml` |
| **R2 Bucket** | Cloudflare R2 | `wrangler r2 bucket create roadtrip-prints` |

Single-origin deployment: one Worker handles everything. A custom domain (e.g. `kidsroadtripmap.com`) points to the Worker, and `BETTER_AUTH_URL` is set to its HTTPS origin.

**OAuth provider setup (one-time):**
- Google: Create an OAuth app at console.cloud.google.com with redirect URI `{app_url}/api/auth/callback/google`
- Facebook: Create an app at developers.facebook.com with redirect URI `{app_url}/api/auth/callback/facebook`

### Local development
- `npm run dev:full` builds the frontend, applies local migrations and serves everything from `wrangler dev` at `http://localhost:8787`, which matches `BETTER_AUTH_URL` in `worker/.dev.vars`. Use it for sign-in, passkeys and every flow that changes data
- `npm run dev` runs Vite on :5173 and proxies `/api` to `wrangler dev` on :8787, which must run alongside (`cd worker && npm run dev`). The CSRF check and Better Auth see Origin :5173 and reject state-changing calls, so it suits UI work against read-only endpoints
- LAN IPs from `wrangler dev --ip 0.0.0.0` are not secure contexts, so test passkeys on other devices through an HTTPS tunnel such as `cloudflared`, with `BETTER_AUTH_URL` set to the tunnel origin
- `0001_initial.sql` is edited in place. If `migrate:local` applies nothing but local tables lack its columns or CHECK constraints, delete `worker/.wrangler/state/v3/d1` and rerun `cd worker && npm run migrate:local`. This clears local users, sessions and maps
- Orders carry a Prodigi `callbackUrl` only when `BETTER_AUTH_URL` is https, so orders placed from plain localhost never receive callbacks

### Before first real purchase
1. **Provision D1:** create `roadtrip-db`, replace the placeholder `database_id` in `worker/wrangler.toml`, and apply the migration with `--remote`.
2. **Set secrets:** run `wrangler secret put` for every secret listed under Secrets, with `BETTER_AUTH_URL` set to the canonical HTTPS origin.
3. **Delete the unused Prodigi secret:** `wrangler secret delete PRODIGI_WEBHOOK_SECRET`, and remove it from any local `worker/.dev.vars`.
4. **Register the Stripe webhook:** create an endpoint at `{app_url}/api/webhooks/stripe` using the API version the `stripe` SDK pins, and store its signing secret as `STRIPE_WEBHOOK_SECRET`.
5. **Subscribe the Stripe events:** `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` and `checkout.session.expired`. Without the last three, delayed payments never settle and unpaid orders are never deleted.
6. **Smoke-test passkeys and OAuth on the HTTPS tunnel**, with `BETTER_AUTH_URL` and the OAuth redirect URIs set to the tunnel origin:
   - Register a new email; cancel the prompt once, then retry with the same email
   - Register an email that already has an account: the message appears before any prompt
   - Register while signed in: the visitor is signed out and a new account is created
   - Sign in usernamelessly with the new passkey
   - Sign in with Google and with Facebook using a passkey account's email: both land on `/sign-in` with the "different method" message
7. **Run a Prodigi sandbox order end to end** with `PRODIGI_SANDBOX=true`, a Stripe test key and an https `BETTER_AUTH_URL`: pay with a test card, confirm the order reaches `submitted`, a Prodigi callback updates its status and tracking, and an abandoned checkout's order is deleted when its session expires.
