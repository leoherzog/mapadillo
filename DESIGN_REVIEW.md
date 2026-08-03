# Mapadillo Design Review — Final Report

**Scope:** Full-stack design review of Mapadillo (Lit SPA + Cloudflare Worker, D1/KV/R2, Stripe + Prodigi print fulfillment). Eight dimension reviewers (architecture, data model, security, payments, frontend, geo/export, dependencies, product-UX) produced findings; every finding was adversarially verified by 2–3 independent verifiers, and a completeness critic added verified gaps. Fixed constraints (OSM data, Web Awesome UI, Cloudflare Workers + Better Auth) were respected throughout.

## 1. Executive summary

Mapadillo's core architecture is sound — the panel cleared several alarming-sounding claims (Better Auth account-linking takeover, deploy-config drift, route-model divergence) on close inspection — but the review confirmed real problems concentrated in three areas: **payment integrity** (client-controlled shipping cost is directly exploitable; Prodigi quote currency is never validated; there is no refund/terminal-failure path after payment capture), **silent data loss in the editor** (debounced auto-save discards edits on navigation, and a shared save counter can stamp "Saved" over a failed save), and **launch-blocking gaps the dimension reviewers missed entirely** (no email infrastructure behind an auth design that assumes one, and zero privacy/legal/deletion surface for a children's-branded product storing home addresses and taking payments). A recurring secondary theme is doc/code drift: PLAN.md repeatedly describes a system (lazy loading, 200 DPI/5400px export, 24h route TTL, webhook idempotency design, pricing) that no longer matches shipped code. Nothing rated critical after adversarial verification, but five high-severity items should be treated as pre-launch blockers.

| Severity | Confirmed findings | Additional gaps | Total |
|---|---|---|---|
| Critical | 0 | 0 | 0 |
| High | 3 | 2 | 5 |
| Medium | 14 | 3 | 17 |
| Low | 24 | 2 | 26 |
| **Total** | **41** | **7** | **48** |

Fourteen additional findings were refuted during verification and are listed in §4.

---

## 2. Confirmed findings

### High

#### Client-controlled shipping cost lets buyers zero out shipping at checkout
`POST /api/checkout` accepts `shipping_cost_cents` straight from the request body (`worker/src/routes/orders.ts:89`), uses it unmodified via `body.shipping_cost_cents ?? product.shippingPlaceholderCents` (`:125`) as the Stripe line-item amount (`:143-150`) and persists it (`:165`). The authoritative Prodigi quote (`getShippingQuote`) is only ever called from `/api/print-quote` (`:191`) and is never re-checked at checkout — `??` doesn't catch an explicit `0`, so any registered user can edit one JSON field in devtools and pay zero shipping while the merchant still pays Prodigi's real freight. The Stripe webhook does no amount reconciliation and auto-submits paid orders to Prodigi.
**Recommendation:** Ignore client-sent shipping at checkout; re-call `getShippingQuote(sku, size, country)` server-side (optionally KV-cached by sku+country) for both the Stripe line item and the DB row; reject non-integer/negative values defensively.
**Panel:** 3/3 upheld at high. Loss is bounded per order by real shipping cost, which is why it's high rather than critical.

#### Debounced auto-save discards edits on navigation instead of flushing
Auto-save is purely time-debounced (2500ms for map metadata, 1500ms for item text fields; `src/pages/trip-builder-page.ts:494-498,571-579`). `disconnectedCallback` (`:169-178`) only `clearTimeout`s every pending timer without flushing, and no `beforeunload`/`pagehide` handler exists anywhere in `src/`. Because navigation is client-side (Navigation API), `disconnectedCallback` fires on ordinary in-app navigation — type a stop name, click "Dashboard" within 1.5s, and the edit is silently gone while the UI showed "Saving…".
**Recommendation:** Flush pending saves in `disconnectedCallback` (and before route changes); add a `beforeunload`/`pagehide` handler using `fetch` keepalive/`sendBeacon` or an unsaved-changes warning.
**Panel:** 3/3 upheld; finder rated critical, panel converged on high (loss is bounded to the last debounce window of text edits; immediate-save paths — icons, coordinates, reorder — are unaffected). Downgraded from critical accordingly.

#### Print-order resolution is silently GPU-dependent with no minimum-DPI guard; PLAN's 200 DPI/5400px spec is stale
`DEFAULT_DPI` is 300 (`src/map/map-export.ts:18`) but the canvas cap is derived from the buyer's GPU: `MAX_CANVAS_DIM = MAX_TEXTURE_SIZE * 0.8`, falling back to 4096 (`:22-35`), with a proportional downscale and no DPI floor (`:104-108,399-404`). The same path feeds `renderToBlob()` used for the paid print upload; the server validates only MIME and a 100MB cap (`worker/src/routes/orders.ts:44-48`), and Prodigi is told `sizing:'fillPrintArea'` (`worker/src/lib/prodigi.ts:128`), which upscales blindly. Independently reproduced math: a 24×36in poster clamps to ~91–182 effective DPI on 4096/8192-texture GPUs; the priciest 40×60in SKU ($49.99/$59.99, `shared/products.ts`) reaches at best ~218 DPI even on a 16384-texture desktop GPU. Two customers paying the same price can receive drastically different physical quality with no warning. PLAN.md:62,269-284,502 still document a fixed 200 DPI/5400px pipeline that no longer exists.
**Recommendation:** Compute effective DPI after the cap and block or warn ordering below a threshold; validate minimum pixel dimensions server-side at upload; update PLAN.md; surface the device-dependent DPI in the order UI.
**Panel:** 3/3 upheld (2 suggested medium — posters are viewed at distance and common desktop GPUs fare acceptably; the evidence verifier held high given it's a paid physical product with no disclosure). Kept at high: this is silent quality variance on the priciest SKU of a paid product.

### Medium

#### No refund or terminal-failure path when Prodigi rejects an order after payment capture
When Prodigi order placement fails post-payment, the catch block downgrades status to `pending_render` — the same state as "no image yet" (`worker/src/routes/webhooks.ts:129-135`). No `stripe.refunds.create` exists anywhere; the schema's `failed` status (`shared/types.ts:212`) is never assigned; PLAN.md's flow (513–517) has no failure branch.
**Recommendation:** Distinguish terminal rejection from awaiting-render; set `failed` on non-retryable errors, trigger a Stripe refund (or at minimum a dedicated alert), and add bounded retry for transient failures.
**Panel:** 2/3 upheld at medium — contested: the pragmatic verifier refuted the "no remedy" framing because an admin retry endpoint (`orders.ts:302-369`), admin-page pending-render filter, and Discord alert give the solo operator a manual path, plus Stripe-dashboard refunds. Downgraded from high to medium; the structural gap (terminal failures indistinguishable, unreachable `failed` state) is real.

#### Prodigi quote currency is discarded; fixed-USD pricing is unverified
Prodigi returns shipping as `{amount, currency}` but the code reads only `amount` and treats it as USD cents (`worker/src/lib/prodigi.ts:82-93`); the quote request never sends `currencyCode`, and Prodigi's docs say the merchant-settings currency applies. `orders.ts:137` charges `currency:'usd'` unconditionally; `shared/products.ts:25-38` hard-codes USD. A non-USD Prodigi account would silently mis-charge every order; the item wholesale cost is also never read, so margin erosion from a Prodigi price change is invisible.
**Recommendation:** Assert quote currency is USD and reject/alert on mismatch (one-line guard); optionally read `costSummary.items` and alert below a margin floor.
**Panel:** 3/3 upheld; all three suggested medium (latent, contingent on a one-time account misconfiguration by the sole merchant). Downgraded from high accordingly — but the guard is trivial, so do it.

#### Save indicator can show "Saved" while a concurrent field save actually failed
`_pendingSaves` is a single shared counter across all in-flight item saves; the `errored` flag is local to each call (`src/pages/trip-builder-page.ts:612-625`, gate `if (--this._pendingSaves === 0 && !errored)`). A later successful save drives the counter to 0 and stamps "saved" over an earlier failure; there is no toast, no console.error, no retry, and the optimistic local update keeps the unsaved value visible — silent loss of a field edit, plausible on flaky mobile connections during trips.
**Recommendation:** Track failed itemIds explicitly; only clear the error state once previously-failed items are resaved; surface per-item failure and add retry.
**Panel:** 3/3 upheld; all suggested medium (blast radius is one field edit, and the indicator auto-clears after 3s anyway). Downgraded from high.

#### Default-open API auth posture: guards are string-path middleware decoupled from routes; admin routes have no middleware
Auth is enforced by enumerated path-string `app.use()` calls in `worker/src/index.ts:145-150` that must mirror routes defined in the separately-mounted orders sub-app; a new `orders.ts` route prefix ships unauthenticated by default. Admin handlers each manually call `requireAdmin` (`orders.ts:254-256,285-287,302-304`); the only global `/api/*` middleware is a CSRF origin check. All seven current routes were cross-checked and are correctly guarded — this is a latent posture risk, not a live hole.
**Recommendation:** Co-locate guards with sub-apps (register `requireAuth`/`requireAdmin` inside the sub-app). Note: a trailing catch-all `/api/*` middleware in Hono would not guard already-matched routes, so co-location is the correct fix, not a final default-deny handler.
**Panel:** 2/3 upheld at medium — contested: the pragmatic verifier refuted it as a hypothetical future mistake in a legible, correctly-guarded solo-dev codebase whose default-deny fix carries its own regression risk. Downgraded from high to medium.

#### Everything loads eagerly — the "lazy loading via dynamic imports" router feature is unused
`src/components/app-shell.ts:16-25` statically imports all 10 pages, including admin-page and the map pages that pull in maplibre-gl. Verified via build: `dist/index.html` modulepreloads a 1.88MB (520KB gzip) maplibre chunk unconditionally, so every landing-page visitor downloads roughly 800KB+ gzip of JS before interactivity. PLAN.md:201,544 promise lazy loading via `enter()`-hook dynamic imports; the hook exists but is only used for auth guards.
**Recommendation:** Dynamically import map/admin/order/export pages in the router's `enter()` hooks (the mechanism PLAN anticipated), or drop the claim from PLAN.md.
**Panel:** 2/2 upheld at medium.

#### Admin API protected only by a single static shared secret, no rate limiting, XSS-exfiltratable storage
The entire admin surface authenticates on one static `ADMIN_SECRET` bearer (`worker/src/routes/orders.ts:239-252`, constant-time compare); rate-limit middleware exists in the codebase and is applied to auth/geocode/route/shares — but not to `/api/admin/*`. The admin SPA ships in the public bundle and persists the secret in `sessionStorage` (`src/pages/admin-page.ts:69-84`), exfiltratable by any XSS (see the tracking_url vector below). No identity, rotation, or audit trail.
**Recommendation:** Move admin auth onto the Better Auth session with a role/allowlist claim; if a bearer must remain, add a dedicated rate limiter and stop persisting it in sessionStorage.
**Panel:** 2/2 upheld (one at medium, one at low given the high-entropy secret and small scope).

#### Post-payment finalization runs only in `waitUntil` with no scheduled reconciliation
The Stripe webhook flips the order to `paid` synchronously, then does Prodigi submission and Discord notification in `ctx.waitUntil` after the 200 is already returned (`worker/src/routes/webhooks.ts:73,84-88`) — no Stripe redelivery, no cron (`wrangler.toml` has no triggers, no scheduled export anywhere), no `checkout.session.expired` handling, and `pending_payment` rows (`orders.ts:159`) are never expired.
**Recommendation:** Add a scheduled Worker that re-attempts submission for aged `paid` orders and expires stale `pending_payment` rows.
**Panel:** 2/3 upheld (counting the closely-related Discord finding's verifiers) — contested: the pragmatic verifier held that the admin resubmit endpoint plus Discord alerting is adequate human-triggered reconciliation at this volume. Kept at medium because the next finding shows the Discord alert itself is a single unreliable link.

#### `pending_render` fulfillment hinges on one human alerted only by best-effort Discord
`notifyDiscord` silently returns `false` on any failure with no retry or escalation (`worker/src/lib/discord.ts:4-16`); `webhooks.ts:145-154` only records success. The confirmation page has meanwhile already promised the customer a shipping notification "within 1–2 business days" (`src/pages/order-confirmation-page.ts:77`). If Discord fails, a paid order sits stuck with no forcing function to notice it — money captured, product not shipped.
**Recommendation:** Retry the notification, add a fallback channel, and have the reconciliation cron (previous item) re-alert on aged `pending_render` orders.
**Panel:** 2/2 upheld at medium — payment/fulfillment-integrity, cheap to fix on this stack.

#### Drag-and-drop reordering has no keyboard alternative
Reordering in `src/components/item-list.ts:151-269` is implemented exclusively with PointerEvents; the drag handle is a bare `<wa-icon>` with no button semantics, tabindex, or label (`point-card.ts:78`, `route-card.ts:143`); repo-wide grep confirms no alternate reorder path (no up/down buttons, no keydown handling, no aria-live). Keyboard-only and screen-reader users cannot reorder stops — a WCAG 2.1.1 Level A failure on a core function (stop order determines the route and the printed map).
**Recommendation:** Make the handle a real labeled button; add arrow-key move-up/move-down; announce position changes via aria-live.
**Panel:** 3/3 upheld (2 medium, 1 high). Set at medium — the cheap fix (move buttons) covers most of the gap.

#### Plane arc and boat line render the wrong way across the antimeridian
`greatCircleArc` interpolates raw longitudes with no ±180 wrap (`src/services/routing.ts:143-186`); `straightLine` (boat) has the same defect (`:191-199`). A Tokyo→San Francisco plane segment draws the long way around via Europe, and `_computeBounds` (`src/map/map-controller.ts:525-548`) then fits a ~261° globe-spanning viewport. Pacific-crossing family trips (Japan↔US, Hawaii↔mainland) are a plausible real use case for first-class plane/boat modes.
**Recommendation:** Normalize the longitude delta into [-180, 180] and shift one endpoint by ±360 before interpolating; adjust bounds for the wrap. A few lines.
**Panel:** 2/2 upheld at medium.

#### OpenFreeMap is a single point of failure for both preview and the paid print pipeline
`src/config/map.ts:2` hardcodes exactly one style URL with no fallback or tile-error handling; `map-export.ts` renders the paid print image from the same source; PLAN.md:21 frames it only as "free/unlimited" with no discontinuation risk discussed, while OpenFreeMap offers no SLA.
**Recommendation:** At minimum document the risk and keep a tested alternate style URL ready to swap; longer-term add fallback switching on tile-load failure.
**Panel:** 2/3 upheld — contested: the pragmatic verifier refuted at high because the failure mode is fail-safe (no order can complete against a broken map; nobody gets charged for a blank print) and a config swap takes minutes. Downgraded from high to medium.

#### No try-before-signup path
The landing page's only CTA routes unauthenticated visitors to `/sign-in` (`src/pages/landing-page.ts:96-101`); `/dashboard` and `/map/new` are hard-guarded (`app-shell.ts:44-51`); there is no guest/localStorage draft mode. Every prospective user must create an account before adding a single stop.
**Recommendation:** Cheapest first: make the CTA land on a public example map (read-only viewing is already unauthenticated). Full localStorage draft-with-conversion is a bigger, optional build.
**Panel:** 2/3 upheld — contested: the pragmatic verifier refuted at high because sign-in is one-click OAuth/passkey and the draft-conversion feature is a nontrivial growth optimization for a pre-launch app. Downgraded from high to medium.

#### Invite links are single-use but nothing tells the user
The share dialog generates a single-claim link with the token nulled on first claim (`worker/src/routes/sharing.ts`, explicit 403 for the second claimant), but `share-dialog.ts` has zero copy indicating single-use. Pasting one link into a family group chat — the app's natural sharing pattern — fails for everyone after the first clicker, and `claim-page.ts` offers no recovery guidance.
**Recommendation:** Add "this link works for one person" copy plus a one-click "copy a fresh link" affordance; or support role-scoped multi-claim links.
**Panel:** 3/3 upheld; all suggested medium (recovery is one click for the owner; graceful failure). Downgraded from high.

#### Core trip-builder logic has zero test coverage
`trip-builder-page.ts` (835 lines: optimistic updates, debounce timers, `_pendingSaves` state machine, icon propagation) and the drag-and-drop components have no test files; existing tests cover only pure-logic modules (router/auth/nav/units/geo/services) in a node environment. Given three confirmed save-path bugs above, this is where tests would pay.
**Recommendation:** Extract the debounce/flush and save-status logic into testable pure modules and test those contracts — don't stand up full component/DOM test infra yet.
**Panel:** 2/3 upheld at medium — contested: the pragmatic verifier refuted because component-level testing requires DOM test infrastructure this repo doesn't have, a real ongoing cost. The extraction-first recommendation splits the difference.

### Low

#### Router ignores `NavigateEvent.signal`, resolves before Lit renders, and never wires View Transitions
The intercept handler never reads `event.signal`, resolves after `requestUpdate()` without awaiting `updateComplete`, and has no generation counter (`src/router.ts:130-171`), so a slow guarded navigation aborted by a rapid second one can still win; PLAN.md:196-199's View Transitions claim is unimplemented. The hazardous window is effectively the first guarded navigation after load (auth init is cached afterward). The codebase already has the right pattern in `map-page-base.ts`'s `_loadGeneration`.
**Recommendation:** Thread `event.signal`, await `updateComplete`, add a generation counter; wire or delete the View Transitions claim. **Panel:** 1/1 upheld, at low.

#### `/export/:id` is unguarded despite docs claiming it requires auth
`src/components/app-shell.ts:57-64` has no `enter: requireAuth` on `/export/:id`, while PLAN.md:61 and AGENTS.md:66 say it's guarded. The Worker API is the real authorization boundary, so this is doc drift, not a bypass. **Recommendation:** Update the docs (adding `requireAuth` would break public/shared-map viewing). **Panel:** 1/2 — contested: pragmatic verifier refuted as a doc nit whose "fix the code" recommendation would break a legitimate flow.

#### Vite dev mode collides with the CSRF origin check; `dev:full` has no watch
`dev:full` serves a one-shot build (package.json:8); mutating calls from the Vite proxy (:5173) 403 against the CSRF check keyed on `BETTER_AUTH_URL` (:8787) (`worker/src/index.ts:83-108`) — flipping the var fixes one mode and breaks the other. **Recommendation:** Accept a dev-origin allowlist in non-production CSRF, or adopt @cloudflare/vite-plugin. **Panel:** 1/2 — contested: pragmatic verifier held the two modes are documented as intentional and each works for its purpose.

#### Visibility-based session revalidation dies after sign-out/sign-in in the same tab
`signOut()` removes the visibility listener (`src/auth/auth-state.ts:100-110`) and `refreshAuth()` never reinstalls it; `refreshAuth` also has a last-write-wins race. Blast radius is small (401s are still handled reactively on the next API call). **Recommendation:** One line — reinstall the listener in `refreshAuth`; add a request-id guard. **Panel:** 1/2 — contested: technical verifier argued `requireAuth`-on-navigation reinstalls it in most real sign-in flows.

#### No security headers on any HTML/asset response
`run_worker_first=["/api/*"]` (`worker/wrangler.toml:18-22`) means documents/assets bypass Hono entirely, and no `_headers` file exists — zero CSP/HSTS/XFO/Referrer-Policy on pages handling auth cookies and Stripe redirects. **Recommendation:** Drop a `public/_headers` file (minutes of work). **Panel:** 1/1 upheld.

#### Prodigi webhook: attacker-supplied `tracking_url` is rendered into an href unsanitized
`POST /api/webhooks/prodigi` gates on a constant-time shared secret then updates any order by payload-supplied `prodigi_order_id` (`worker/src/routes/webhooks.ts:176-239`); `tracking_url` is persisted raw and bound into `href` at `dashboard-page.ts:188` and `order-confirmation-page.ts:83` — Lit does not block `javascript:` URLs, so this is a stored-XSS vector (gated behind the webhook secret, hence low). PLAN.md:473 claims "signature-verified," which the Prodigi handler is not. **Recommendation:** Validate `tracking_url` as http(s) before persisting; the state-machine/rate-limit extras are optional. **Panel:** 2/2 upheld.

#### Print images: public capability-URL serving with immutable 1-year cache and no lifecycle purge
`GET /api/images/*` serves any R2 object unauthenticated with `immutable` 1-year caching (`worker/src/routes/orders.ts:64-76`). The unguessable `{map_guid}/{uuid}.png` key is a deliberate documented capability-URL design, and R2 lifecycle isn't configurable in wrangler.toml (so its absence there proved nothing) — but no lifecycle rule is configured anywhere, so personalized images are retained indefinitely against PLAN's optional 30-day purge. **Recommendation:** Configure an R2 lifecycle rule (dashboard or `wrangler r2 bucket lifecycle`) or delete on order completion. **Panel:** 1/2 — contested: technical verifier refuted the "world-readable/leak-exposed" framing and the wrangler.toml evidence as a non-sequitur. Downgraded from medium.

#### `x-forwarded-for` fallback in rate-limit IP derivation
`getClientIp` (`worker/src/index.ts:36-45`) falls back to client-controlled `x-forwarded-for` — but on Cloudflare Workers `cf-connecting-ip` is always set at the edge, so the branch is unreachable in production. **Recommendation:** Delete the fallback anyway (one line). **Panel:** 1/2 — contested: pragmatic verifier refuted as unreachable in this deployment model.

#### Stale docs and committed artifacts (batch)
Verified doc/code drift, all upheld, all low, all trivial:
- PLAN.md's Project Structure lists nonexistent files (`save-indicator.ts`, `export-options.ts`, `print-order-form.ts`, `kid-friendly-style.json`, `sprites/`; PLAN.md:94-122); ~67 generated `coverage/` files are tracked in git (`.gitignore` only excludes `worker/coverage/`). *2/2 upheld.*
- `shared/types.ts:39-44` documents DB triggers that don't exist; the position-0 `travel_mode` UPDATEs at `maps.ts:344,679` are provably dead code (points are forced null on insert and PATCH), and the comment inverts the actual behavior. *2/2 upheld.*
- Route cache: code uses 7-day KV TTL (`route.ts:106-108`) and effectively permanent D1 geometry (invalidated on coordinate/mode change, never by time), vs. AGENTS.md:92/PLAN.md:410's "24 hours." *1/2 — contested: pragmatic verifier held the residual staleness (road network changes under identical stops) is cosmetic and near-never.*
- PLAN.md's own early pricing table ($19.99/$29.99) contradicts its Milestone 9 section and `shared/products.ts` ($29.99–$59.99). *1/2 — contested: internal planning doc, superseded-section pattern is normal.*
- Webhook idempotency is an atomic status-claim UPDATE, sound but not what PLAN.md:511-512 describes; Stripe `event.id` is never persisted. *2/2 upheld — doc fix plus optional event-id dedup.*

#### Data-model hygiene (batch)
- Unclaimed invites are unbounded: `UNIQUE(map_id, user_id)` doesn't constrain NULL `user_id`, and expired unclaimed rows are never reaped (`sharing.ts:75-112,273-282`). *1/2 — contested: only the map's own owner can mint them, 60/min rate-limited, self-inflicted bloat at worst.*
- Concurrent stop-adds can collide on `MAX(position)+1` with no UNIQUE constraint (`maps.ts:443-476`); migration 0014's header says "Migration 0013" and DROP/recreates the Better-Auth-owned `user` table (standard SQLite CHECK technique; column list verified to match). *1/2 — contested: sub-millisecond race with a cosmetic worst case at family scale.*

#### Editor polish (batch, all upheld)
- Deleting an item doesn't cancel its pending debounced timer (`trip-builder-page.ts:627-640`), so a stale PUT 404s and flips the indicator to error after a successful delete. One-line fix. *2/2 upheld; panel leaned low (cosmetic flicker, server correctly 404s).*
- Rebinding to a new `mapId` (e.g. via Duplicate) doesn't cancel prior-map timers (`:180-184`); shared `_saveStatus` shows phantom saving/saved on the new page. Extract `_cancelPendingSaves()`, call from both paths. *2/2 upheld at low.*
- Five bare `catch {}` blocks across the save path discard all error detail (`:509-511,618-620,637-639,657-659,756-757`), so session expiry mid-edit is indistinguishable from a network blip. `console.error` + special-case 401 to re-auth (pattern already exists in `map-page-base.ts:72`). *2/2 upheld.*
- Dark mode re-themes chrome but never the map (`dark-mode-change` has no listener in map code; `config/map.ts:14-22` caches one style). *1/2 — contested: the fixed poster aesthetic is plausibly intentional; document it or add a dim overlay.*

#### Product copy (batch, all upheld at low)
- The "1–2 business days" confirmation string renders unconditionally, even above a "shipped" tracking callout, and covers ordinary Prodigi API failures (`order-confirmation-page.ts:77-90`). Scope the copy to pre-shipment statuses. *2/2 upheld.*
- All prices are hardcoded USD with `currency="USD"` display and unconditional `currency:'usd'` charges (`orders.ts:132-149`, `order-page.ts:289`) despite PLAN's "no geographic bias" — Stripe Checkout does show the currency before payment, so this is pre-checkout ambiguity only. Label prices "(USD)" near the country selector. *2/2 upheld.*
- Plane/boat modes silently draw geometric approximations with no tooltip near the mode picker (`shared/travel-modes.ts` — only drive/bike/walk carry `orsProfile`). *1/2 — contested: the drawn line is arguably its own disclosure.*
- Single shared ORS key: 2 users × 30/min per-user limit can exceed the 40/min global ORS cap; 429s degrade gracefully and KV caching absorbs most traffic. *1/2 — contested as self-resolving at this scale.* Defer the global token bucket.
- Fresh installs hard-depend on two token-gated paid registries with no CI to catch a lapse (`.npmrc:1-5`, no `.github/`). *1/2 — contested as a self-inflicted, self-discoverable solo-dev inconvenience.* A note in AGENTS.md ("renew before reinstalling") is enough for now.

---

## 3. Additional gaps (completeness critic; single verification each)

> These were each verified by one independent verifier rather than a full panel.

### High

#### No email capability makes three acknowledged auth failure modes permanent
The auth design assumes an email service that doesn't exist, and the code's own comments admit the consequences: (1) a passkey-only user who loses their authenticator is permanently locked out — the password is a client-generated random UUID and "no password-reset flow is exposed" (`worker/src/auth.ts:60-66`); (2) if `addPasskey()` fails mid-registration (user cancels the biometric prompt — common), the account exists with an unknown password and no credentials, permanently burning that email, with only a TODO for a cleanup job (`src/pages/sign-in-page.ts:296-330`); (3) `requireEmailVerification` is false with a no-op `sendVerificationEmail`, and the code explicitly names the "email-based account-linking attack path" this leaves open (`auth.ts:69-79`). Verifier confirmed every quoted comment verbatim and the absence of any email provider, reset endpoint, or GC job.
**Recommendation:** Treat transactional email as a launch blocker: wire a provider (SES/Resend/MailChannels), enable verification, add a recovery path; meanwhile encourage a second credential before checkout and ship the orphan-account GC (delete accounts with zero passkeys, zero OAuth links, age > 24h). **Verifier: upheld at high.**

#### Zero privacy/legal surface for a children's-branded product handling home addresses
No privacy policy or ToS anywhere in the SPA; no account-deletion or data-export capability in any route; PLAN.md's 1766 lines never mention privacy, GDPR, COPPA, or retention. Deletion is structurally blocked once a user orders: `orders` references user and map with `ON DELETE RESTRICT` (`0001_initial.sql:118-119`), and the map-delete handler says "Cancel or archive orders first" (`maps.ts:290`) — a feature that exists nowhere. Shipping addresses in D1 are retained forever.
**Recommendation:** Before real payments: privacy policy + ToS linked from sign-up and checkout; account deletion that tombstones the orders FK instead of RESTRICT-blocking; a retention window for `shipping_address`; build order cancel/archive or fix the dead error message; document the GDPR/COPPA position. **Verifier: upheld, suggested medium** (COPPA angle is weak — the account holder is the parent; much of this is standard launch boilerplate). Kept high here because it gates accepting real payments and PII, which is imminent.

### Medium

#### Dashboard spawns one live WebGL MapLibre instance per trip card
`map-card.ts:81-88` creates a full `maplibregl.Map` per card; the dashboard renders one per owned and shared map (`dashboard-page.ts:147,169`). Browsers cap concurrent WebGL contexts (~16 in Chrome, fewer on mobile Safari) and force-lose the oldest — so the best customers (many trips) get silently blank cards — and every dashboard load fans out N glyph/tile loads to OpenFreeMap for thumbnail purposes. No thumbnail pipeline exists. (Style JSON is session-cached, so that part of the fan-out claim was overstated.)
**Recommendation:** Static thumbnails cached by `updated_at` (the export pipeline already knows how to snapshot), or IntersectionObserver-gated instantiation of 1–2 visible maps with destruction off-screen. **Verifier: upheld at medium.**

#### Print-image upload has no rate limit, no quota, and no content validation
`POST /api/images/:mapId` gets only `requireAuth` (`index.ts:147`) — unlike geocode/route, no `RATE_LIMITER_PROXY` — and accepts up to 100MB per request, unlimited times, under unique UUID keys; the only validation is client-asserted `file.type`, and bytes are stamped `image/png` regardless (`orders.ts:44-57`). Combined with no lifecycle purge, one hostile or retry-looping account can grow the R2 bill without bound, and the object Prodigi prints from is never verified to be a decodable PNG.
**Recommendation:** Apply a strict limiter (e.g. 5/min); delete the previous upload per map or cap per map/user; sniff PNG magic bytes; lower the size cap to realistic poster-export size. **Verifier: upheld at medium.**

#### No backup or disaster-recovery story for financial records and paid print assets
Zero mentions of backup/restore/D1 Time Travel in PLAN.md or AGENTS.md; D1 Time Travel gives only 30-day PITR and doesn't cover account compromise or accidental DB deletion; R2 has no versioning/replication yet holds the only copy of images backing paid orders (reprints, disputes, chargebacks). The schema declares orders immutable financial records ("must not be deleted", `0001_initial.sql:115`) but nothing preserves them beyond one D1 instance.
**Recommendation:** Scheduled Worker exporting at least the orders table to a separate R2 bucket; versioning or cross-bucket copy for print images tied to completed orders; document RPO/RTO. **Verifier: upheld at medium.**

### Low

#### The committed wrangler.toml cannot deploy; single environment, no pipeline
`database_id = 'placeholder-replace-after-wrangler-d1-create'` — the repo does not describe the running system; no `.github/`, no `[env.*]` split, every deploy/migration is a manual laptop operation. (The related "silently diverged production" finding was refuted — see §4 — the project is pre-launch and the placeholder is an intentional TODO; the reproducibility point stands.)
**Recommendation:** Commit the real `database_id` once created (not a secret), add `[env.staging]`, and a minimal deploy workflow. **Verifier: upheld, suggested low.**

#### OSM attribution is silently dropped on dashboard map cards
`map-card.ts:81-88` sets `attributionControl: false` and never re-adds it, while `map-view.ts:48-51` and the export pipeline (`map-export.ts:347-365`) carefully honor the OSM attribution obligation. Each card is a full unattributed OSM map view.
**Recommendation:** Add the compact AttributionControl to cards, or a single credit line under the grid (and bake it into thumbnails if cards go static). **Verifier: upheld at low.**

---

## 4. Challenged and cleared

Findings that were raised and refuted under adversarial verification — checked and survived scrutiny:

| Refuted claim | Why it was cleared |
|---|---|
| Unverified email+password enables OAuth account-linking **takeover** (high) | Traced installed better-auth 1.6.23 source: `requireLocalEmailVerified` defaults to true, so OAuth refuses to link onto an unverified credential account — residual risk is email squatting/denial, not takeover (that residue is captured in the email gap, §3). |
| Placeholder D1 id means production deployed from silently diverged out-of-band config (high) | Checked the Cloudflare account: no `roadtrip-db` exists and the worker was deployed once and never updated — the app is pre-launch; the placeholder is a documented, self-announcing setup step (reproducibility residue kept as a low gap). |
| better-auth version skew across two lockfiles breaks sign-in (high) | Both lockfiles resolve to identical 1.6.23, dependency updates touch both in lockstep, and client/server communicate over stable HTTP endpoints — the runtime-breakage claim was unsubstantiated. |
| Route model diverges from PLAN's adjacency model (high) | PLAN.md's own Milestone 6 section documents the unified-items pivot as a deliberate deviation, names migration 0004, and documents junction handling — only early-section prose is stale. |
| Editing a shared junction's coordinates "silently breaks the route chain" (high) | There is no route chain — routes are independent segments; colocation is an emergent visual coincidence, the gap is immediately visible on the live map, and auto-moving another route's endpoint would itself be surprising. |
| Photon geocoding forbids this proxied-commercial pattern; PLAN misstates the rate limit (high) | Fetched Photon's actual docs: no numeric limit exists (the "1 req/sec" is Nominatim's, which PLAN correctly attributes); the app already has auth, 30/min per-user limiting, and a 7-day shared KV cache. |
| Discord failure flag (`discord_notified`) is read by nothing → stuck orders invisible (high) | Order state lives in the `status` column; the admin dashboard has a working pending-render filter and manual resubmit — Discord is a convenience ping, not the system of record (the alerting fragility itself survives as a confirmed medium). |
| `deleteUser` would orphan data via advisory FKs (medium) | Not a live defect: user deletion is not exposed, Better Auth disables it by default, and AGENTS.md:118-121 already documents this exact constraint as policy. |
| Export/print pipeline built on "undocumented internals" of @watergis/maplibre-gl-export (medium) | `MapGeneratorBase.getRenderedMap` is a public exported `protected abstract` extension point — the designed way to subclass — and the committed lockfile pins 4.1.2, so nothing lands "silently." |
| Components read auth singleton in `render()` without subscribing → stale auth UI (medium) | Half the evidence was wrong (map-preview-page doesn't do it in render); the one real instance is a cosmetic button label on read-only shared views, with server-side auth still enforced. |
| `export_settings` blob conflates shared print prefs with per-viewer viewport (low) | AGENTS.md documents per-map viewport as deliberate — it is the shared print framing feeding the order flow; the clobbering complaint applies equally to paper size and wouldn't be fixed by splitting. |
| Checklist icons' special print behavior is invisible in the picker (medium) | Traced the render path: no special checkbox print behavior is actually implemented — the picker accurately reflects what renders; PLAN's checkbox behavior is unshipped aspiration. |
| Single ORS key, fixed daily quota, no usage monitoring (low) | route.ts does give ORS 429s distinct graceful handling; the "cache won't help" premise contradicts the deliberate per-segment 7-day cache design; monitoring can wait for traffic. |

---

## 5. Top 10 recommended actions

Ordered for a solo developer: quick wins first within severity. Items 1–5 should be considered launch blockers for taking real money.

1. **Fix checkout shipping (hours).** In `POST /api/checkout`, ignore client-sent `shipping_cost_cents`; re-call `getShippingQuote` server-side for the Stripe line item and DB row; reject non-integer/negative input. While in `prodigi.ts`, add the one-line assert that `costSummary.shipping.currency === 'USD'` (alert/reject on mismatch). Closes both confirmed payment findings at once. (`worker/src/routes/orders.ts:89,125,143-150`; `worker/src/lib/prodigi.ts:82-93`)
2. **Stop losing edits (hours).** Extract `_cancelPendingSaves()`/`_flushPendingSaves()` in `trip-builder-page.ts`; flush in `disconnectedCallback` and on `mapId` change; clear per-item timers in `_onItemDelete`; add a `pagehide` keepalive flush. Replace the shared `_pendingSaves` gate with a failed-itemId set so "Saved" can't mask a failure, and `console.error` + 401-redirect in the five bare catch blocks. Fixes five confirmed findings in one file.
3. **Guard print resolution (day).** Compute effective DPI after the GPU cap in `map-export.ts` and warn/block ordering below a floor; validate minimum pixel dimensions server-side in the upload handler; update PLAN.md's stale 200 DPI/5400px section.
4. **Wire transactional email (days).** Add a provider, enable `requireEmailVerification`, expose a recovery path (magic link or verified-email passkey re-enrollment), and ship the orphan-account GC job. Until then, prompt for a second credential before checkout. (`worker/src/auth.ts:60-79`; `src/pages/sign-in-page.ts:296-330`)
5. **Ship the legal/PII minimum (days).** Privacy policy + ToS pages linked from sign-up and checkout; an account-deletion design that tombstones the orders FK; a retention window for `shipping_address`; an R2 lifecycle rule for print images (also resolves the retention finding); fix or implement the dead "Cancel or archive orders first" path.
6. **Make fulfillment self-healing (day).** Add a scheduled Worker (cron) that re-alerts/re-submits aged `paid`/`pending_render` orders and expires stale `pending_payment` rows; retry `notifyDiscord` with a fallback channel; add a terminal `failed` status on non-retryable Prodigi rejection with an explicit refund step (manual via Stripe dashboard is fine if alerted). Closes three confirmed payment-ops findings.
7. **Harden the cheap security seams (half-day).** Validate `tracking_url` as http(s) before persisting (stored-XSS vector); add a `public/_headers` file with CSP/HSTS/XFO; rate-limit and magic-byte-sniff `POST /api/images/:mapId` and cut its 100MB cap; move admin auth onto a session role (or at least rate-limit `/api/admin/*` and stop persisting the secret in sessionStorage).
8. **Fix the two visible map-rendering bugs (half-day).** Antimeridian wrap in `greatCircleArc`/`straightLine` (normalize dLon into [-180,180], shift an endpoint ±360) plus bounds adjustment; replace per-card live MapLibre instances with cached static thumbnails or IntersectionObserver-gated instances — and add OSM attribution to whatever the cards become.
9. **Lazy-load the heavy pages (half-day).** Dynamic-import map/admin/order/export pages in the router `enter()` hooks so the landing page stops shipping the 1.88MB maplibre chunk; co-locate `requireAuth`/`requireAdmin` inside the orders sub-app while you're in the router/wiring layer.
10. **One doc-and-hygiene sweep (half-day).** `git rm -r coverage/` + gitignore; fix PLAN.md's stale sections (lazy loading, 200 DPI, 24h TTL, early pricing table, project structure, webhook idempotency description, "/export/:id guarded"); delete the dead position-0 UPDATEs and the phantom DB-triggers comment; add single-use copy + "copy a fresh link" to the share dialog; make the drag handle a real labeled button with arrow-key move-up/move-down.