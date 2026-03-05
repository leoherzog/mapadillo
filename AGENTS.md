# AGENTS.md

This file provides guidance to Claude Code, Codex, Gemini, etc when working with code in this repository.

## Commands

### npm install / npm update

`.npmrc` authenticates against private registries for Web Awesome Pro and Font Awesome Pro using `FONTAWESOME_AUTH_TOKEN` and `WEBAWESOME_NPM_TOKEN`. These tokens live in `.dev.vars`. Export them before running any install or update command:

```bash
export $(cat .dev.vars | xargs) && npm install
export $(cat .dev.vars | xargs) && npm update
```

### Frontend (root)
```bash
npm run dev          # Vite dev server (frontend only)
npm run build        # tsc + vite build → dist/
npm run preview      # Preview built dist/
npm run test:ui      # Run frontend tests (vitest, node env)
```

### Worker (full-stack local dev)
```bash
npm run dev:full     # Build frontend + apply local migrations + start Worker dev server
cd worker && npm run dev           # Worker only (wrangler dev)
cd worker && npm run migrate:local # Apply D1 migrations locally
cd worker && npm run deploy        # Deploy to Cloudflare
cd worker && npm run types         # Regenerate wrangler types after provisioning
cd worker && npm test              # Run worker tests (@cloudflare/vitest-pool-workers)
cd worker && npm run test:watch    # Watch mode
```

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

### Shared types

`shared/types.ts` is imported by both frontend (`tsconfig.json` includes `"shared"`) and worker (relative import `../../shared/types.js`). Contains `MapData`, `Stop`, `ShareData`, `ShareRow`, `MapRole`, `SessionUser`.

### Frontend: `src/`

- **Entry:** `src/index.ts` sets up the Lit `<app-shell>` and initializes auth
- **Router:** `src/router.ts` — DIY Lit reactive controller using `URLPattern` + Navigation API (no library). Routes defined as `{ path, render, enter? }` objects. `enter()` returns a redirect path string or `void`
- **Auth state:** `src/auth/auth-state.ts` — module-level singleton (`_user`, `_listeners`). Call `initAuth()` on load; `onAuthChange(fn)` for reactive components; `refreshAuth()` after passkey sign-in
- **Auth client:** `src/auth/auth-client.ts` — `createAuthClient()` from `better-auth/client`. Methods: `signIn.social({ provider })`, `signIn.passkey()`, `signUp.email()`, `signOut()`, `getSession()`
- **Auth guard:** `src/auth/auth-guard.ts` — used as `enter()` in route definitions
- **Services:** `src/services/` — `api-client.ts` base fetch wrapper (same-origin, no CORS); `maps.ts` typed CRUD wrappers; `geocoding.ts` → `/api/geocode`; `routing.ts` → `/api/route`
- **Map:** `src/map/map-controller.ts` manages MapLibre instance, draws stops + route segments; `src/map/map-export.ts` handles PDF/image export via `@watergis/maplibre-gl-export` + jsPDF
- **Config:** `src/config/travel-modes.ts`, `src/config/map.ts` — travel mode definitions and map constants

### Worker: `worker/src/`

- **Entry:** `worker/src/index.ts` — Hono app, mounts all routes
- **Auth:** Better Auth instance in `worker/src/auth.ts`, mounted at `/api/auth/*`
- **Middleware:** `auth.ts` (core auth factory, attaches `c.get('user')`), `require-auth.ts`, `optional-auth.ts`, `rate-limit.ts`
- **Routes:** `maps.ts` (CRUD + role checks via `getMapWithRole`), `sharing.ts` (shares + claim), `geocode.ts` (Photon proxy + KV cache), `route.ts` (ORS proxy + KV cache)
- **Lib:** `worker/src/lib/` — `hash.ts` (crypto hashing helpers). *Note: Prodigi and Stripe helpers are planned but not yet implemented.*
- **Types:** `worker/src/types.ts` defines `Env` (all bindings) and `AppEnv` (Hono generic)
- **DB types:** `worker/src/db/types.ts` re-exports from `shared/types.ts`
- **Migrations:** `worker/src/db/migrations/` — 4 migrations (0001–0004)

### Cloudflare bindings (`worker/wrangler.toml`)

| Binding | Type | Purpose |
|--|--|--|
| `DB` | D1 | Main relational DB (`roadtrip-db`) |
| `API_CACHE` | KV | Geocoding (7d TTL) + routing (24h TTL) cache |
| `ROADTRIP_PRINTS` | R2 | Print-ready images |
| `RATE_LIMITER_PUBLIC` | Rate limit | 60/min per IP (public map GET) |
| `RATE_LIMITER_PROXY` | Rate limit | 30/min per user (geocode + route) |
| `RATE_LIMITER_AUTH` | Rate limit | 10/min per IP (auth routes) |

Secrets set via `wrangler secret put`: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID/SECRET`, `FACEBOOK_CLIENT_ID/SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PRODIGI_API_KEY`, `ORS_API_KEY`, `ADMIN_SECRET`.

### Data model

Two stop types stored in the `stops` table:
- **`point`** — standalone map marker (name, lat/lng, icon, label)
- **`route`** — A→B segment (start lat/lng/name + `dest_*` fields + `travel_mode`)

`travel_mode` is stored on the destination stop (NULL on the first stop). Five modes: `drive`, `walk`, `bike`, `plane`, `boat`. Plane = great-circle arc (client-computed, no ORS call). Boat = straight line.

### CSRF protection

All non-GET state-changing API requests (except `/api/webhooks/*`) are validated against `Origin`/`Referer` headers matching `BETTER_AUTH_URL`. This is implemented as a middleware in `worker/src/index.ts`.

### UI components

Web Awesome Pro (`@web.awesome.me/webawesome-pro`) v3.x web components. Font Awesome Pro Jelly icons via kit `@awesome.me/kit-781a3c6be3`. Use `<wa-*>` components and `<wa-icon name="...">` throughout. `useDefineForClassFields: false` is required in tsconfig for Lit decorators.

### Passkeys / WebAuthn

Passkeys don't work on plain `localhost`. Use `wrangler dev` with a tunnel (`cloudflared tunnel`) or HTTPS during passkey development. `BETTER_AUTH_URL` must be the canonical HTTPS domain.
