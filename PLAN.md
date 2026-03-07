# Mapadillo — Implementation Plan

## Context

A family-oriented web app where a parent/organizer enters road trip locations, and the app generates a bright, kid-friendly printable map. The map can be exported as PDF/image or ordered as a printed-and-mailed poster via Prodigi. The UI uses Web Awesome Pro components with Font Awesome Pro Jelly icons for a playful, childlike aesthetic.

**User accounts via Better Auth.** Sign in with Google or Facebook, or create an account with a Passkey (WebAuthn — biometrics, hardware key, or platform authenticator). Passkeys are the primary passwordless option; OAuth is the fallback/recovery path. Maps are owned by the creating user. Sharing model: **Owner** (full control + delete), **Editor** (modify stops/labels/style), **Viewer** (read-only). Maps can be **public** (viewable by anyone with the link, forkable) or **private** (accessible only to explicitly shared users). Shareable via URL (`/map/{id}`).

**International scope.** No geographic bias — supports road trips anywhere in the world. Km/miles toggle. Prodigi ships globally.

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Framework** | Vite + Lit (TypeScript) | Web Awesome Pro is built on Lit — zero impedance mismatch, same component model throughout |
| **UI Components** | Web Awesome Pro (`@web.awesome.me/webawesome-pro`) v3.x | 50+ web components, playful theme + bright color palette for kid-friendly out-of-the-box look |
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
   - Download as PDF (print-quality 200 DPI)
   - Download as PNG/JPEG image
   - "Order a Print!" → select poster size, enter shipping address → Stripe Checkout
7. Order Confirmation
   - Stripe payment confirmed via webhook → Worker places Prodigi order
   - Tracking info displayed on confirmation page
```

---

## Project Structure

```
mapadillo/
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
│   │   ├── global.css              # App-wide styles
│   │   └── card-shared.ts          # Shared CSS for point-card + route-card components
│   ├── auth/
│   │   ├── auth-client.ts          # Better Auth client instance + helpers
│   │   ├── auth-guard.ts           # Route guard: redirect to sign-in if unauthenticated
│   │   └── auth-state.ts           # Reactive auth state (current user, session)
│   ├── map/
│   │   ├── kid-friendly-style.json # Custom MapLibre style (from Maputnik)
│   │   ├── sprites/                # Custom map icon sprites (fun markers)
│   │   ├── map-controller.ts       # MapController class: drawItems(), route lines, markers
│   │   └── map-export.ts           # PDF/image export logic
│   ├── pages/
│   │   ├── landing-page.ts
│   │   ├── sign-in-page.ts         # OAuth buttons (Google, Facebook, Apple)
│   │   ├── dashboard-page.ts       # "My Maps" + "Shared with me" lists
│   │   ├── trip-builder-page.ts
│   │   ├── map-preview-page.ts
│   │   ├── export-page.ts
│   │   └── order-confirmation-page.ts
│   ├── utils/
│   │   └── geo.ts                  # Shared utilities: isDraftCoord(), formatDistance()
│   ├── components/
│   │   ├── location-search.ts      # Geocoding autocomplete (configurable placeholder)
│   │   ├── item-list.ts            # Pointer-based drag-and-drop item list (points + routes)
│   │   ├── point-card.ts           # Standalone point card (icon picker, name/label)
│   │   ├── route-card.ts           # A→B route card (start/end search, travel mode, distance)
│   │   ├── map-view.ts             # MapLibre GL wrapper component
│   │   ├── map-card.ts             # Map thumbnail card for dashboard
│   │   ├── share-dialog.ts         # Share settings: public/private, generate invite links, role picker
│   │   ├── icon-picker.ts          # Dialog-based Jelly icon picker (40 icons, 8 categories)
│   │   ├── save-indicator.ts       # Save status display (saving/saved/error)
│   │   ├── travel-mode-picker.ts   # 5-mode horizontal button bar
│   │   ├── export-options.ts       # PDF/image/print selection
│   │   ├── print-order-form.ts     # Size, address, Stripe checkout
│   │   ├── user-menu.ts            # Avatar, sign-out, account dropdown
│   │   └── app-shell.ts            # Layout wrapper (header with user-menu, nav, footer)
│   └── services/
│       ├── api-client.ts           # Base fetch wrapper (attaches auth session cookie)
│       ├── maps.ts                 # CRUD for maps + items + sharing, typed wrappers
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
│   │   │   ├── maps.ts             # CRUD: map metadata + items (D1), role-based access (getMapWithRole)
│   │   │   ├── sharing.ts          # Shares CRUD, visibility toggle, claim endpoint, duplicate
│   │   │   ├── checkout.ts         # Create Stripe Checkout session
│   │   │   ├── stripe-webhook.ts   # Handle Stripe payment confirmation
│   │   │   ├── print-order.ts      # Place Prodigi fulfillment order
│   │   │   ├── geocode.ts          # Proxy Photon geocoding (with KV cache)
│   │   │   ├── route.ts            # Proxy OpenRouteService routing (with KV cache)
│   │   │   └── images.ts           # Upload/serve print-ready images (R2)
│   │   ├── db/
│   │   │   ├── types.ts            # Shared D1 row types: MapRow, StopRow, ShareRow
│   │   │   ├── schema.sql          # D1 schema: users, sessions, accounts, maps, stops, map_shares
│   │   │   └── migrations/         # D1 migration files (0001–0004)
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
- `@watergis/maplibre-gl-export` renders map at **200 DPI** (better print quality while within canvas limits; 300 DPI is unnecessary for wall posters and exceeds WebGL canvas limits on many devices)
- **Canvas size limits:** Cap max canvas dimension at 5400px as a safety net — if the device can't allocate the canvas, show an error with a "try on desktop" message
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
- **Image delivery to Prodigi:** Client renders 200 DPI map image via `maplibre-gl-export`, uploads to Cloudflare R2 via Worker, then passes the public R2 URL to Prodigi
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
  type TEXT NOT NULL DEFAULT 'point', -- 'point' (standalone marker) | 'route' (A→B segment)
  name TEXT NOT NULL,             -- Place name from geocoding
  label TEXT,                     -- Custom label ("Grandma's House!")
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  icon TEXT,                      -- Icon identifier (Jelly icon name, e.g. 'star', 'circle')
  travel_mode TEXT,               -- Routes only: 'drive'|'walk'|'bike'|'plane'|'boat'. NULL on points.
  dest_name TEXT,                 -- Routes only: destination place name
  dest_latitude REAL,             -- Routes only: destination latitude
  dest_longitude REAL,            -- Routes only: destination longitude
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
- **Rate Limiters:** `RATE_LIMITER_PUBLIC` (60/min), `RATE_LIMITER_PROXY` (30/min), `RATE_LIMITER_AUTH` (10/min)

### Secrets (via `wrangler secret put`)
- `BETTER_AUTH_SECRET` — session signing key
- `BETTER_AUTH_URL` — canonical app URL (e.g. `https://kidsroadtripmap.com`); used for `baseURL`, `trustedOrigins`, passkey `rpID`/`origin` instead of deriving from request headers
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
  → Client attempts 200 DPI map render via maplibre-gl-export
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

Milestones 1–5 are strictly sequential — each builds on the prior. After M5, milestones 6 and 7 are semi-independent and could be parallelized. M8 is a polish pass across everything. M9 depends on M7 (export renders the image that gets uploaded for printing).

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
mapadillo/
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
- Header: logo link (orange `#e05e00`, rounded icon + "Mapadillo" text) + nav buttons ("My Trips" plain variant, "Sign In" brand variant)
- Footer: `© 2026 Mapadillo · Map data © OpenStreetMap contributors · Tiles by OpenFreeMap`
- Router outlet: `this.router.outlet()` renders matched page template

**Worker configuration (`worker/wrangler.toml`):**
- `name = "mapadillo"`, `compatibility_date = "2026-03-02"`, `nodejs_compat` flag
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
- `worker/src/lib/prodigi.ts`, `stripe.ts` — service clients (M9)

---

### Milestone 2: Authentication ✅ COMPLETE

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

#### Implementation Notes (M2)

**Files created/modified (12 files):**

```
mapadillo/
├── .gitignore                            # Added worker/coverage/
├── package.json                          # Added better-auth, @better-auth/passkey
├── src/
│   ├── index.ts                          # Added initAuth() at module load (non-blocking session check)
│   ├── auth/
│   │   ├── auth-client.ts        [NEW]   # createAuthClient() + passkeyClient() plugin
│   │   ├── auth-state.ts                 # Rewritten: initAuth/refreshAuth/signOut via Better Auth session
│   │   └── auth-guard.ts                 # Rewritten: awaits initAuth(), returnTo query param
│   ├── pages/
│   │   ├── sign-in-page.ts               # Full OAuth + passkey sign-in/register UI
│   │   └── dashboard-page.ts             # Empty state with greeting, "My Trips" + "Shared with Me"
│   └── components/
│       ├── app-shell.ts                  # Auth-aware header (user-menu vs Sign In), subscribes to onAuthChange
│       └── user-menu.ts          [NEW]   # Avatar/initials + wa-dropdown (My Trips, Sign Out)
└── worker/
    ├── package.json                      # Added better-auth, @better-auth/passkey, kysely-d1
    ├── wrangler.toml                     # Added migrations_dir
    ├── vitest.config.ts                  # Added test secrets + CJS dep inlining
    └── src/
        ├── index.ts                      # Better Auth handler, requireAuth on map stubs, rate limiter
        ├── index.test.ts                 # Updated: auth health, 401 tests, milestone: 2
        ├── types.ts              [NEW]   # Env, SessionUser, SessionData, AppEnv types
        ├── auth.ts               [NEW]   # betterAuth() singleton (D1 via kysely-d1, OAuth, passkey)
        ├── middleware/
        │   └── require-auth.ts   [NEW]   # Validates session, sets c.user + c.session, or 401
        └── db/
            └── migrations/
                └── 0001_initial.sql [NEW] # Full schema (Better Auth + passkey + app tables)
```

**Dependencies added:**

Root:
| Package | Version | Purpose |
|---------|---------|---------|
| `better-auth` | ^1.5.1 | Auth client (signIn, signUp, signOut, getSession) |
| `@better-auth/passkey` | ^1.5.1 | Passkey/WebAuthn client plugin |

Worker:
| Package | Version | Purpose |
|---------|---------|---------|
| `better-auth` | ^1.5.1 | Auth server (session management, OAuth, D1 storage) |
| `@better-auth/passkey` | ^1.5.1 | Passkey/WebAuthn server plugin |
| `kysely-d1` | ^0.4.0 | D1 dialect for Better Auth's Kysely adapter |
| `@vitest/coverage-istanbul` | ~3.2.0 | (dev) Test coverage |

**Deliberate deviations from plan:**

1. **kysely-d1 instead of native D1 adapter.** The plan says Better Auth v1.5+ auto-detects D1 bindings (`database: env.DB`), but Better Auth's Kysely adapter via `kysely-d1` is the documented production approach for D1. Using `D1Dialect` from `kysely-d1` with `type: 'sqlite'` is more reliable than relying on auto-detection.

2. **`BETTER_AUTH_URL` secret added.** Not in the plan's original secrets list. The auth instance derives `baseURL`, `trustedOrigins`, and passkey `rpID`/`origin` from this fixed operator secret instead of `request.url`. Prevents Host header injection, OAuth redirect-URI mismatches between workers.dev and production, and passkey rpID drift.

3. **Orders table uses `ON DELETE RESTRICT`.** Plan has plain `REFERENCES` (defaults to `NO ACTION` in SQLite). Changed to explicit `RESTRICT` — orders are financial records and must not be orphaned when a map or user is deleted.

4. **No standalone `schema.sql`.** Plan lists `worker/src/db/schema.sql` separately from migrations. Only the D1 migration file exists (`0001_initial.sql`). The migration is the canonical schema — a separate file would be redundant.

5. **Better Auth tables use INTEGER timestamps.** Plan's schema sketch uses `TEXT` with `datetime('now')` for all tables. Better Auth stores epoch timestamps as integers, so the migration uses `INTEGER` for Better Auth-managed columns (`createdAt`, `updatedAt`, `expiresAt`). Application tables (`maps`, `stops`, `map_shares`, `orders`) use `TEXT` datetimes as originally planned.

**Schema extras beyond plan:**
- `idx_maps_owner_id` index on `maps(owner_id)` — faster dashboard queries
- `idx_orders_user_id` and `idx_orders_map_id` indexes — faster order lookups
- `IF NOT EXISTS` guards on all tables — allows safe re-runs
- Comment on `map_shares(map_id, user_id)` UNIQUE constraint documenting SQLite NULL uniqueness behavior

**Auth server (`worker/src/auth.ts`):**
- Module-level singleton: `getAuth(env)` constructs the `betterAuth()` instance once per isolate lifetime (Workers module-level state persists within an isolate)
- `basePath: '/api/auth'`
- `emailAndPassword: { enabled: true }` — required for passkey registration flow (`signUp.email` creates account, then `passkey.addPasskey` binds credential). No password-reset UI/routes exposed. Risk documented in code comments
- `trustedOrigins: [url.origin]` from `BETTER_AUTH_URL`
- Passkey plugin: `rpID` = hostname, `rpName` = "Mapadillo", `origin` = full origin

**Auth middleware (`worker/src/middleware/require-auth.ts`):**
- Uses `auth.api.getSession({ headers })` to validate the session cookie
- On success: sets `c.set('user', session.user)` and `c.set('session', session.session)`
- On failure: returns `401 { error: 'Unauthorized' }`

**Rate limiting (inline in `worker/src/index.ts`):**
- Auth routes: 10/min per IP via `RATE_LIMITER_AUTH` binding
- Key: `cf-connecting-ip` header with `x-forwarded-for` fallback

**Frontend auth state (`src/auth/auth-state.ts`):**
- `initAuth()` deduplicates concurrent calls via shared promise
- `refreshAuth()` forces fresh server round-trip (called after passkey sign-in/register)
- `signOut()` calls `authClient.signOut()` then clears local state; catches server errors gracefully
- `onAuthChange(fn)` returns unsubscribe function; `app-shell` subscribes/unsubscribes in lifecycle callbacks

**Sign-in page (`src/pages/sign-in-page.ts`):**
- Two togglable modes: sign-in (returning users) and register (new users)
- Sign-in mode: Google, Facebook, Passkey buttons
- Register mode: Name + Email inputs → `signUp.email()` with `crypto.randomUUID()` password → `passkey.addPasskey()` → `refreshAuth()` → navigate. Risk of random password documented in code
- `returnTo` query param preserved through OAuth redirect (`callbackURL`) and passkey flow (`navigateTo`)
- Error display: `wa-callout variant="danger"`; loading state disables all buttons

**User menu (`src/components/user-menu.ts`):**
- `wa-dropdown` with `wa-button` trigger showing avatar (image or 2-letter initials) + name
- Menu: "My Trips" → `/dashboard`, divider, "Sign Out" with spinner during async operation
- Navigates to `/` after sign-out

**Auth guard (`src/auth/auth-guard.ts`):**
- Awaits `initAuth()` if session not yet checked (first guarded navigation waits for server)
- Returns `/sign-in?returnTo={encodeURIComponent(path+search)}` when unauthenticated

**App shell changes (`src/components/app-shell.ts`):**
- Subscribes to `onAuthChange()` in `connectedCallback`, cleans up in `disconnectedCallback`
- Header: shows `<user-menu .user=${user}>` when authenticated, "Sign In" `wa-button` when not
- Passes `user` to `<dashboard-page>` via `.user` property

**Entry point changes (`src/index.ts`):**
- Calls `initAuth()` at module load — non-blocking, starts session check immediately so the auth guard doesn't delay the first protected navigation

**Worker changes (`worker/src/index.ts`):**
- Health check returns `milestone: 2`
- Auth routes: `app.all('/api/auth/**', ...)` delegates to Better Auth handler (uses `all` so PUT/DELETE/OPTIONS for passkey plugin and sign-out are handled)
- Map stubs: now use `requireAuth` middleware (401 without session, 501 with session)
- Geocode/route stubs: remain unprotected 501

**Test suite (`worker/src/index.test.ts`):**
- Auth tests: `GET /api/auth/ok` returns 200 (Better Auth health), `GET /api/auth/get-session` returns 200 with null body (no active session)
- Map tests: all 5 routes (GET/POST maps, GET/PUT/DELETE maps/:id) return 401 without session; response body has `{ error: 'Unauthorized' }`
- Geocode/route/unknown route tests unchanged from M1

**Vitest config (`worker/vitest.config.ts`):**
- Test-only secrets injected via `miniflare.bindings` (all 11 env secrets including `BETTER_AUTH_URL`)
- CJS deps inlined for workerd compatibility: `@better-auth/passkey`, `@simplewebauthn/server`, `@peculiar/*`, `tslib`

**Deferred to later milestones:**
- Cookie cache for session management (TODO comment in migration, deferred to M8)
- Email verification on sign-up (accepted risk for MVP, noted in `auth.ts`)
- `GET /api/maps/:id` currently uses `requireAuth` — will switch to optional auth in M6 when public map access is implemented

---

### Milestone 3: Map Display & Geocoding ✅ COMPLETE

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

#### Implementation Notes (M3)

**Files created (5 total):**

```
mapadillo/
├── src/
│   ├── vite-env.d.ts               [NEW]   # /// <reference types="vite/client" /> for ?inline CSS imports
│   ├── services/
│   │   └── geocoding.ts            [NEW]   # searchPlaces() → /api/geocode proxy, returns GeocodingResult[]
│   ├── components/
│   │   ├── map-view.ts             [NEW]   # MapLibre GL wrapper (OpenFreeMap Bright, shadow DOM CSS)
│   │   └── location-search.ts      [NEW]   # Debounced autocomplete (300ms) with wa-input + dropdown
│   └── pages/
│       └── trip-builder-page.ts             # Rewritten: sidebar (search) + full-screen map layout
└── worker/
    └── src/
        ├── index.ts                         # Geocode route (requireAuth + RATE_LIMITER_PROXY), milestone: 3
        ├── index.test.ts                    # 23 tests (was 22): +4 geocode tests, -2 old stubs
        └── routes/
            └── geocode.ts          [NEW]   # Photon proxy with KV caching (7-day TTL)
```

**Map view (`src/components/map-view.ts`):**
- Shadow DOM component wrapping MapLibre GL JS v5.x
- MapLibre CSS imported as inline string via Vite `?inline` and applied to shadow root via `unsafeCSS()` — required because the map container lives inside the shadow DOM
- OpenFreeMap Bright style: `https://tiles.openfreemap.org/styles/bright` (free, no API key)
- Default view: world-centered (lon: 0, lat: 20, zoom: 2)
- `NavigationControl` (zoom/rotation) in top-right corner
- `ResizeObserver` on the container calls `map.resize()` for correct rendering on layout changes
- Public API: `flyTo(lng, lat, zoom?)`, `addMarker(lng, lat, label?)`, `clearMarkers()`, `get map()`
- Markers use brand orange (`#ff6b00`); optional label shown as MapLibre `Popup` (auto-opened on add)
- Dispatches `map-ready` event (bubbles + composed) after map loads

**Location search (`src/components/location-search.ts`):**
- `wa-combobox` [Pro] with `autocomplete="none"` — server controls filtering, combobox shows all slotted options as-is
- Magnifying-glass icon in `start` slot, `wa-spinner` in `end` slot during loading
- Debounces `input` event at 300ms via `setTimeout` — clears on each keystroke before re-scheduling
- Minimum 2 characters before searching
- Dynamic `wa-option` children rendered from async search results; `value` is index-based (`String(i)`), `label` set explicitly to place name for clean display after selection
- Each option shows `wa-icon location-dot` (jelly, brand orange) + name + detail span (city, state, country)
- Empty state: disabled `wa-option` with "No places found" when search completes with no results
- On selection (`change` event): looks up `GeocodingResult` by index, fires `location-selected` CustomEvent (detail: `GeocodingResult`, bubbles + composed)
- Gains for free vs. custom dropdown: ARIA combobox pattern (keyboard nav, live region announcements), viewport-aware popup positioning, native focus/blur handling (no mousedown/preventDefault hack)

**Geocoding service (`src/services/geocoding.ts`):**
- `searchPlaces(query, lang?, limit?)` → `GeocodingResult[]`
- Calls `GET /api/geocode?q=...&lang=...&limit=...` (session cookie sent automatically by browser)
- Parses Photon's GeoJSON `FeatureCollection` into flat `GeocodingResult` objects with `name`, `city`, `state`, `country`, `latitude`, `longitude`
- Returns empty array on any error (non-throwing)

**Worker geocoding proxy (`worker/src/routes/geocode.ts`):**
- `GET /api/geocode?q=Berlin&lang=en&limit=5`
- Requires auth (`requireAuth` middleware) + rate-limited at 30/min per user ID (`RATE_LIMITER_PROXY`)
- Validates `q` (required, min 2 chars); clamps `limit` to 1–10
- KV cache key: `geocode:{SHA256(lowercase_query:lang:limit)[0:16]}` — case-insensitive cache hits
- Cache read: returns immediately if KV hit
- Proxy: `GET https://photon.komoot.io/api?q=...&lang=...&limit=...`
- Outbound fetch wrapped in try/catch → returns 502 on network failure
- Cache write: `API_CACHE.put(key, body, { expirationTtl: 604_800 })` — 7-day TTL
- KV write is best-effort (try/catch): failures are swallowed because cache is non-critical. This also avoids Miniflare isolated storage errors in tests

**Trip builder page (`src/pages/trip-builder-page.ts`):**
- Replaced M1 stub with sidebar + map layout
- Sidebar (380px, min 300px): heading with compass icon, "Add a stop" section with `<location-search>`, M4 callout
- Map panel: `<map-view>` filling remaining width
- On `location-selected` event: clears previous markers, drops new marker with name label, flies to location
- Responsive: stacks vertically below 700px viewport width (sidebar on top, map below)

**Worker changes (`worker/src/index.ts`):**
- Health check returns `milestone: 3`
- Geocode route: `requireAuth` → rate limit middleware (30/min per user) → `geocodeHandler`
- Rate limit middleware inline: reads `c.get('user').id` (set by requireAuth), calls `RATE_LIMITER_PROXY.limit()`

**Test suite (`worker/src/index.test.ts`):**
- 23 tests (was 22 in M2)
- New geocode tests (4):
  - 401 without session
  - 400 when `q` param missing
  - 400 when `q` too short (< 2 chars)
  - Integration test: proxies to Photon, returns GeoJSON `FeatureCollection` (gracefully handles 502/500 in restricted test environments)
- Removed: 2 old geocode stub tests (501 + "mentions Milestone 3")
- Health check updated: expects `milestone: 3`

**Deliberate deviations from plan:**

1. **KV write uses `await` + try/catch instead of `waitUntil`.** The plan implies non-blocking cache writes via `executionCtx.waitUntil()`, but `app.request()` in Hono tests provides a fake execution context whose `waitUntil` is a no-op — resulting in floating promises that break Miniflare's isolated storage tracking. Using `await` with try/catch ensures writes complete within the request lifecycle and errors are handled gracefully. In production, the ~1ms KV write latency is negligible.

2. **`vite-env.d.ts` added.** Not in the plan. Required for TypeScript to understand Vite's `?inline` CSS import syntax used by `map-view.ts`. Standard Vite project file.

3. **Responsive layout on trip builder.** Plan doesn't mention responsive behavior for M3, but a basic `@media (max-width: 700px)` breakpoint was trivial to add: sidebar stacks above map on narrow viewports.

---

### Milestone 4: Trip Builder (CRUD) ✅ COMPLETE

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

#### Implementation Notes (M4)

**Files created/modified (19 files):**

```
mapadillo/
├── src/
│   ├── index.ts                          # Added wa-badge, wa-details, wa-dialog, wa-radio, wa-radio-group, wa-relative-time imports
│   ├── router.ts                         # Refactored DIY router (Lit ReactiveController, URLPattern + Navigation API)
│   ├── router.test.ts            [NEW]   # 11 tests: construction, outlet, popstate, guards, params, errors
│   ├── nav.ts                            # Refactored: navigateTo() + navClick() helpers with deduplication
│   ├── nav.test.ts               [NEW]   # 7 tests: Navigation API path, fallback path, deduplication
│   ├── services/
│   │   ├── api-client.ts         [NEW]   # Generic JSON fetch wrapper (apiGet/Post/Put/Delete, ApiError class)
│   │   ├── api-client.test.ts    [NEW]   # 17 tests: all HTTP methods, error body extraction, 204 handling
│   │   ├── maps.ts               [NEW]   # Typed wrappers: map CRUD + stop CRUD (addStop, updateStop, deleteStop, reorderStops)
│   │   └── maps.test.ts          [NEW]   # 9 tests: all map and stop operations
│   ├── components/
│   │   ├── app-shell.ts                  # Added /map/new + /map/:id routes, "My Trips" nav button
│   │   ├── stop-card.ts          [NEW]   # Stop card with icon-picker, name/label inputs, travel mode, drag handle
│   │   ├── stop-list.ts          [NEW]   # Drag-and-drop stop list (native HTML DnD API)
│   │   ├── icon-picker.ts        [NEW]   # Dialog-based picker: 40 Jelly icons in 8 categories
│   │   ├── save-indicator.ts     [NEW]   # Status display: idle/saving/saved/error with 3s auto-hide
│   │   ├── travel-mode-picker.ts [NEW]   # 5-mode horizontal button bar (drive/walk/bike/plane/boat)
│   │   └── map-card.ts           [NEW]   # Dashboard card: non-interactive MapLibre preview + metadata
│   └── pages/
│       ├── trip-builder-page.ts          # Full rewrite: sidebar + map, auto-save, stop management, marker sync
│       └── dashboard-page.ts             # Rewritten: map grid via listMaps(), delete with confirm
└── worker/
    └── src/
        ├── index.ts                      # Mounted maps sub-app, requireAuth on /api/maps, milestone: 4
        ├── index.test.ts                 # 54 tests (was 23): +map CRUD, stop CRUD, reorder, cascade, ownership
        └── routes/
            └── maps.ts           [NEW]   # Hono sub-app: full map + stop CRUD with D1 (414 lines)
```

**No new npm dependencies.** All packages were already present from earlier milestones.

**Worker maps API (`worker/src/routes/maps.ts`):**
- Hono sub-app with `getOwnedMap()` helper centralizing 404/403 ownership checks + `isResponse()` type guard
- Map CRUD: `POST /` (requires `name`), `GET /` (list with batched stop queries via `DB.batch()`), `GET /:id`, `PUT /:id` (partial update with field validation), `DELETE /:id` (CASCADE handles stops)
- Stop CRUD: `POST /:id/stops` (auto-increment position via `MAX(position)`), `PUT /:id/stops/:stopId`, `DELETE /:id/stops/:stopId` (re-compacts positions + nulls travel_mode on promoted first stop via `DB.batch()`), `PUT /:id/stops/reorder` (validates all IDs present, no duplicates)
- Server-side validation: `VALID_ICONS` set (40 icons matching client picker), `VALID_TRAVEL_MODES` set (drive/walk/bike/plane/boat)
- First stop invariant: `travel_mode` forced to `null` on position 0 — enforced on create, reorder, and delete-promoted
- All stop mutations update parent map's `updated_at` timestamp
- Reorder route declared before `/:id/stops/:stopId` to avoid `reorder` matching as a `:stopId` param

**API client (`src/services/api-client.ts`):**
- `ApiError` class (extends `Error`) with `status` and `body` properties
- `apiGet<T>`, `apiPost<T>`, `apiPut<T>`, `apiDelete<T>` — all include `credentials: 'same-origin'`
- 204 No Content returns `undefined`; error body extraction tries JSON → text → null fallback

**Maps service (`src/services/maps.ts`):**
- Typed wrappers: `MapData`, `Stop`, `MapWithStops` interfaces matching D1 schema
- Map operations: `createMap`, `listMaps`, `getMap`, `updateMap`, `deleteMap`
- Stop operations: `addStop`, `updateStop`, `deleteStop`, `reorderStops`

**Stop card (`src/components/stop-card.ts`):**
- `wa-card` with left border colored by travel mode (orange/green/teal/blue/navy)
- Top row: grip-vertical drag handle, `<icon-picker>`, name `wa-input`, trash delete button
- Label row: editable `wa-input`
- Coordinates display (5 decimal places)
- `<travel-mode-picker>` shown above card for non-first stops
- Fires `stop-update { stopId, field, value }` and `stop-delete { stopId }` events (bubbles + composed)

**Stop list (`src/components/stop-list.ts`):**
- Native HTML Drag and Drop API (`draggable="true"`, `dragstart`/`dragover`/`drop`/`dragend`)
- Drop position calculated from cursor Y vs. card midpoint
- Dragged card gets `opacity: 0.4`; 3px orange drop indicator between cards
- Empty state: `wa-callout` prompting to search for places
- Fires `stops-reorder { order: string[] }` event; bubbles child `stop-update`/`stop-delete` events

**Icon picker (`src/components/icon-picker.ts`):**
- `wa-dialog` with 40 icons in 8 categories: Outdoors (8), Food & Drink (5), Sightseeing (5), Accommodation (2), Fun (6), Transport (6), People (2), Checklist (6)
- Responsive grid (`auto-fill, minmax(4rem, 1fr)`), selected icon gets orange border
- Fires `icon-change` with icon name string

**Save indicator (`src/components/save-indicator.ts`):**
- 4 states: `idle` (hidden), `saving` (spinner), `saved` (checkmark, green, auto-hides after 3s), `error` (xmark, red)
- Status reflected to attribute for CSS-based visibility control

**Travel mode picker (`src/components/travel-mode-picker.ts`):**
- 5 horizontal buttons: car/drive (orange), compass/walk (green), person-biking/bike (teal), plane/plane (blue), ship/boat (navy)
- Active mode gets colored bottom border + matching text color
- Fires `mode-change` with mode string

**Map card (`src/components/map-card.ts`):**
- Non-interactive MapLibre map preview (200px height, OpenFreeMap Bright style)
- Adds orange markers for each stop, fits bounds on load (`padding: 30, maxZoom: 12`)
- Shows trip name (h3), family name, stop count, `<wa-relative-time>` for last update
- Trash button fires `map-delete { mapId }`; card click navigates to `/map/${id}`
- Cleans up MapLibre instance in `disconnectedCallback`

**Trip builder page (`src/pages/trip-builder-page.ts`):**
- Sidebar (380px) + full-screen map panel; stacks vertically below 700px
- New trip flow: creates "Untitled Trip" server-side immediately via `createMap()`, replaces URL with `history.replaceState` (no extra history entry)
- Metadata auto-save: 2500ms debounce on name/family_name inputs
- Stop save strategy: `icon` and `travel_mode` save immediately; `name` and `label` debounce at 1500ms per stop per field (keyed by `${stopId}:${field}` to avoid clobbering concurrent edits)
- Stop deletion: optimistic local removal → API call → full map reload for re-compacted positions
- Stop reorder: optimistic local reorder (including nulling first-stop travel_mode) → API call → full map reload
- Marker sync: `_syncMarkers()` clears all, adds per-stop markers, fits bounds (2+ stops) or flies to single stop
- Map-ready coordination: `_pendingSync` flag defers marker sync if data arrives before MapLibre loads

**Dashboard page (`src/pages/dashboard-page.ts`):**
- Fetches maps via `listMaps()` on connect
- Responsive grid (`auto-fill, minmax(280px, 1fr)`) of `<map-card>` components
- Empty state: dashed border box with "No trips yet!" + "Create New Trip" button → `/map/new`
- Delete: `window.confirm()` → `deleteMap()` → optimistic removal from local list
- "Shared with Me" section: static empty state placeholder (M6)

**Router + nav refactoring:**
- `router.ts`: Lit reactive controller with URLPattern matching, Navigation API handler + `popstate` fallback, optional async `enter()` guard, `outlet` getter for current template
- `nav.ts`: `navigateTo(path)` uses Navigation API when available, falls back to `history.pushState()` + `popstate` dispatch; `navClick(path)` returns click handler; both skip navigation if already at target URL
- `router.test.ts` (11 tests): construction, outlet, popstate fallback, disconnect cleanup, navigation, guards with redirect, route params, error handling. Uses `FakeURLPattern` stub (happy-dom lacks URLPattern)
- `nav.test.ts` (7 tests): Navigation API path, fallback path, deduplication

**App shell changes (`src/components/app-shell.ts`):**
- 5 routes: `/`, `/sign-in`, `/dashboard` (guarded), `/map/new` (guarded, empty `mapId`), `/map/:id` (guarded, `mapId` from params)
- Header nav: "My Trips" plain button → `/dashboard` (authenticated), "Sign In" brand button (unauthenticated)
- `wa-page` has `disable-navigation-toggle` CSS workaround (bug [#1601](https://github.com/shoelace-style/webawesome/issues/1601))

**Test suite (`worker/src/index.test.ts`) — 54 tests:**
- `beforeAll` applies D1 table migrations inline (CREATE TABLE statements)
- `createTestSession()` helper: creates user + session in D1, signs session token with HMAC-SHA256 matching Better Auth
- `jsonRequest()`, `createMap()`, `createStop()` test helpers reduce boilerplate

| Describe Block | Tests |
|----------------|-------|
| Health check | 3 |
| Auth routes | 3 |
| Map routes - require auth (401) | 8 |
| Map CRUD | 12 |
| Map ownership | 4 |
| Stop CRUD | 9 |
| Stop reorder | 5 |
| Cascade delete | 1 |
| First stop travel_mode nulling | 2 |
| Geocoding proxy (M3) | 3 |
| Routing stub (M5) | 2 |
| Unknown API routes | 2 |

**Frontend test suites:**

| Suite | Tests |
|-------|-------|
| `api-client.test.ts` | 17 |
| `maps.test.ts` | 9 |
| `router.test.ts` | 11 |
| `nav.test.ts` | 7 |

**Deliberate deviations from plan:**

1. **Stop text fields debounced at 1500ms.** Plan says "stop changes save immediately." Icon and travel_mode changes do save immediately, but name/label inputs debounce at 1.5s to avoid excessive API calls during typing. Per-stop-per-field timer keys (`${stopId}:${field}`) prevent concurrent edits from clobbering each other.

2. **Native HTML Drag and Drop API instead of a library.** Plan says "drag-and-drop ordered list" without specifying implementation. Used native browser DnD API, consistent with the project's "bias towards native browser APIs" directive from CLAUDE.md.

3. **New trip creates server-side immediately.** Plan doesn't specify when the map record is created. Implementation creates an "Untitled Trip" via `createMap()` as soon as the user navigates to `/map/new`, then replaces the URL to `/map/{id}` with `history.replaceState`. This ensures every trip has a server-side ID from the start, simplifying auto-save and stop addition.

4. **Server-authoritative positions after mutations.** After stop deletion and reorder, the client reloads the full map from the server rather than recalculating positions locally. Ensures position consistency without duplicating server-side re-compaction logic.

5. **40 icons (not 38).** Plan mentions "38 curated icons" but the validated set contains 40 after adding additional icons during implementation. The `person-biking` icon is reserved for the travel-mode picker UI only and excluded from the stop icon picker, as specified in the plan's Map Elements section.

6. **`wa-page` navigation-toggle CSS workaround.** Added `wa-page::part(navigation-toggle), wa-page::part(navigation) { display: none; }` to hide the hamburger button that appears on mobile even when no `navigation` slot is used. This is a known wa-page bug ([#1601](https://github.com/shoelace-style/webawesome/issues/1601)); the workaround can be removed once fixed upstream.

**Deferred to later milestones:**
- Shared maps in dashboard listing (M6)
- Route drawing between stops (M5)
- Public/private map access (M6)
- Export and print ordering (M7, M9)

---

### Milestone 5: Route Drawing ✅ COMPLETE

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

#### Implementation Notes (M5)

**Files created/modified (6 files):**

```
mapadillo/
├── src/
│   ├── services/
│   │   └── routing.ts             [NEW]   # Per-segment routing: ORS proxy for drive/walk/bike, client-side for plane/boat
│   ├── map/
│   │   └── map-controller.ts      [NEW]   # MapController class: route layers, numbered markers, bounds fitting
│   └── pages/
│       └── trip-builder-page.ts           # Rewritten: MapController integration, route stats, distance display
└── worker/
    └── src/
        ├── index.ts                       # Mounted route handler with requireAuth + rate limit, milestone: 5
        ├── index.test.ts                  # 64 tests (was 54): +8 routing proxy tests, -2 old stubs
        └── routes/
            └── route.ts           [NEW]   # ORS proxy with KV caching (24h TTL)
```

**No new npm dependencies.** All packages were already present from earlier milestones.

**Worker routing proxy (`worker/src/routes/route.ts`):**
- `POST /api/route` with JSON body `{ profile, start: [lon,lat], end: [lon,lat] }`
- Valid profiles: `driving-car`, `foot-walking`, `cycling-regular`
- Validates coordinates: must be `[number, number]` arrays within valid lon/lat ranges
- KV cache key: `route:{profile}:{SHA256(start_lon,start_lat,end_lon,end_lat)[0:32]}` — 24-hour TTL
- Proxies to `POST https://api.openrouteservice.org/v2/directions/{profile}/geojson`
- Auth via `ORS_API_KEY` env secret in Authorization header
- Returns ORS GeoJSON `FeatureCollection` directly (no transformation)
- Forwards 429 from ORS as 429 to client; all other errors → 502
- KV write is best-effort (try/catch) — consistent with geocode proxy pattern

**Frontend routing service (`src/services/routing.ts`):**
- `getSegmentRoute(mode, start, end)` → `{ coordinates, distance }` (meters)
- Drive/Walk/Bike: maps mode to ORS profile, calls `POST /api/route` via `apiPost()`
- Plane: client-side great-circle arc via spherical interpolation (64 segments), Haversine distance
- Boat: straight-line GeoJSON `LineString`, Haversine distance
- Falls back to straight line for unknown modes or ORS failures
- Exported `haversineDistance()` utility for distance calculations

**Map controller (`src/map/map-controller.ts`):**
- `MapController` class wraps a `maplibregl.Map` instance
- `drawRoutes(stops)`: fetches all segment geometries in parallel, renders layers + markers, fits bounds
- Each segment → own MapLibre source + layer with mode-specific paint:
  - Drive: solid #e05e00 (orange), width 5
  - Walk: dasharray [0, 2] #16a34a (green), width 4, round caps
  - Bike: dasharray [3, 2] #0d9488 (teal), width 4
  - Plane: dasharray [1, 2] #7c3aed (purple), width 3
  - Boat: dasharray [5, 3] #1e3a5f (navy), width 3
- Line opacity: 0.85 for visual distinction from map features
- AbortController cancels in-progress fetches when `drawRoutes()` is called again
- `clear()`: removes all layers, sources, and markers
- `destroy()`: aborts + clears (called on page disconnect)

**Numbered stop markers:**
- Custom DOM elements (not default MapLibre markers) with two parts:
  - Badge: orange circle (#ff6b00) with white number, 1.4rem, bold
  - Pin: white circle with orange border, containing `<wa-icon>` with the stop's chosen Jelly icon
- Popup on hover/click: stop name + optional label
- Anchored at bottom for proper positioning

**Trip builder page changes (`src/pages/trip-builder-page.ts`):**
- Replaced `_syncMarkers()` with `_syncMap()` — uses `MapController.drawRoutes()` instead of raw `addMarker()`
- MapController initialized in `_onMapReady()` from `mapView.map`
- Route section: shows total distance, stop count, segment count (replaces "coming soon" placeholder)
- Distance display: `_formatDistance()` converts meters → km or miles based on map units setting
- Route loading state: shows spinner while segments are being fetched
- `_debounceSyncMap()` (300ms): prevents excessive route fetches during rapid travel mode changes
- Units toggle updates distance display reactively (no re-fetch needed)
- `disconnectedCallback()`: calls `_mapController.destroy()` and clears route debounce timer
- Removed direct `maplibregl` import — all map interaction now through MapController

**Test suite (`worker/src/index.test.ts`) — 64 tests:**

| Describe Block | Tests |
|----------------|-------|
| Health check | 3 |
| Auth routes | 3 |
| Map routes - require auth (401) | 8 |
| Map CRUD | 12 |
| Map ownership | 4 |
| Stop CRUD | 9 |
| Stop reorder | 5 |
| Cascade delete | 1 |
| First stop travel_mode nulling | 2 |
| Geocoding proxy (M3) | 4 |
| Routing proxy (M5) | 8 |
| Unknown API routes | 2 |

New routing proxy tests (8):
- 401 without session
- 400 with invalid JSON body
- 400 with missing profile
- 400 with invalid profile name
- 400 with missing start coordinates
- 400 with out-of-range coordinates
- 400 with non-numeric coordinate types
- Integration test: proxies to ORS, returns GeoJSON FeatureCollection (gracefully skips on 502/500/429)

**Deliberate deviations from plan:**

1. **Plane line color is purple (#7c3aed) not "blue/purple".** Plan says "dotted blue/purple line." Used purple to clearly distinguish from boat (navy) and ensure all five modes have visually distinct colors.

2. **MapController is a standalone class, not extending map-view.** Plan says "Extend map-controller.ts." Created `MapController` as a separate class that accepts a `maplibregl.Map` instance, rather than subclassing the Lit `<map-view>` component. This is cleaner separation of concerns: `<map-view>` manages the MapLibre lifecycle, `MapController` manages route rendering.

3. **Default travel mode.** Stops without an explicit `travel_mode` default to `'drive'` in the MapController. The plan doesn't specify a default for unset travel modes on non-first stops. Drive is the most common road trip mode.

4. **Route debouncing at 300ms.** Not in plan. Added to prevent excessive ORS calls when rapidly clicking through travel mode options. Travel mode changes trigger immediate save to D1 (as before) but route re-draw is debounced.

5. **Browser locale-based units default not implemented.** Plan says "default based on browser locale." The existing D1 default (`'km'`) is used. Locale-based defaulting would need to be set at map creation time — deferred as it requires passing locale info to the create endpoint.

**Deferred to later milestones:**
- Sharing & collaboration (M6)
- Export/print (M7, M9)
- Browser locale-based units default (M8 polish)

---

### Milestone 6: Sharing & Collaboration ✅ COMPLETE

**Goal:** Maps can be shared via invite links, or made public. Also: unified map items refactor (points + routes).

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

#### Implementation Notes (M6)

**Combined with Unified Items Refactor.** This milestone also introduced the unified map items model: maps now contain two types of items — **points** (standalone markers) and **routes** (A→B travel segments). The `stops` table was extended with `type`, `dest_name`, `dest_latitude`, `dest_longitude` columns via migration `0004_unified_items.sql`. The UI was refactored from `stop-card.ts` / `stop-list.ts` to `point-card.ts`, `route-card.ts`, and `item-list.ts`.

**Files created/modified (17 files):**

```
mapadillo/
├── src/
│   ├── utils/
│   │   └── geo.ts                 [NEW]   # Shared isDraftCoord() + formatDistance() utilities
│   ├── styles/
│   │   └── card-shared.ts         [NEW]   # Shared CSS for point-card + route-card (drag handle, delete btn)
│   ├── components/
│   │   ├── stop-card.ts           [DELETED] # Replaced by point-card.ts + route-card.ts
│   │   ├── stop-list.ts           [DELETED] # Replaced by item-list.ts
│   │   ├── point-card.ts          [NEW]   # Standalone point card (icon picker, name/label, coordinates)
│   │   ├── route-card.ts          [NEW]   # A→B route card (start/end search, travel mode, distance)
│   │   ├── item-list.ts           [NEW]   # Pointer-based drag-and-drop list (mouse + touch)
│   │   ├── map-card.ts                    # Updated: route destination markers, isDraftCoord
│   │   ├── share-dialog.ts                # Full rewrite: visibility toggle, invite links, collaborator list
│   │   └── location-search.ts             # Added configurable placeholder property
│   ├── map/
│   │   └── map-controller.ts              # Rewritten: unified drawItems(), point + route rendering
│   ├── pages/
│   │   └── trip-builder-page.ts           # Rewritten: unified item management, role-based UI, sharing
│   └── services/
│       └── maps.ts                        # Added: sharing ops, duplicateMap, MapWithRole, ShareData types
└── worker/
    └── src/
        ├── routes/
        │   ├── maps.ts                    # Role-based access (getMapWithRole), route item CRUD, duplicate
        │   └── sharing.ts         [NEW]   # Shares CRUD, visibility toggle, claim endpoint
        └── db/
            ├── types.ts                   # Added: StopRow.type + dest_* fields, ShareRow interface
            └── migrations/
                └── 0004_unified_items.sql [NEW] # ALTER TABLE: type, dest_name, dest_latitude, dest_longitude
```

**Sharing system (`worker/src/routes/sharing.ts`):**
- `getMapWithRole(db, mapId, userId)` centralized access control: owner → editor/viewer (via share) → public → null
- `POST /:id/shares` generates invite links with UUID claim tokens, rate-limited at 60/min per user
- `POST /api/shares/claim/:token` auto-claims invite (race-condition safe via `WHERE user_id IS NULL AND claim_token = ?`); nullifies claim token on use; handles duplicate user+map shares by merging (keeps higher-privilege role)
- `PUT /:id/visibility` toggles public/private
- `POST /:id/duplicate` forks map + all stops with new UUIDs; duplicated map is always private

**Share dialog (`src/components/share-dialog.ts`):**
- `wa-dialog` with three sections: visibility toggle (wa-switch), invite link generator (role picker + generate button + copy URL), collaborators list
- Collaborators show claimed (user info + role select + remove) vs. pending (invite URL + role badge + copy + remove)
- Optimistic updates for role changes with revert on failure

**Unified items model:**
- `Stop.type` discriminator: `'point'` (standalone marker) or `'route'` (A→B with travel mode + destination)
- Routes have `dest_name`, `dest_latitude`, `dest_longitude` for the B endpoint; start uses existing `latitude`/`longitude`
- `route-card.ts`: inline `<location-search>` for start/end, `<travel-mode-picker>`, distance display; fires `item-update-batch` for coordinate changes
- `item-list.ts`: pointer-based drag-and-drop (replaces native HTML DnD), works on touch devices; clone visual during drag
- `map-controller.ts`: `drawItems()` handles both types — points get single markers, routes get line layers + start/end markers

**Shared utilities (`src/utils/geo.ts`):**
- `isDraftCoord(lat, lng)` — centralized `(0,0)` sentinel check (was duplicated in 3 files)
- `formatDistance(meters, units)` — centralized distance formatting (was duplicated in 2 files)

**Deliberate deviations from plan:**

1. **Unified items model added to M6.** Plan treats points and routes as separate concepts introduced at different milestones. Implementation unified them in M6 since sharing requires rendering both item types correctly for public/read-only views.

2. **Pointer-based drag-and-drop replaces native HTML DnD.** `item-list.ts` uses Pointer Events API instead of the HTML Drag and Drop API (used in the old `stop-list.ts`). Pointer Events work on touch devices natively; HTML DnD does not.

3. **`_syncMap` optimized.** Delete and reorder operations now use `_debounceSyncMap()` (300ms debounce) instead of calling `_syncMap()` twice (once for optimistic, once for server response). Reorder uses `reorderStops()` return value directly instead of a redundant `getMap()` call.

4. **`_totalDistance` is a derived getter.** Changed from `@state()` property to a getter that sums `_routeDistances`, eliminating redundant state.

**Deferred to later milestones:**
- Print ordering (M9)
- Browser locale-based units default (M8 polish)

---

### Milestone 7: Export (PDF / Image) ✅ COMPLETE

**Goal:** Users can download print-quality maps.

**Build:**
1. Build `map-preview-page.ts` — full-screen styled map with all stops + route
2. Integrate `@watergis/maplibre-gl-export` for 200 DPI rendering (cap max canvas at 5400px, graceful error if device can't allocate)
3. Build `map-export.ts` — PNG/JPEG download
4. Build decorative PDF layout with jsPDF (title, family name, stop list, border, road trip stats)
5. Build `export-options.ts` — format selection UI
6. Build `export-page.ts` — ties together preview, options, and download actions

**Verify:**
- Export PDF — opens with trip title, map image, stop list, decorative border
- Export PNG — correct resolution (200 DPI, within canvas limits)
- Both formats include all stops and route

#### Implementation Notes (M7)

**Core export architecture (`src/map/map-export.ts`):** Subclasses `MapGeneratorBase` from `@watergis/maplibre-gl-export` to create `MapExporter`. Overrides `getRenderedMap()` to produce an offscreen MapLibre map at the computed pixel dimensions. `renderCanvas()` creates a hidden DOM container, renders the map at high-res, waits for `'idle'` event, clones the canvas data, draws custom markers on top (since DOM-based MapLibre markers are not captured by `getStyle()`), then cleans up the temp map. Has a 30-second timeout guard to prevent hanging promises.

**Marker drawing on export canvas:** Since MapLibre DOM markers don't appear in style-based canvas rendering, `drawMarkersOnCanvas()` projects each stop's lngLat to pixel coords on the temp map and draws branded circles (white fill, orange border, center dot). Checklist-type icons get an open square instead of a dot.

**PDF layout:** A3 landscape (420×297mm). Left 2/3 is the map image (aspect-ratio preserved), right 1/3 is an info panel with: trip title (orange, bold), family name (gray), horizontal rule, numbered stops list (bullet points, truncated with `...` if panel overflows), horizontal rule, trip stats (total distance using routed distances when available with haversine fallback, stop count, route count), and footer with "Made with Mapadillo" + OSM attribution.

**Page architecture — `MapPageBase` (`src/pages/map-page-base.ts`):** Shared base class for `map-preview-page` and `export-page`. Handles: map data loading via `getMap()`, `MapController` lifecycle (create on `map-ready`, destroy on disconnect), pending-sync coordination (if data loads before map is ready, defers `_syncMap()` until `map-ready` fires), auth redirect for 401 errors.

**New routes:** `/preview/:id` (full-screen read-only map with overlay showing trip name + Back/Export buttons) and `/export/:id` (split layout: map left, sidebar right with trip info + export controls). Export route requires auth; preview does not.

**Trip builder integration:** Added Preview and Export buttons to `trip-builder-page.ts` below the map details section, linking to `/preview/:id` and `/export/:id`.

**Files created (5 new):**

```
mapadillo/
├── src/
│   ├── components/
│   │   └── export-options.ts      [NEW]  # Format picker (PDF/PNG/JPEG radio group) + download button
│   ├── map/
│   │   └── map-export.ts          [NEW]  # MapExporter class, PNG/JPEG/PDF download, marker rendering
│   └── pages/
│       ├── map-page-base.ts       [NEW]  # Shared base: map loading, MapController lifecycle, sync
│       ├── map-preview-page.ts    [NEW]  # Full-screen read-only map view with overlay controls
│       └── export-page.ts         [NEW]  # Split layout: map panel + sidebar with export options
└── worker/
    └── src/
        └── env.d.ts               [NEW]  # Module declaration for cloudflare:test ProvidedEnv
```

**Files modified (17 existing):**

```
src/
├── components/
│   ├── app-shell.ts                      # Added /preview/:id and /export/:id routes
│   ├── point-card.ts                     # Fixed: wa-input → @input (native event)
│   └── share-dialog.ts                   # Fixed: wa-change → @change, wa-switch/wa-select events
├── index.ts                              # Added WA component imports: select, switch, tooltip
├── pages/
│   ├── sign-in-page.ts                   # Passkey failure now signs out half-auth session
│   └── trip-builder-page.ts              # Added Preview/Export buttons; wa-input/wa-change → native events
├── services/
│   └── routing.ts                        # Moved haversineDistance/toRad/toDeg to utils/geo.ts (imports)
└── utils/
    └── geo.ts                            # Added: toRad(), toDeg(), haversineDistance(), sanitizeFilename()
worker/src/
├── auth.ts                               # autoSignIn: true, emailVerification config, any-typed cache
├── index.ts                              # Milestone 7, CSRF protection, rate limiting, claim_token fix
├── index.test.ts                         # Unified items in test schema, CSRF Origin headers, type: 'route'
├── middleware/optional-auth.ts           # Auth type compatibility fix
├── middleware/require-auth.ts            # Auth type compatibility fix
└── routes/
    ├── maps.ts                           # Typed .catch() callbacks to fix TS union narrowing
    └── sharing.ts                        # Typed .catch() callbacks to fix TS union narrowing
```

**Deliberate deviations from plan:**

1. **200 DPI instead of originally planned 150 DPI.** Implementation uses 200 DPI as the default — better print quality while still within canvas limits on most devices. The 5400px cap ensures graceful degradation.

2. **CSRF protection added.** Not in M7 plan scope. Origin header validation on all state-changing `/api/*` requests (skips webhooks and auth routes which handle their own CSRF). Added because export page is accessible to authenticated users navigating from external links.

3. **Web Awesome event name fixes.** Changed `@wa-input` → `@input`, `@wa-change` → `@change` across point-card, share-dialog, trip-builder-page, sign-in-page. Web Awesome Pro components fire native DOM events, not prefixed custom events.

4. **Passkey failure now signs out.** `sign-in-page.ts` now calls `authClient.signOut()` when passkey registration fails after account creation, preventing half-authenticated sessions with no usable credential.

5. **Geo utilities consolidated in `utils/geo.ts`.** `haversineDistance()`, `toRad()`, `toDeg()` moved from `routing.ts` to `utils/geo.ts` (alongside existing `isDraftCoord`, `formatDistance`). Added `sanitizeFilename()` for export filenames. Single source of truth for geo math.

6. **`worker/src/env.d.ts` added for test type safety.** Augments `cloudflare:test`'s `ProvidedEnv` to extend the project's `Env` interface, resolving 18 TS errors on `env.DB`, `env.BETTER_AUTH_SECRET`, etc. in test files.

**Deferred to later milestones:**
- Print ordering (M9)
- Browser locale-based units default (M8 polish)

---

### Milestone 8: Polish & Launch Prep

**Goal:** Production-ready quality.

**Build:**
1. Responsive design pass (mobile-friendly trip builder + sign-in)
2. Loading states, error handling, empty states throughout all pages
3. OpenStreetMap / OpenFreeMap attribution on all map views

**Verify:**
- All pages usable on mobile
- Empty states display correctly (no maps, no stops)
- Error states handled gracefully (API failures, network errors)
- Attribution visible on map

#### Implementation Notes (M8)

**1. Responsive design pass**

- **Shared page layout styles** (`src/styles/page-layout.ts`): Extracted sidebar + map-panel layout into reusable `pageLayoutStyles` CSS. Desktop: 380px sidebar with border, flex map panel. Mobile (`≤700px`): stacks vertically, sidebar capped at `45vh`, map gets `min-height: 300px`. Also exports `familyNameStyles` (quiet subtitle text) and moved stat-row/loading-center styles here.
- **Shared heading styles** (`src/styles/heading-shared.ts`): Reusable `headingStyles` for `h1` with brand color + weight, used by landing, export, and trip-builder pages.
- **Trip builder** (`src/pages/trip-builder-page.ts`): Extends `MapPageBase` instead of `LitElement` directly. Desktop sidebar pins header/footer with scrollable `.sidebar-scroll` middle section. Uses `pageLayoutStyles` for responsive stacking.
- **Export page** (`src/pages/export-page.ts`): Removed ~100 lines of duplicated layout CSS, replaced with `pageLayoutStyles` + `headingStyles` + `familyNameStyles`.
- **Map preview page** (`src/pages/map-preview-page.ts`): Added `@media (max-width: 700px)` rules — overlay stretches full width, actions wrap.
- **Sign-in page** (`src/pages/sign-in-page.ts`): Replaced inline `style` attributes with CSS classes (`.full-width`, `.divider-row`). Extracted `_renderSocialButtons(prefix)` and `_renderDivider()` helpers to DRY up sign-in vs register modes.
- **App shell header** (`src/components/app-shell.ts`): Mobile-responsive header — tighter padding and smaller logo text/icon at `≤700px`.
- **Dashboard** (`src/pages/dashboard-page.ts`): Uses `wa-grid` with `--min-column-size: 280px` for responsive card layout. Removed greeting paragraph. Uses design tokens instead of hardcoded colors.

**2. Loading, error, and empty states**

- **Dashboard**: Added `_fetchError` state — shows `wa-callout variant="danger"` on API failure instead of silent empty state. Added `_deleteError` with auto-dismiss timer. Loading state uses centered `wa-spinner`.
- **Trip builder**: Save status indicator moved inline into sidebar header — animated spinning icon (saving), green check (saved), red X (error) with CSS `@keyframes spin`. Removed standalone `save-indicator.ts` component entirely.
- **Map preview**: Distinct loading spinner overlay vs error `wa-callout` overlay, both positioned absolutely over map.
- **Claim page** (`src/pages/claim-page.ts`): Replaced inline `style` on spinner with `.spinner` class. Error state shows callout + "Go to Dashboard" button.
- **Router** (`src/router.ts`): Error and 404 fallback templates use CSS classes (`.router-callout`) instead of inline styles.

**3. Attribution**

- **Map view** (`src/components/map-view.ts`): Disabled default attribution control, added compact `AttributionControl` explicitly. Centralized map style URL in `src/config/map.ts`.
- **Map export** (`src/map/map-export.ts`): Attribution is preserved in export renders via the compact control on the temp map.

**4. Dark mode**

- **`src/dark-mode.ts`** (new): Full dark-mode manager — persists preference to `localStorage` (`mapadillo-dark-mode`), falls back to `prefers-color-scheme` media query. Toggles `wa-dark` class on `<html>` and sets `color-scheme`. Dispatches `dark-mode-change` CustomEvent on `document` for reactive component updates. Initialized once from `src/index.ts`.
- **User menu** (`src/components/user-menu.ts`): Added dark/light mode toggle dropdown item. Listens to `dark-mode-change` events to reactively update icon (sun/moon).

**5. Locale-based units**

- **`src/utils/geo.ts`**: Added `getDefaultUnits()` — detects preferred distance units from `navigator.language`. Returns `'mi'` for US, UK, Myanmar locales; `'km'` everywhere else. Also added `formatCoords()` utility.
- **Trip builder**: Calls `getDefaultUnits()` when creating new maps to set the default unit preference.

**6. Full-screen map editor (`wa-page` viewport lock)**

The trip builder page needs to fill exactly `100dvh` with no page-level scrollbar (sidebar scrolls internally). `wa-page` has no built-in attribute for this — its footer slot is designed to always push content below the viewport. The solution uses conditional `::part()` overrides on `wa-page` internals, toggled via a `[no-footer]` host attribute on `app-shell`:

1. **`::part(base) { height: 100dvh }`** — caps the grid at viewport height (internal default: `min-height: 100dvh` allows growth)
2. **`::part(footer) { display: none }`** — hides footer container (footer slot content also conditionally not rendered)
3. **`::part(body) { min-height: 0; align-items: stretch }`** — critical fix: internal default is `align-items: flex-start` which makes `main` content-sized (as tall as sidebar cards) instead of stretching to fill the constrained 1fr row. Override to `stretch` + `min-height: 0` (from internal `100%`) forces `main` to fill available space
4. **`::part(main) { min-height: 0 }`** — prevents expansion beyond grid track (internal: `min-height: 100%`)
5. **`::part(main-content) { display: flex; flex-direction: column; min-height: 0; overflow: hidden }`** — makes `main-content` a flex column so `trip-builder-page`'s `flex: 1` fills the remaining space

The `_isFullHeight` getter checks `location.pathname.startsWith('/map/')` to apply only to the trip builder and export pages. The router calls `requestUpdate()` on every navigation, so `location.pathname` is current during render.

**7. Code cleanup & architecture**

- **Shared types** (`shared/types.ts`): Moved `MapRow`, `StopRow`, `MapRole` from `worker/src/db/types.ts` to shared types used by both client and worker. Added `shared/icons.ts` (valid icon set) and `shared/travel-modes.ts` (valid travel modes) to eliminate duplication.
- **Navigation** (`src/nav.ts`): Added `navClick(path)` higher-order function for declarative `@click` handlers, replacing per-page `_navX` methods. Router's `navigate()` method removed — all navigation goes through `navigateTo()`.
- **Map controller** (`src/map/map-controller.ts`): Major refactor — uses GeoJSON sources + symbol/circle/line layers instead of DOM markers. Exports `renderMarkerCanvas()` for use in map export.
- **Map export** (`src/map/map-export.ts`): Added paper size support (`letter`, `a4`, `a3`, `tabloid`) with orientation (landscape/portrait). Zoom compensation formula (`Math.log2(scaleFactor)`) keeps exported extent matching the live view. Marker rendering now uses `renderMarkerCanvas()` (same composite images as live map) instead of hand-drawn circles.
- **Worker routes** (`worker/src/routes/maps.ts`): Extracted `requireEditableMap()` and `touchMapStmt()` helpers to reduce boilerplate across CRUD endpoints. Uses shared types/icons/travel-modes from `shared/`.
- **Landing page**: "Start Planning" button sends authenticated users to `/dashboard` instead of `/sign-in`.
- **Design tokens**: Replaced hardcoded values (`#e05e00`, `0.9rem`, `font-weight: 900`, `color: var(--wa-color-neutral-*)`) with Web Awesome semantic tokens (`--wa-color-brand-60`, `--wa-font-size-s`, `--wa-font-weight-bold`, `--wa-color-text-quiet`) throughout all components for dark-mode compatibility.

---

### Milestone 9: Print Ordering (Stripe + Prodigi)

**Goal:** Users can order a printed poster and receive it in the mail.

*Depends on M7 — export renders the image that gets uploaded for printing.*

**Build:**
1. Implement R2 image upload route in Worker (`POST /api/images/:map_id`) + `services/image-upload.ts`
2. Build client-side 200 DPI image render + upload flow — attempt render, upload on success, proceed to checkout regardless; pass `image_url` to checkout only if upload succeeded
3. Build `print-order-form.ts` — poster size selection ($19.99 / $29.99), shipping address form, shipping cost display (fetched from Prodigi quote)
4. Implement Prodigi quote route in Worker (`POST /api/print-quote`) — calls Prodigi quote API with poster size + shipping address → returns exact shipping cost
5. Implement Stripe Checkout session creation in Worker (`POST /api/checkout`) — poster price + quoted shipping as separate line items, user ID in metadata; `image_url` is optional
6. Build `services/stripe.ts` — Stripe Checkout session creation client
7. Implement Stripe webhook handler in Worker (`POST /api/webhooks/stripe`) — verify signature; **idempotency check** (`stripe_session_id` already in D1 → return 200, skip); create order record in D1; if `image_url` present → place Prodigi order immediately (status: `submitted`); if absent → set status `pending_render`, send admin notification via Cloudflare Email Workers
8. Implement Prodigi order placement in Worker (`worker/src/lib/prodigi.ts`) — called from both the webhook handler (auto path) and the admin endpoint (manual path)
9. Implement admin endpoint (`PATCH /api/admin/orders/:id`) — accepts `{ image_url }`, places Prodigi order, updates status to `submitted`; protected by `Authorization: Bearer {ADMIN_SECRET}` header
10. Implement Prodigi webhook handler in Worker (`POST /api/webhooks/prodigi`) — update order status + tracking URL
11. Build `order-confirmation-page.ts` — shows vague "We're preparing your map for print — shipping notification within 1–2 business days" copy regardless of path; shows tracking info once available
12. Dashboard: order history section (past print orders with status/tracking)

**Verify:**
- Render succeeds: image uploaded to R2, checkout completes, webhook places Prodigi order automatically (status: `submitted`)
- Render fails (simulate by skipping upload): checkout still completes, order created with `pending_render` status, admin notification email sent
- Admin calls `PATCH /api/admin/orders/:id` with image URL → Prodigi sandbox order placed, status updates to `submitted`
- Stripe webhook idempotency: deliver same webhook twice → only one order record, one Prodigi order
- Stripe Checkout with test keys + test card numbers — payment succeeds on both paths
- Prodigi webhook updates tracking info in D1
- Order confirmation page shows appropriate copy at each status
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
