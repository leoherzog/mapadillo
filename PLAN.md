# Kids Roadtrip Map — Implementation Plan

## Context

A family-oriented web app where a parent/organizer enters road trip locations, and the app generates a bright, kid-friendly printable map. The map can be exported as PDF/image or ordered as a printed-and-mailed poster via Prodigi. The UI uses Web Awesome Pro components with Font Awesome Pro Jelly icons for a playful, childlike aesthetic.

**User accounts via Better Auth.** Sign in with Google or Facebook, or create an account with a Passkey (WebAuthn — biometrics, hardware key, or platform authenticator). Passkeys are the primary passwordless option; OAuth is the fallback/recovery path. Maps are owned by the creating user. Sharing model: **Owner** (full control + delete), **Editor** (modify stops/labels/style), **Viewer** (read-only). Maps can be **public** (viewable by anyone with the link, forkable) or **private** (accessible only to explicitly shared users). Shareable via URL (`/map/{id}`).

**International scope.** No geographic bias — supports road trips anywhere in the world. Km/miles toggle. Prodigi ships globally.

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Framework** | Vite + Lit (TypeScript) | Web Awesome Pro is built on Lit — zero impedance mismatch, same component model throughout |
| **UI Components** | Web Awesome Pro (`@awesome.me/webawesome`) v3.2.x | 50+ web components, playful theme + bright color palette for kid-friendly out-of-the-box look |
| **Icons** | Font Awesome Pro+ Jelly icons (via Kit code) | Rounded, bubbly icon style perfect for children's UI (requires Pro+ subscription) |
| **Map Renderer** | MapLibre GL JS v5.x | Open-source, WebGL vector maps, great styling control, print export support |
| **Map Tiles** | OpenFreeMap (free, no API key, unlimited) | Free OpenStreetMap vector tiles, commercial use allowed |
| **Map Style** | OpenFreeMap "Bright" style (customize later in Maputnik) | Ship with Bright as-is for MVP; kid-friendly customization is a future pass |
| **PDF/Image Export** | `@watergis/maplibre-gl-export` + jsPDF | Export control plugin for MapLibre + jsPDF for decorative print layout |
| **Print Service** | Prodigi API (print-on-demand) | Best developer API, free sandbox, CloudEvents webhooks, poster sizes 4x6" to 40x60", no minimums |
| **Payments** | Stripe Checkout | We charge customer via Stripe, then place fulfillment order with Prodigi at wholesale cost |
| **Auth** | Better Auth (`better-auth`) | TypeScript-first auth library with native D1 support (v1.5+), OAuth providers, session management |
| **Auth Providers** | Google, Facebook, Passkeys (WebAuthn) | OAuth covers ~90%+ of parent demographic; Passkeys add a passwordless native option (biometrics/hardware key) with no third-party dependency |
| **Database** | Cloudflare D1 (SQLite) | Serverless SQL for relational data: users, sessions, maps, sharing permissions. Better Auth v1.5+ auto-detects D1 bindings |
| **Backend + Hosting** | Cloudflare Workers (Hono) + D1 + KV + R2 | Single-origin deployment: Hono serves both the API and the Vite-built SPA static assets. No CORS needed, simple cookie auth. D1 for relational data, KV for API caching, R2 for print images |
| **Geocoding** | Photon by Komoot (`photon.komoot.io`) | Free OSM geocoder with no strict rate limit. Good autocomplete support. No API key required |
| **Routing** | DIY (URLPattern + Navigation API) | Zero-dependency Lit reactive controller (~150-200 LOC). Both URLPattern and Navigation API are Baseline cross-browser. Navigation API provides built-in scroll restoration, focus management, and View Transitions integration for free |

---

## Core User Flow

```
1. Landing Page → "Plan Your Road Trip!"
2. Sign In / Sign Up
   - Google, Facebook OAuth buttons
   - "Sign in with a Passkey" option (WebAuthn — biometrics, hardware key)
   - New users registering via passkey enter an email address first, then browser prompts for biometric/authenticator
   - Redirect to dashboard after auth
3. Dashboard ("My Maps")
   - List of maps the user owns
   - List of maps shared with the user (with role badge: Editor / Viewer)
   - "Create New Trip" button
4. Trip Builder Page (requires auth, Owner or Editor role)
   - Enter trip name, family name
   - Add locations (search/autocomplete via geocoding)
   - Reorder stops via drag-and-drop
   - See live map preview with route + markers
   - Debounced auto-save (2-3 sec idle) to D1 via map ID, with save indicator
5. Map Preview / Customize Page
   - Full-screen kid-friendly map with route drawn
   - Toggle fun markers/stickers for each stop
   - Add custom labels ("Grandma's House!", "Beach Day!")
   - Choose map style options (colors, decorations)
   - Share controls: set public/private, generate invite links for collaborators (Viewer or Editor)
   - Share link: /map/{id} (public maps viewable by anyone, with "Duplicate this trip" to fork)
6. Export Page (requires auth)
   - Download as PDF (print-quality 150 DPI)
   - Download as PNG/JPEG image
   - "Order a Print!" → select poster size, enter shipping address → Stripe Checkout
7. Order Confirmation
   - Stripe payment confirmed via webhook → Worker places Prodigi order
   - Tracking info displayed on confirmation page
```

---

## Project Structure

```
kids-roadtrip-map/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── .npmrc                          # FA/WA Pro registry + token
├── src/
│   ├── index.ts                    # Entry point, router setup
│   ├── router.ts                   # DIY router (URLPattern + Navigation API reactive controller)
│   ├── styles/
│   │   ├── theme.css               # WA Playful theme overrides, bright kid palette
│   │   └── global.css              # App-wide styles
│   ├── auth/
│   │   ├── auth-client.ts          # Better Auth client instance + helpers
│   │   ├── auth-guard.ts           # Route guard: redirect to sign-in if unauthenticated
│   │   └── auth-state.ts           # Reactive auth state (current user, session)
│   ├── map/
│   │   ├── kid-friendly-style.json # Custom MapLibre style (from Maputnik)
│   │   ├── sprites/                # Custom map icon sprites (fun markers)
│   │   ├── map-controller.ts       # MapLibre map init, route drawing, markers
│   │   └── map-export.ts           # PDF/image export logic
│   ├── pages/
│   │   ├── landing-page.ts
│   │   ├── sign-in-page.ts         # OAuth buttons (Google, Facebook, Apple)
│   │   ├── dashboard-page.ts       # "My Maps" + "Shared with me" lists
│   │   ├── trip-builder-page.ts
│   │   ├── map-preview-page.ts
│   │   ├── export-page.ts
│   │   └── order-confirmation-page.ts
│   ├── components/
│   │   ├── location-search.ts      # Geocoding autocomplete
│   │   ├── stop-list.ts            # Drag-and-drop trip stops
│   │   ├── stop-card.ts            # Individual stop with label/icon
│   │   ├── map-view.ts             # MapLibre GL wrapper component
│   │   ├── map-card.ts             # Map thumbnail card for dashboard
│   │   ├── share-dialog.ts         # Share settings: public/private, generate invite links, role picker
│   │   ├── export-options.ts       # PDF/image/print selection
│   │   ├── print-order-form.ts     # Size, address, Stripe checkout
│   │   ├── user-menu.ts            # Avatar, sign-out, account dropdown
│   │   └── app-shell.ts            # Layout wrapper (header with user-menu, nav, footer)
│   └── services/
│       ├── api-client.ts           # Base fetch wrapper (attaches auth session cookie)
│       ├── maps.ts                 # CRUD for maps + stop sub-resource API calls
│       ├── geocoding.ts            # Calls Worker proxy → Photon
│       ├── routing.ts              # Calls Worker proxy → OpenRouteService
│       ├── image-upload.ts         # Renders map image, uploads to R2 via Worker
│       ├── stripe.ts               # Stripe Checkout session creation
│       └── print-order.ts          # Prodigi order placement
├── worker/                         # Cloudflare Worker backend
│   ├── wrangler.toml               # Worker config, D1 + KV + R2 bindings
│   ├── src/
│   │   ├── index.ts                # Worker entry — Hono router + Better Auth handler
│   │   ├── auth.ts                 # Better Auth server instance (D1 adapter, OAuth config)
│   │   ├── middleware/
│   │   │   └── require-auth.ts     # Hono middleware: validate session, attach user to context
│   │   ├── routes/
│   │   │   ├── maps.ts             # CRUD: map metadata + stops sub-resource (D1), ownership checks
│   │   │   ├── sharing.ts          # Generate invite links (claim tokens), update roles, claim invites
│   │   │   ├── checkout.ts         # Create Stripe Checkout session
│   │   │   ├── stripe-webhook.ts   # Handle Stripe payment confirmation
│   │   │   ├── print-order.ts      # Place Prodigi fulfillment order
│   │   │   ├── geocode.ts          # Proxy Photon geocoding (with KV cache)
│   │   │   ├── route.ts            # Proxy OpenRouteService routing (with KV cache)
│   │   │   └── images.ts           # Upload/serve print-ready images (R2)
│   │   ├── db/
│   │   │   ├── schema.sql          # D1 schema: users, sessions, accounts, maps, stops, map_shares
│   │   │   └── migrations/         # D1 migration files
│   │   └── lib/
│   │       ├── prodigi.ts          # Prodigi API client
│   │       └── stripe.ts           # Stripe API helpers
│   └── package.json
└── public/
    ├── fonts/
    └── images/                     # Landing page art, decorative elements
```

---

## Key Implementation Details

### Authentication (Better Auth)
- **Library:** `better-auth` v1.5+ — native D1 support via `database: env.DB` (no separate adapter package needed)
- **OAuth providers:** Google, Facebook (configured under `socialProviders`)
- **Passkeys:** Better Auth `passkey` plugin (WebAuthn). Registration flow: user enters email → browser prompts for biometric/authenticator → credential stored in D1 against user record. Sign-in flow: user clicks "Sign in with Passkey" → browser shows passkey picker → authenticates. Not used as MFA — it is the primary auth method for users who choose it
- **Account recovery:** Users who registered via passkey but lose their authenticator can sign in via OAuth (Google/Facebook) if they used the same email address — Better Auth links accounts by email. This makes OAuth the natural recovery path
- **Session management:** Cookie-based sessions in D1; use cookie cache (short-lived signed cookie) to avoid stale D1 reads after writes
- **Server setup:** Better Auth instance created in `worker/src/auth.ts`, mounted on `/api/auth/*` in Hono
- **Client setup:** `createAuthClient()` from `better-auth/client` in `src/auth/auth-client.ts`; namespaced methods: `signIn.social({ provider })`, `signIn.passkey()`, `signUp.email()` (for passkey registration), `signOut()`, `useSession()`
- **Route protection:** Hono middleware (`require-auth.ts`) validates session and attaches user to request context; frontend auth guard in router redirects unauthenticated users to sign-in page
- **OAuth app setup required:**
  - Google: Google Cloud Console → OAuth consent screen + credentials
  - Facebook: Meta Developer Portal → Facebook Login app
- **Passkey setup:** No third-party registration required. WebAuthn origin must match the deployed domain (`https://kidsroadtripmap.com`). Passkeys do not work on `localhost` without HTTPS — use `wrangler dev --local` with a self-signed cert or test via a tunnel (e.g., `cloudflared tunnel`) during development

### Sharing & Permissions
- **Roles:** Owner (creator, full control + delete), Editor (modify stops/labels/style), Viewer (read-only)
- **Visibility:** Each map has a `visibility` field: `private` (default) or `public`
  - **Public maps:** Anyone with the link can view (no auth required). Authenticated users can "Duplicate this trip" to fork
  - **Private maps:** Only the owner and explicitly shared users can access
- **Sharing by invite link:** Owner generates a shareable invite link with a role (Viewer or Editor). `POST /api/maps/:id/shares` creates a `map_shares` row with a unique `claim_token` and the chosen `role`. The frontend displays a copyable invite URL (e.g., `https://app/claim/{token}`). Owner shares the link however they want (text, chat, email, etc.)
- **Auto-claim:** When an authenticated user visits `/claim/{token}`, the Worker automatically sets `user_id` on the share row and redirects to the map. No intermediate "accept" step — clicking the link while signed in is the claim. If not signed in, redirect to sign-in with a return URL back to the claim link
- **Access checks:** Every map API route checks: (1) is user the owner? (2) does user have a share record with `user_id` populated? (3) is the map public and this a read request? Unauthorized → 403
- **D1 tables:** `map_shares` table with `map_id`, `user_id`, `role`, `claim_token`, `created_at`

### Client-Side Routing (DIY)
- **No library dependency.** Custom Lit reactive controller (~150-200 LOC) using `URLPattern` + Navigation API
- **URLPattern** is Baseline cross-browser as of Sept 2025 — no polyfill needed for evergreen browsers
- **Navigation API** is Baseline cross-browser as of early 2026 — replaces manual History API usage
- **Route config:** Array of `{ path, render, enter? }` objects. `path` compiles to a `URLPattern`. `render` returns a `TemplateResult`. Optional async `enter()` hook for auth guards and lazy loading
- **Navigation:** Single `navigation.addEventListener('navigate', ...)` handler captures all navigation types (link clicks, form submissions, back/forward, programmatic). No manual `<a>` click interception or `popstate` listener needed
- **Scroll restoration:** Built-in via Navigation API (`scroll: "after-transition"` or manual `navigateEvent.scroll()`) — no custom implementation needed
- **Focus management:** Built-in via Navigation API — accessibility for free
- **View Transitions:** Navigation API integrates with the View Transitions API for animated page transitions
- **Auth guard pattern:** `navigate` event handler checks session state before committing navigation; calls `e.preventDefault()` and `navigation.navigate('/sign-in')` if unauthenticated
- **Lazy loading:** `e.intercept({ handler })` runs async `import('./pages/some-page.ts')` before the navigation completes — the browser waits for the handler promise to resolve
- **SPA hosting:** The Worker serves the Vite-built static assets for non-API routes and falls back to `index.html` for SPA routing (no separate Pages deployment needed)

### Map Style
- **MVP:** Use OpenFreeMap "Bright" style as-is — it's clean and colorful enough to ship
- **Future:** Fork in [Maputnik](https://maplibre.org/maputnik/) to create a kid-friendly variant:
  - Saturated candy colors (bright blue water, vivid green parks, warm yellow roads)
  - Larger, bolder labels with thick halos
  - Rounded, thick road casings for hand-drawn feel
  - Simplified layers (hide clutter at low zoom)
- Custom sprite sheet with playful marker icons drawn from the curated Jelly icon set (see Map Elements below)
- Export as `kid-friendly-style.json`, serve from app

### Map Elements

Maps contain two types of user-added elements: **points** (stops) and **segments** (travel between consecutive stops).

#### Points (Stops)
- Each stop has a name, optional custom label, lat/lng, and an **icon** chosen from the curated Jelly picker
- Icon picker shows a categorized grid of ~41 confirmed Jelly icons (verified against `@awesome.me/kit-781a3c6be3` metadata):

| Category | Icons |
|----------|-------|
| Outdoors | `tree`, `leaf`, `flower`, `compass`, `fire`, `snowflake`, `sun`, `umbrella` |
| Food & Drink | `utensils`, `mug-hot`, `cake-candles`, `martini-glass`, `fish` |
| Sightseeing | `camera`, `landmark`, `globe`, `ticket`, `crown` |
| Accommodation | `house`, `bed` |
| Fun | `star`, `trophy`, `gift`, `shop`, `paw`, `sparkles` |
| Transport hubs | `plane`, `ship`, `train`, `bus`, `car`, `suitcase` |
| People | `heart`, `anchor` |
| Checklist | `circle`, `square`, `circle-check`, `circle-plus`, `circle-info`, `circle-xmark` |

- **Checklist icons** (`circle`, `square`, `circle-check`, `circle-plus`, `circle-info`, `circle-xmark`) render the stop as an open checkbox on the printed map — purely visual, no interactive state saved. Kids check them off on the paper.
- `person-biking` is available in Jelly but reserved for the route mode picker UI only (not offered as a stop icon)
- Notable icons absent from Jelly: `tent`, `mountain`, `campfire` (use `fire`), `ice-cream`, `burger`/`pizza-slice` (use `utensils`), `umbrella-beach` (use `umbrella`), `bicycle` (use `person-biking` in route UI)

#### Segments (Travel Mode)
- Each segment lives **between two consecutive stops** and carries a `travel_mode`
- Stored as `travel_mode` on the destination stop (the stop you arrive at) — `NULL` on the first stop, which has no incoming segment
- Five modes, each with distinct ORS profile and MapLibre line style:

| Mode | ORS Profile | Line Style | Color |
|------|------------|------------|-------|
| Drive | `driving-car` | Solid thick | Orange |
| Walk | `foot-walking` | Dotted, round caps | Green |
| Bike | `cycling-regular` | Dashed | Teal |
| Plane | — (no ORS) | Dotted + great-circle arc | Blue/purple |
| Boat | — (no ORS) | Long dashes, straight line | Navy |

- **Plane:** Client computes a great-circle arc (interpolated GeoJSON `LineString` points) — no routing call
- **Boat:** Simple straight-line GeoJSON `LineString` between the two stops. ORS has no free sailing profile. Line may visually cross a peninsula at road-trip zoom levels, which is acceptable. If a strait routing matters, users add an intermediate stop as a waypoint
- The mode picker UI uses `person-biking` (Jelly), `car`, `plane`, `ship`, and a walking figure icon for the five modes

### Route Drawing
- Use **OpenRouteService (ORS)** Directions API for routed segments, **proxied through the Worker** with KV caching
- Endpoint: `POST https://api.openrouteservice.org/v2/directions/{profile}/geojson`
- Request body per segment: `{"coordinates": [[start_lon, start_lat], [end_lon, end_lat]]}` — exactly two points, one per segment call
- **One ORS call per routed segment** (Drive/Walk/Bike only). Per-segment calls maximize KV cache hits: two different trips sharing the same leg between cities reuse the cached response. Cache key: `route:{profile}:{hash(start_lon,start_lat,end_lon,end_lat)}`
- Response is a GeoJSON `FeatureCollection` with `LineString` geometry — feeds directly into MapLibre (no decode step)
- Free tier: **2,000 requests/day**, 40/min — per-segment calls keep per-trip request count low
- Auth: API key in `Authorization` header (free signup at openrouteservice.org)
- Each segment rendered as its own MapLibre layer with mode-specific line style (see table above)
- Custom markers at each stop with numbered badges + chosen Jelly icon

### PDF Export
- `@watergis/maplibre-gl-export` renders map at **150 DPI** (sufficient for poster-size prints viewed at arm's length or further; 300 DPI is unnecessary for wall posters and exceeds WebGL canvas limits on many devices)
- **Canvas size limits:** 18x24" at 150 DPI = 2700x3600px (~10 MP), 24x36" at 150 DPI = 3600x5400px (~19 MP). Both are within safe WebGL limits for most devices. Cap max canvas dimension at 5400px as a safety net — if the device can't allocate the canvas, show an error with a "try on desktop" message
- jsPDF wraps the map image in a decorative print layout:
  - Trip title in playful font
  - Family name
  - Stop list with icons
  - Decorative border/stickers
  - Road trip stats (total miles, number of stops)

### Print-and-Mail (Prodigi)
- Poster sizes and **customer-facing prices**:
  - 18x24" — **$19.99**
  - 24x36" — **$29.99**
- Shipping: **separate line item** — Worker calls **Prodigi quote API** before creating Stripe Checkout session to get exact shipping cost for the customer's address + poster size. Shipping cost is passed to Stripe as a separate line item
- Paper: Enhanced Matte or Budget Poster
- **Image delivery to Prodigi:** Client renders 150 DPI map image via `maplibre-gl-export`, uploads to Cloudflare R2 via Worker, then passes the public R2 URL to Prodigi
- **R2 public access:** Custom domain (e.g., `prints.kidsroadtripmap.com`) pointing to the `roadtrip-prints` R2 bucket. Image URLs are unguessable UUIDs
- Flow: Client uploads image to R2 → Worker calls Prodigi quote API for shipping cost → Stripe Checkout (poster price + shipping) → webhook confirms payment → backend places Prodigi order (with R2 image URL) → Prodigi ships direct to customer
- Prodigi sandbox for development (free, orders not fulfilled)
- CloudEvents webhooks for shipment tracking

### Geocoding (International)
- **Photon by Komoot** (`photon.komoot.io`) — free OSM geocoder, **proxied through the Worker**
- No API key required. No strict rate limit (unlike Nominatim's 1 req/sec). Good autocomplete support via `/api?q=...&limit=5`
- Worker adds KV caching for repeated queries (TTL: 7 days)
- Response format: GeoJSON `FeatureCollection` with `properties.name`, `properties.city`, `properties.country`, etc.
- Works globally — no geographic bias
- Client debounces autocomplete input (300ms+)
- `lang` query parameter for localized results (e.g., `lang=en`)

### Units
- Km/miles toggle stored per-map in D1 (`maps.units`)
- Default based on browser locale (miles for US/UK, km elsewhere)
- ORS returns meters by default (or configurable via `units` param) — convert client-side

---

## Print Service: Prodigi

**Why Prodigi over alternatives:**
- Best API documentation with full Postman collection
- Free sandbox environment (`api.sandbox.prodigi.com`)
- CloudEvents-compliant webhooks
- Poster sizes from 4x6" to 40x60"
- Global fulfillment (UK, EU, US, CA, AU, SE)
- No minimums, no monthly fees
- You handle customer payments via Stripe independently

**Alternatives considered:** Gelato (larger network, $25/mo optional), Printful (largest catalog), Cloudprinter (enterprise-scale). All viable fallbacks.

**Note:** No POD service offers folded maps — only flat/rolled poster prints.

---

## Backend: Cloudflare Workers

A single Cloudflare Worker (using **Hono** router) handles all server-side concerns **and** serves the Vite-built SPA static assets. Same-origin deployment — no CORS needed, simple cookie-based auth.

### Rate Limiting
- **Implementation:** Cloudflare Workers `rate_limit` binding (built-in, no external dependency)
- **Public endpoints** (`GET /api/maps/:id` without auth): **60 requests/minute per IP** — prevents scraping
- **Proxy routes** (`/api/geocode`, `/api/route`): **30 requests/minute per user** — prevents abuse of upstream APIs (Photon, ORS). Already authenticated, so rate limit by user ID
- **Auth routes** (`/api/auth/*`): **10 requests/minute per IP** — brute-force protection on OAuth flows
- **Binding config:** Add `[[rate_limits]]` in `wrangler.toml`, use `env.RATE_LIMITER` in Hono middleware

### D1 Database (Users, Maps, Sharing)
- **Database:** `roadtrip-db`
- **Tables (managed by Better Auth + custom schema):**

```sql
-- Better Auth managed tables (auto-created):
--   user, session, account, verification

-- Application tables:
CREATE TABLE maps (
  id TEXT PRIMARY KEY,           -- UUID
  owner_id TEXT NOT NULL REFERENCES user(id),
  name TEXT NOT NULL,             -- Trip name
  family_name TEXT,
  visibility TEXT NOT NULL DEFAULT 'private',  -- 'public' | 'private'
  style_preferences TEXT DEFAULT '{}',         -- JSON blob
  units TEXT NOT NULL DEFAULT 'km',            -- 'km' | 'miles'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE stops (
  id TEXT PRIMARY KEY,           -- UUID
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,     -- Display order (0-indexed)
  name TEXT NOT NULL,             -- Place name from geocoding
  label TEXT,                     -- Custom label ("Grandma's House!")
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  icon TEXT,                      -- Icon identifier (Jelly icon name, e.g. 'star', 'circle')
  travel_mode TEXT,               -- How you arrive at this stop from the previous one: 'drive'|'walk'|'bike'|'plane'|'boat'. NULL on first stop.
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_stops_map_id ON stops(map_id);

CREATE TABLE map_shares (
  id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES user(id),           -- NULL until invite link is claimed
  role TEXT NOT NULL DEFAULT 'viewer',         -- 'viewer' | 'editor'
  claim_token TEXT UNIQUE NOT NULL,            -- Unique token for invite link (UUID)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(map_id, user_id)
);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL REFERENCES maps(id),
  user_id TEXT NOT NULL REFERENCES user(id),
  stripe_session_id TEXT,
  prodigi_order_id TEXT,
  poster_size TEXT NOT NULL,                   -- '18x24' | '24x36'
  status TEXT NOT NULL DEFAULT 'pending',      -- 'pending' | 'paid' | 'pending_render' | 'submitted' | 'shipped'
  image_url TEXT,                              -- R2 public URL (NULL if client render failed — see pending_render flow)
  shipping_address TEXT,                       -- JSON blob
  tracking_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### KV Cache (Geocoding + Routing)
- **Namespace:** `API_CACHE`
- **Keys:**
  - `geocode:{hash(query)}` — Photon geocoding response
  - `route:{profile}:{hash(start_lon,start_lat,end_lon,end_lat)}` — ORS single-segment response (profile = `driving-car` | `foot-walking` | `cycling-regular`)
- **Value:** cached API response JSON
- **TTL:** 7 days for geocoding results, 24 hours for routes
- Per-segment cache keys mean any two trips sharing a leg between the same pair of points reuse the cached ORS response regardless of which overall trip they belong to

### R2 Storage (Print Images)
- **Bucket:** `roadtrip-prints`
- **Key:** `{map_guid}/{timestamp}.png`
- **Value:** High-resolution PNG rendered by client via maplibre-gl-export
- **Public access:** Custom domain (e.g., `prints.kidsroadtripmap.com`) pointing to the bucket. URLs use unguessable UUID paths — effectively secret
- Cleanup: images older than 30 days can be purged via lifecycle rule

### API Routes (Hono)

**Auth (handled by Better Auth, mounted at `/api/auth/*`):**
| Method | Route | Description |
|--------|-------|-------------|
| `*` | `/api/auth/*` | Better Auth handles all auth routes (sign-in, sign-up, OAuth callbacks, sign-out, session) |

**Maps (authenticated, except GET /:id which uses optional auth):**
| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/maps` | Create new map (owner = current user) |
| `GET` | `/api/maps` | List current user's maps + maps shared with them |
| `GET` | `/api/maps/:id` | Load map metadata + stops — **optional auth**: public maps served to anyone, private maps require valid session + access check |
| `PUT` | `/api/maps/:id` | Update map metadata (name, family_name, units, style_preferences) — debounced auto-save (owner/editor only) |
| `DELETE` | `/api/maps/:id` | Delete map + all stops (owner only, CASCADE) |
| `POST` | `/api/maps/:id/duplicate` | Fork a map + all stops → new map owned by current user |

**Stops (authenticated, owner/editor only, except via public map GET):**
| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/maps/:id/stops` | Add a stop (name, lat, lng, label, icon, position) |
| `PUT` | `/api/maps/:id/stops/:stop_id` | Update a stop (label, icon, position) |
| `DELETE` | `/api/maps/:id/stops/:stop_id` | Remove a stop |
| `PUT` | `/api/maps/:id/stops/reorder` | Batch-update stop positions (drag-and-drop reorder) |

**Sharing (authenticated, owner only except claim):**
| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/maps/:id/shares` | List collaborators on a map |
| `POST` | `/api/maps/:id/shares` | Generate invite link (role) — creates claim token, returns invite URL |
| `PUT` | `/api/maps/:id/shares/:share_id` | Update collaborator role |
| `DELETE` | `/api/maps/:id/shares/:share_id` | Remove collaborator |
| `PUT` | `/api/maps/:id/visibility` | Toggle public/private |
| `POST` | `/api/shares/claim/:token` | Auto-claim an invite link — sets `user_id` on share row, redirects to map (authenticated, any user) |

**Proxy (authenticated):**
| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/geocode?q=...` | Proxy Photon geocoding (KV-cached, rate-limited: 30/min per user) |
| `POST` | `/api/route` | Proxy one ORS segment: `{profile, start: [lon,lat], end: [lon,lat]}` → GeoJSON LineString (KV-cached per segment+profile, rate-limited: 30/min per user). Plane/boat segments never call this route. |

**Print (authenticated):**
| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/images/:map_id` | Upload print-ready image to R2, returns public URL |
| `POST` | `/api/print-quote` | Get Prodigi shipping quote (poster size + shipping address → exact shipping cost) |
| `POST` | `/api/checkout` | Create Stripe Checkout session for print order (poster price + quoted shipping) |

**Admin (secret-header protected, not user-facing):**
| Method | Route | Description |
|--------|-------|-------------|
| `PATCH` | `/api/admin/orders/:id` | Set `image_url` on a `pending_render` order and place the Prodigi fulfillment order. Protected by `Authorization: Bearer {ADMIN_SECRET}` header. |

**Webhooks (unauthenticated, signature-verified):**
| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/webhooks/stripe` | Handle Stripe payment confirmation (idempotency: skip if `stripe_session_id` already exists in D1) |
| `POST` | `/api/webhooks/prodigi` | Handle Prodigi shipment updates |

### Bindings (wrangler.toml)
- **D1 Database:** `DB` → `roadtrip-db`
- **KV Namespace:** `API_CACHE`
- **R2 Bucket:** `roadtrip-prints`
- **Rate Limiter:** `RATE_LIMITER` → `rate_limit` binding

### Secrets (via `wrangler secret put`)
- `BETTER_AUTH_SECRET` — session signing key
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- `FACEBOOK_CLIENT_ID` / `FACEBOOK_CLIENT_SECRET`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `PRODIGI_API_KEY`
- `ORS_API_KEY` — OpenRouteService Directions API key (free tier)
- `ADMIN_SECRET` — Bearer token protecting `PATCH /api/admin/orders/:id` (manual fulfillment endpoint)

### Payment + Fulfillment Flow

The client attempts a high-res WebGL canvas render before checkout. Whether it succeeds or fails, the user sees the same checkout experience. The two paths diverge only in the webhook handler.

```
Authenticated user clicks "Order Print"
  → Client attempts 150 DPI map render via maplibre-gl-export
  → [SUCCESS PATH] Client uploads image to R2 → gets public URL, passes it to /api/checkout
  → [FAILURE PATH] Canvas allocation fails → client proceeds to checkout without image_url
  → Frontend calls POST /api/print-quote (poster size, shipping address) → Worker calls Prodigi quote API → returns exact shipping cost
  → Frontend displays poster price + shipping cost for user confirmation
  → Frontend calls POST /api/checkout (map ID, poster size, shipping address, quoted shipping cost; image_url optional)
  → Worker creates Stripe Checkout session (poster price + shipping as separate line items, user ID in metadata), returns session URL
  → User completes payment on Stripe (UX identical regardless of render path)
  → Stripe fires webhook → POST /api/webhooks/stripe
  → Worker verifies signature (idempotency check: skip if stripe_session_id already exists in D1)
  → Worker creates order record in D1
  → [SUCCESS PATH] image_url present → place Prodigi order immediately → status: 'submitted'
  → [FAILURE PATH] image_url absent → status: 'pending_render' → send admin notification email
  → [SUCCESS PATH] Prodigi prints and ships direct to customer
  → Prodigi fires webhook → POST /api/webhooks/prodigi (tracking info)
  → Worker updates order record in D1 with status + tracking URL

--- PENDING_RENDER MANUAL FULFILLMENT ---
  → Admin sees pending_render order (email notification or dashboard query)
  → Admin opens map URL in browser, runs export, image uploads to R2 → public URL
  → Admin calls PATCH /api/admin/orders/:id { image_url } (secret-header protected)
  → Worker updates order with image_url, places Prodigi order → status: 'submitted'
```

**Confirmation page copy:** Use intentionally vague language — "We're preparing your map for print! You'll receive a shipping notification within 1–2 business days." This covers both paths without exposing the manual step.

---

## Milestones

Milestones 1–5 are strictly sequential — each builds on the prior. After M5, milestones 6 and 7 are semi-independent and could be parallelized. M8 depends on M7 (export renders the image that gets uploaded for printing). M9 is a final pass across everything.

### Milestone 1: Scaffold & Navigation Shell ✅ COMPLETE

**Goal:** App boots, theme works, you can click between pages.

**Build:**
1. `npm create vite@latest . -- --template lit-ts`
2. Configure `.npmrc` for Web Awesome Pro + Font Awesome Pro registries
3. Install dependencies: Web Awesome Pro, MapLibre GL JS, jsPDF, maplibre-gl-export (v4+), better-auth
4. Set up Web Awesome theme + color palette in `index.html` / CSS (`theme.css`, `global.css`)
5. Set up Font Awesome Pro+ Kit integration (`setKitCode` via Web Awesome loader)
6. Build DIY router as Lit reactive controller (`router.ts`) — URLPattern matching, Navigation API (`navigation.addEventListener('navigate', ...)`), auth guard hooks, lazy loading via dynamic imports, built-in scroll restoration and focus management
7. Build `app-shell.ts` — layout wrapper (header, nav, footer)
8. Build `landing-page.ts` — static placeholder "Plan Your Road Trip!"
9. Scaffold Cloudflare Worker project in `worker/` with Hono, `wrangler.toml`, D1 binding (`DB`), KV binding (`API_CACHE`), R2 binding (`roadtrip-prints`), static asset serving for the SPA

**Verify:**
- `npm run dev` — app loads, WA components render, Jelly icons appear
- Navigate between stub pages via router, back/forward works
- Worker starts locally via `wrangler dev`, serves both API and static assets from same origin

#### Implementation Notes (M1)

**Files created (21 total):**

```
kids-roadtrip-map/
├── .gitignore                       # node_modules/, dist/, .dev.vars, tsconfig.tsbuildinfo, worker/node_modules/
├── .npmrc                           # @awesome.me + @fortawesome → npm.fontawesome.com, FONTAWESOME_AUTH_TOKEN
├── index.html                       # wa-theme-playful wa-palette-rudimentary, FOUC prevention, <app-shell> entry
├── package.json                     # Root project dependencies + scripts
├── tsconfig.json                    # ES2022, experimentalDecorators, bundler resolution, strict
├── vite.config.ts                   # ES2022 build target, optimizeDeps includes maplibre-gl
├── thumbtack-jelly-duo-regular-full.svg  # Source pushpin icon (FA Pro 7.2.0 Jelly duo)
├── public/
│   └── favicon.svg                  # Same pushpin icon used as browser favicon
├── src/
│   ├── index.ts                     # Entry: loads styles, sets WA kit code + jelly default
│   ├── router.ts                    # DIY Lit ReactiveController router (~150 LOC)
│   ├── nav.ts                       # navigateTo() + navClick() helpers
│   ├── styles/
│   │   ├── global.css               # WA CSS imports + box-sizing reset + body defaults
│   │   └── theme.css                # Brand orange (#ff6b00/#e05e00), rounded system fonts, larger text
│   ├── auth/
│   │   ├── auth-state.ts            # Stub reactive auth (getUser/setUser/onAuthChange/isAuthenticated)
│   │   └── auth-guard.ts            # requireAuth() enter hook → redirects to /sign-in
│   ├── pages/
│   │   ├── landing-page.ts          # Hero + CTA buttons + 4-card feature grid
│   │   ├── sign-in-page.ts          # Stub card with "Milestone 2" callout
│   │   ├── dashboard-page.ts        # Stub "My Trips" with empty state + Create New Trip button
│   │   └── trip-builder-page.ts     # Stub with mapId param display + "Milestones 3–5" callout
│   └── components/
│       └── app-shell.ts             # Header (logo + nav) / router outlet / footer (© + OSM attribution)
└── worker/
    ├── package.json                 # hono dep, vitest/wrangler/cf-workers-types devDeps
    ├── tsconfig.json                # ES2022, @cloudflare/workers-types + vitest-pool-workers types
    ├── wrangler.toml                # Full binding config (see below)
    ├── vitest.config.ts             # @cloudflare/vitest-pool-workers, silent mode
    └── src/
        ├── index.ts                 # Hono app with health check + 501 stubs
        └── index.test.ts            # 17 tests covering health, stubs, 404s
```

**Dependencies installed:**

| Package | Version | Purpose |
|---------|---------|---------|
| `@awesome.me/kit-781a3c6be3` | ^1.0.4 | FA Pro+ Kit (Jelly icons) |
| `@awesome.me/webawesome-pro` | ^3.2.1 | Web Awesome Pro UI components |
| `lit` | ^3.3.2 | Web component framework |
| `maplibre-gl` | ^5.19.0 | WebGL vector maps |
| `@watergis/maplibre-gl-export` | ^4.1.1 | Map export to image |
| `jspdf` | ^4.2.0 | PDF generation |
| `better-auth` | ^1.5.1 | Authentication library |
| `typescript` | ^5.9.3 | (dev) Type checking |
| `vite` | ^7.3.1 | (dev) Build tool |
| `wrangler` | ^4.69.0 | (dev) CF Workers CLI |

Worker-specific:
| `hono` | ^4.7.10 | HTTP router framework |
| `@cloudflare/vitest-pool-workers` | ^0.12.18 | (dev) Workers test runner |
| `@cloudflare/workers-types` | ^4.20250525.0 | (dev) CF Workers type defs |
| `vitest` | ~3.2.0 | (dev) Test framework |

**Router implementation (`src/router.ts`):**
- `RouteDefinition` interface: `{ path, render, enter? }` where `enter()` is an async guard returning a redirect path or void
- `Router` class implements `ReactiveController` for Lit integration
- Primary handler: `navigation.addEventListener('navigate', ...)` intercepts all navigation (link clicks, form submissions, back/forward, programmatic)
- Fallback: `window.addEventListener('popstate', ...)` for browsers without Navigation API
- Route matching via `URLPattern` with named parameter extraction (e.g. `/map/:id`)
- Programmatic navigation: `router.navigate(path)` or imported `navigateTo(path)` / `navClick(path)` helpers
- Built-in 404 template rendered for unmatched routes
- View Transitions support via Navigation API integration

**Route table (defined in `app-shell.ts`):**

| Path | Guard | Page Component | Notes |
|------|-------|----------------|-------|
| `/` | — | `<landing-page>` | Public hero page |
| `/sign-in` | — | `<sign-in-page>` | Stub (M2) |
| `/dashboard` | `requireAuth` | `<dashboard-page>` | Stub (M4) |
| `/map/new` | `requireAuth` | `<trip-builder-page mapId="">` | New map stub (M3–5) |
| `/map/:id` | `requireAuth` | `<trip-builder-page mapId=${id}>` | Edit map stub (M3–5) |

**Auth state (`src/auth/auth-state.ts`):**
- Stub implementation: `User` interface with `id`, `email`, `name`, `image?`
- Simple signal-like store: `getUser()`, `setUser()`, `onAuthChange(fn)`, `isAuthenticated()`
- `requireAuth()` guard checks `isAuthenticated()` and returns `'/sign-in'` redirect if false
- Will be replaced with Better Auth session management in M2

**Theme configuration:**
- Base: Web Awesome `playful` theme + `rudimentary` palette (set via HTML classes on `<html>`)
- Brand color overrides: `--wa-color-brand-500: #ff6b00` (bright orange), `--wa-color-brand-600: #e05e00`
- Border radius overrides: medium `0.625rem`, large `1rem`, XL `1.5rem` (rounder/friendlier)
- Font stack: `ui-rounded, 'Hiragino Maru Gothic ProN', Quicksand, Comfortaa, Manjari, 'Arial Rounded MT', 'Arial Rounded MT Bold', Calibri, source-sans-pro, system-ui, sans-serif` — rounded system fonts, no external downloads
- Font weight: `--wa-font-weight-normal: 600` (slightly bolder for kid-friendly readability)
- Font size: `--wa-font-size-m: 1.0625rem` (~17px, larger body text)
- Smooth scrolling enabled on `<html>`
- Global CSS: imports WA base styles + playful theme, applies `box-sizing: border-box` globally, body uses `min-height: 100dvh`
- FOUC prevention: `:not(:defined) { visibility: hidden; }` in `index.html` hides undefined custom elements

**Landing page (`src/pages/landing-page.ts`):**
- Hero section: map icon (5rem), "Plan Your Family Road Trip!" heading (clamp sizing), descriptive tagline
- CTA group: "Start Planning" (brand, large, paper-plane icon → `/dashboard`) + "Sign In" (neutral outlined → `/sign-in`)
- Feature grid: 4 cards — Add Stops (location-dot), Draw the Route (compass), Customize Icons (star), Print or Order (print)
- Cards are 180px wa-cards with centered layout

**App shell (`src/components/app-shell.ts`):**
- CSS Grid layout: header (sticky? no — fixed at top of flow), main (flex-grow), footer
- Header: logo link (orange `#e05e00`, rounded icon + "Kids Roadtrip Map" text) + nav buttons ("My Trips" plain variant, "Sign In" brand variant)
- Footer: `© 2026 Kids Roadtrip Map · Map data © OpenStreetMap contributors · Tiles by OpenFreeMap`
- Router outlet: `this.router.outlet()` renders matched page template

**Worker configuration (`worker/wrangler.toml`):**
- `name = "kids-roadtrip-map"`, `compatibility_date = "2026-03-02"`, `nodejs_compat` flag
- Observability: logs at 100% sampling, traces at 1% sampling
- Static assets: `directory = "../dist"`, `binding = "ASSETS"`, `not_found_handling = "single-page-application"`, `run_worker_first = ["/api/*"]`
- D1: `binding = "DB"`, `database_name = "roadtrip-db"` (placeholder ID)
- KV: `binding = "API_CACHE"` (placeholder ID)
- R2: `binding = "ROADTRIP_PRINTS"`, `bucket_name = "roadtrip-prints"`
- Rate limiters: `RATE_LIMITER_PUBLIC` (60/60s), `RATE_LIMITER_PROXY` (30/60s), `RATE_LIMITER_AUTH` (10/60s)

**Worker Hono app (`worker/src/index.ts`):**
- `Env` interface declares all bindings: `ASSETS` (Fetcher), `DB` (D1Database), `API_CACHE` (KVNamespace), `ROADTRIP_PRINTS` (R2Bucket), 3 rate limiters (RateLimit), 10 secrets (strings)
- Middleware: `hono/logger` on all routes
- `GET /api/health` → `{ status: 'ok', milestone: 1 }` (200)
- Stub routes return 501 with milestone-tagged error messages:
  - `ALL /api/auth/*` → "Milestone 2"
  - `GET/POST /api/maps`, `GET/PUT/DELETE /api/maps/:id` → "Milestone 4"
  - `GET /api/geocode` → "Milestone 3"
  - `POST /api/route` → "Milestone 5"
- Unknown `/api/*` routes → 404 (Hono default)

**Worker test suite (`worker/src/index.test.ts`):**
- 17 tests using `@cloudflare/vitest-pool-workers` + Vitest
- Helper `request()` function calls `app.request(path, init, env)` directly (no HTTP round-trip)
- Tests cover: health check (3 tests: status, content-type, body), auth stubs (3), map stubs (6), geocoding stub (2), routing stub (2), unknown routes 404 (2)
- All tests verify both HTTP status codes and response body content

**Not yet created (deferred to later milestones):**
- `src/map/` — map controller, export, kid-friendly style, sprites (M3–5, M7)
- `src/services/` — api-client, maps, geocoding, routing, image-upload, stripe, print-order (M3–8)
- `src/components/location-search.ts` — geocoding autocomplete (M3)
- `src/components/stop-list.ts`, `stop-card.ts` — trip stop management (M4)
- `src/components/map-view.ts` — MapLibre GL wrapper (M3)
- `src/components/map-card.ts` — dashboard thumbnails (M4)
- `src/components/share-dialog.ts` — sharing UI (M6)
- `src/components/export-options.ts`, `print-order-form.ts` — export/print UI (M7–8)
- `src/components/user-menu.ts` — avatar/sign-out dropdown (M2)
- `src/auth/auth-client.ts` — Better Auth client instance (M2)
- `src/pages/map-preview-page.ts`, `export-page.ts`, `order-confirmation-page.ts` (M7–8)
- `worker/src/auth.ts` — Better Auth server instance (M2)
- `worker/src/middleware/require-auth.ts` — Hono session middleware (M2)
- `worker/src/routes/` — all API route modules (M2–8)
- `worker/src/db/schema.sql`, `migrations/` — D1 schema (M2)
- `worker/src/lib/prodigi.ts`, `stripe.ts` — service clients (M8)

---

### Milestone 2: Authentication

**Goal:** Users can sign up, sign in, and see a protected dashboard.

**Build:**
1. Create D1 database and write schema migration (Better Auth tables + `maps`, `map_shares`, `orders`)
2. Configure Better Auth server instance in Worker (`auth.ts`) with D1 adapter, Google/Facebook OAuth providers, and `passkey` plugin
3. Mount Better Auth handler on `/api/auth/*` in Hono
4. Build `require-auth.ts` Hono middleware (validate session, attach user to context)
5. Set up Better Auth client in frontend (`auth-client.ts`, `auth-state.ts`)
6. Build `sign-in-page.ts` — OAuth buttons (Google, Facebook) + passkey sign-in button + email input + passkey registration flow for new users
7. Build `user-menu.ts` component — avatar, sign-out dropdown
8. Build auth guard (`auth-guard.ts`) + wire into DIY router as `enter()` hook for protected routes
9. Build `dashboard-page.ts` — "My Maps" + "Shared with me" lists (empty state for now)

**Verify:**
- Sign in with Google — user created in D1, session cookie set
- Register with passkey — enter email, browser prompts for biometric, user + credential created in D1, session cookie set
- Sign in with passkey — browser picker appears, credential verified, session set
- OAuth + passkey with same email links to the same account (recovery path works)
- Unauthenticated visits to protected routes redirect to sign-in
- Protected API routes return 401 without session, 200 with session
- User menu shows avatar, sign-out works
- Session persists on refresh

---

### Milestone 3: Map Display & Geocoding

**Goal:** A working map with place search.

**Build:**
1. Build `map-view.ts` Lit component wrapping MapLibre GL JS with OpenFreeMap Bright style
2. Implement Worker geocoding proxy route (`GET /api/geocode`) proxying to Photon (`photon.komoot.io/api`) with KV caching (7-day TTL)
3. Build `location-search.ts` — debounced autocomplete (300ms+) calling Worker proxy
4. Build `services/geocoding.ts` — fetch wrapper for geocoding proxy, parsing Photon GeoJSON response

**Verify:**
- OpenFreeMap tiles load with Bright style
- Worker `/api/geocode` proxies Photon correctly, KV caching works
- Type a place name, see suggestions, select one, map flies to it with a marker
- Debouncing works (no excessive requests)

---

### Milestone 4: Trip Builder (CRUD)

**Goal:** Users can create trips, add/reorder stops, and everything persists.

**Build:**
1. Implement map CRUD API routes in Worker (`POST/GET/PUT/DELETE /api/maps`) with D1 + ownership checks
2. Implement stop sub-resource API routes in Worker (`POST/PUT/DELETE /api/maps/:id/stops`, `PUT /api/maps/:id/stops/reorder`)
3. Build `services/maps.ts` — map CRUD + stop CRUD API calls + `services/api-client.ts` base fetch wrapper
4. Build `trip-builder-page.ts` — form for trip name, family name
5. Build `stop-list.ts` — drag-and-drop ordered list of stops; each stop (except the first) shows a travel mode selector between it and the previous stop (`drive`/`walk`/`bike`/`plane`/`boat`)
6. Build `stop-card.ts` — individual stop with label editing + Jelly icon picker (categorized grid of 38 curated icons; checklist icons `circle`/`square`/`circle-check` render as checkbox style on map)
7. Wire up map: show markers for stops, fit bounds
8. Map metadata (name, family_name, units, style) auto-saves via debounced `PUT /api/maps/:id` (2-3 sec idle). Stop changes (including travel_mode) save immediately via stop sub-resource routes (add/update/delete/reorder) with save indicator in UI
9. Build `map-card.ts` — map thumbnail card for dashboard (tiny live MapLibre embed showing stops)
10. Update `dashboard-page.ts` to list owned maps

**Verify:**
- Create a trip, add 3+ stops, reorder them, refresh — data persists in D1
- Dashboard shows the trip with thumbnail card
- Map displays markers at each stop, fits bounds
- Ownership enforced — can't access another user's map
- Auto-save triggers on changes

---

### Milestone 5: Route Drawing

**Goal:** Colored, mode-specific route segments connect all stops on the map.

**Build:**
1. Implement Worker routing proxy route (`POST /api/route`) — accepts `{profile, start, end}`, calls ORS `POST /v2/directions/{profile}/geojson` with two-point coordinates, returns GeoJSON LineString; KV-cached per `{profile, start, end}`
2. Build `services/routing.ts` — per-segment fetch wrapper; for `plane`/`boat` modes, generates geometry client-side (great-circle arc interpolation for plane, straight LineString for boat) without calling the Worker
3. Extend `map-controller.ts` — render each segment as its own MapLibre layer with mode-specific paint properties:
   - Drive: solid thick orange line
   - Walk: dotted green line (`line-dasharray: [0, 2]`, round caps)
   - Bike: dashed teal line
   - Plane: dotted blue/purple line on great-circle arc geometry
   - Boat: long-dash navy line on straight geometry
4. Add numbered badge markers at each stop with chosen Jelly icon
5. Auto-fit map bounds to all segments
6. Implement km/miles toggle (stored per-map in D1, default from browser locale); sum segment distances for total

**Verify:**
- Worker `/api/route` proxies ORS correctly for drive/walk/bike, KV caching works
- Plane segment draws a curved arc, boat segment draws a straight line — neither calls ORS
- Add mixed-mode stops (e.g. drive → city, fly → city, boat → island), all segments render with correct style
- Route redraws when stops are reordered or travel mode changes
- Toggle units, total distance updates
- Map bounds fit all segments

---

### Milestone 6: Sharing & Collaboration

**Goal:** Maps can be shared via invite links, or made public.

**Build:**
1. Build `share-dialog.ts` — public/private toggle, generate invite link with role picker (Viewer/Editor), copy-to-clipboard button, list of current collaborators
2. Implement sharing API routes in Worker (`/api/maps/:id/shares`, `/api/maps/:id/visibility`, `POST /api/shares/claim/:token`)
3. Implement access control checks on all map routes (owner / editor / viewer / public), with optional auth on `GET /api/maps/:id`
4. Build public map view — read-only for unauthenticated visitors, "Duplicate this trip" for authenticated users
5. Implement `POST /api/maps/:id/duplicate` — fork a map to new owner
6. Build claim page — `/claim/{token}` route, auto-claims for authenticated users (sets `user_id` on share row, redirects to map). Unauthenticated users redirect to sign-in with return URL back to claim link
7. Update `dashboard-page.ts` — "Shared with me" section with role badges

**Verify:**
- Generate invite link as Viewer — share link, recipient clicks it while signed in, auto-claimed, can view but not edit
- Generate invite link as Editor — recipient clicks link, auto-claimed, can edit stops/labels/style
- Unauthenticated user clicks invite link → redirected to sign-in → after sign-in, auto-claimed and redirected to map
- Owner can remove collaborators and change roles
- Toggle visibility: public maps accessible without auth, private maps are not
- Visit public map as different user, "Duplicate this trip" — new owned copy created

---

### Milestone 7: Export (PDF / Image)

**Goal:** Users can download print-quality maps.

**Build:**
1. Build `map-preview-page.ts` — full-screen styled map with all stops + route
2. Integrate `@watergis/maplibre-gl-export` for 150 DPI rendering (cap max canvas at 5400px, graceful error if device can't allocate)
3. Build `map-export.ts` — PNG/JPEG download
4. Build decorative PDF layout with jsPDF (title, family name, stop list, border, road trip stats)
5. Build `export-options.ts` — format selection UI
6. Build `export-page.ts` — ties together preview, options, and download actions

**Verify:**
- Export PDF — opens with trip title, map image, stop list, decorative border
- Export PNG — correct resolution (150 DPI, within canvas limits)
- Both formats include all stops and route

---

### Milestone 8: Print Ordering (Stripe + Prodigi)

**Goal:** Users can order a printed poster and receive it in the mail.

*Depends on M7 — export renders the image that gets uploaded for printing.*

**Build:**
1. Implement R2 image upload route in Worker (`POST /api/images/:map_id`) + `services/image-upload.ts`
2. Build client-side 150 DPI image render + upload flow — attempt render, upload on success, proceed to checkout regardless; pass `image_url` to checkout only if upload succeeded
3. Build `print-order-form.ts` — poster size selection ($19.99 / $29.99), shipping address form, shipping cost display (fetched from Prodigi quote)
4. Implement Prodigi quote route in Worker (`POST /api/print-quote`) — calls Prodigi quote API with poster size + shipping address → returns exact shipping cost
5. Implement Stripe Checkout session creation in Worker (`POST /api/checkout`) — poster price + quoted shipping as separate line items, user ID in metadata; `image_url` is optional
6. Build `services/stripe.ts` — Stripe Checkout session creation client
7. Implement Stripe webhook handler in Worker (`POST /api/webhooks/stripe`) — verify signature; **idempotency check** (`stripe_session_id` already in D1 → return 200, skip); create order record in D1; if `image_url` present → place Prodigi order immediately (status: `submitted`); if absent → set status `pending_render`, send admin notification via Cloudflare Email Workers
8. Implement Prodigi order placement in Worker (`worker/src/lib/prodigi.ts`) — called from both the webhook handler (auto path) and the admin endpoint (manual path)
9. Implement admin endpoint (`PATCH /api/admin/orders/:id`) — accepts `{ image_url }`, places Prodigi order, updates status to `submitted`; protected by `Authorization: Bearer {ADMIN_SECRET}` header
10. Implement Prodigi webhook handler in Worker (`POST /api/webhooks/prodigi`) — update order status + tracking URL
11. Build `order-confirmation-page.ts` — shows vague "We're preparing your map for print — shipping notification within 1–2 business days" copy regardless of path; shows tracking info once available

**Verify:**
- Render succeeds: image uploaded to R2, checkout completes, webhook places Prodigi order automatically (status: `submitted`)
- Render fails (simulate by skipping upload): checkout still completes, order created with `pending_render` status, admin notification email sent
- Admin calls `PATCH /api/admin/orders/:id` with image URL → Prodigi sandbox order placed, status updates to `submitted`
- Stripe webhook idempotency: deliver same webhook twice → only one order record, one Prodigi order
- Stripe Checkout with test keys + test card numbers — payment succeeds on both paths
- Prodigi webhook updates tracking info in D1
- Order confirmation page shows appropriate copy at each status

---

### Milestone 9: Polish & Launch Prep

**Goal:** Production-ready quality.

**Build:**
1. Responsive design pass (mobile-friendly trip builder + sign-in)
2. Loading states, error handling, empty states throughout all pages
3. Dashboard: order history section (past print orders with status/tracking)
4. OpenStreetMap / OpenFreeMap attribution on all map views

**Verify:**
- All pages usable on mobile
- Empty states display correctly (no maps, no stops, no orders)
- Error states handled gracefully (API failures, network errors)
- Attribution visible on map
- End-to-end: sign up → create map → add stops → share with collaborator → export PDF → order print → confirm order

---

## Deployment

| Component | Platform | How |
|-----------|----------|-----|
| **Worker (API + SPA)** | Cloudflare Workers | `wrangler deploy` — single Worker serves both API routes and Vite-built static assets |
| **D1 Database** | Cloudflare D1 | `wrangler d1 create roadtrip-db` + `wrangler d1 migrations apply` |
| **KV Namespace** | Cloudflare KV | `wrangler kv namespace create API_CACHE` |
| **R2 Bucket** | Cloudflare R2 | `wrangler r2 bucket create roadtrip-prints` + custom domain (e.g., `prints.kidsroadtripmap.com`) |

Single-origin deployment: one Worker handles everything. Vite builds static assets into `dist/`, which are served by the Worker for non-API routes. No CORS configuration needed — auth cookies are first-party. Custom domain (e.g., `kidsroadtripmap.com`) points to the Worker.

**OAuth provider setup (one-time):**
- Google: Create OAuth app at console.cloud.google.com, set redirect URI to `{app_url}/api/auth/callback/google`
- Facebook: Create app at developers.facebook.com, set redirect URI to `{app_url}/api/auth/callback/facebook`
