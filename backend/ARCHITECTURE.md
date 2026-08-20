# Project Wall — payment architecture

Backend: **Supabase** (Postgres + Edge Functions), piggybacked on the
existing **OneSixtyEight** project rather than a dedicated one — all tables
are `wall_`-prefixed (`wall_sessions`, `wall_projects`, `wall_ledger`,
`wall_subscriptions`) so nothing collides with that project's own tables,
and the `spend_spray()` function is `wall_spend_spray()` for the same
reason. Payments: **Lemon Squeezy** (Merchant of Record — handles one-time
packs and the monthly subscription through one integration, real overlay
checkout, tax collected/remitted for you). No sign-in for the MVP: every
visitor is an anonymous **session** identified by an opaque token in
`localStorage`.

## 1. Flow overview

```
Browser (no login)
  1. On first visit, generate a session token (uuid), store in localStorage.
  2. User clicks BUY or SUBSCRIBE.
  3. Frontend builds a Lemon Squeezy Buy Link directly — no server call
     needed to create the checkout — with the session token attached as
     a query param: .../checkout/buy/{variant_id}?checkout[custom][session_token]=...
     (this only works on standard Buy Links, not API-created checkouts,
     which is exactly why there's no create-checkout function here.)
  4. Frontend opens it with the Lemon Squeezy overlay JS SDK
     (LemonSqueezy.Url.Open) — no full page redirect.
  5. Buyer pays on the Lemon Squeezy-hosted overlay.

Lemon Squeezy → webhook → Edge Function `ls-webhook` (deployed, live)
  6. Verify X-Signature (HMAC-SHA256 of the raw body).
  7. Look up session_token from custom_data.
  8. Insert a `wall_ledger` row (idempotent on external_id) granting sprays.
     order_created            -> one-time pack grant
     subscription_created     -> first monthly grant + create `wall_subscriptions` row
     subscription_payment_success -> renewal grant
     subscription_cancelled / subscription_expired -> mark subscription inactive

Browser, live balance
  9. Frontend subscribes to Supabase Realtime on `wall_ledger` (or polls
     `wall_session_balances`) filtered by session_token, so the SPRAYS
     counter updates the moment the webhook lands — no page refresh needed.
     A second Realtime subscription on `wall_projects` (all rows, no
     filter) pushes glue/position changes to every open tab, not just the
     sprayer's — the wall is shared, not personal.

Spraying (spending sprays)
  10. Frontend calls Edge Function `spend-spray`
      { session_token, project_id }.
  11. spend-spray calls `wall_spend_spray()`, a single atomic Postgres
      function that checks balance and, only if sufficient, inserts a
      `spend` ledger row and bumps the project's glue — avoiding a race
      where two rapid clicks both read a balance of 1 and both succeed.
```

Server is authoritative for money (balance) and for project glue/position —
the frontend never trusts its own local state for either; it renders
whatever Postgres says and lets Realtime push updates in.

## 2. File structure

```
/frontend
  index.html                  the pixel-art wall UI (already built)
  /js
    session.js                 anonymous session token, created once, persisted
    checkout.js                 builds the LS Buy Link, opens the LS overlay
    balance.js                  Realtime subscriptions + spend-spray calls

/supabase
  /migrations
    0001_init.sql               wall_* schema, RLS, wall_spend_spray() function
  /functions
    ls-webhook/index.ts         verifies + applies LS webhook events (deployed)
    spend-spray/index.ts        thin wrapper around wall_spend_spray()
```

No `create-checkout` function — see the Buy Link note in the flow above.

## 3. Database schema

All table names below carry the `wall_` prefix in the actual deployed
schema (this project is piggybacked on the OneSixtyEight Supabase project).

- **wall_sessions** — one row per anonymous visitor. The token itself lives
  only in the browser; the server just needs a stable id to hang a balance
  off.
- **wall_projects** — server-authoritative glue/position, replacing the
  client-only simulation in the current mockup.
- **wall_ledger** — event-sourced grants and spends. Balance is *derived*
  (`sum(grant) - sum(spend)`), never stored as a mutable counter, so it can
  always be reconstructed/audited. `external_id` is the Lemon Squeezy
  order or invoice id, unique, giving webhook idempotency for free.
- **wall_subscriptions** — one row per active Lemon Squeezy subscription,
  with the pinned project it auto-glues. `provider` isn't hardcoded to
  Lemon Squeezy, on purpose (see "extending later").

See `supabase/migrations/0001_init.sql` for the actual DDL.

## 4. Game balance

The numbers that make the wall's pacing and the spray's payoff actually feel
right — pinned down explicitly since they're economic parameters, not just
vibes, and they drive the constants inside `spend_spray()`.

- **Baseline fall**: a project with 0 glue goes from top to ground in
  **4 months** (~120 days). Daily fall rate at zero glue ≈ 100/120 ≈ 0.83%/day.
- **One spray**:
  - **+5%** instant position lift (moves it up the wall immediately).
  - **+15 glue**, where glue is read directly as a fall-rate multiplier:
    `fall_speed = baseline_speed * (1 - glue/100)`. So one spray = the fall
    rate is 15% slower while that glue is still active.
  - Glue decays back to 0 **linearly over 30 days** — a spray's slowdown
    fades over roughly a month, not permanently.
- **Why the lift is 5%, not 15%**: it was originally going to match the
  slowdown number, but a $2 pack is 5 sprays — at 15%/spray that's +75%
  position in one purchase, enough to send a project from the ground floor
  to nearly the top for two dollars, which undercuts the entire "this took
  months to build up" premise the wall's pacing is built around. 5%/spray
  keeps a pack meaningfully helpful (a full 5-pack is +25%) without letting
  one cheap purchase erase months of decay in a single click. The slowdown
  side doesn't have this problem — it can't teleport a project anywhere,
  it just makes the ongoing fall gentler for a while — so it stayed at 15%.
- **Why 30-day glue decay**: it lines up with the monthly subscription
  cadence on purpose — subscribing is essentially "never let the glue fully
  decay before the next spray lands," which is a clean story to tell
  ("the plan keeps auto-glue coming before the previous batch wears off"),
  rather than an arbitrary unrelated number.

These are the real-world constants; the *demo* mockup runs on separate,
deliberately-accelerated timing (see `FALL_BASE`/`devSpeed` in its script)
so the pacing is actually testable in a browser tab — that demo scaling
should not be confused with these production numbers when `spend_spray()`
gets these constants wired in for real.

## 5. Extending later

- **Accounts**: add a `user_id` nullable column on `wall_sessions` and a
  "claim this session" flow — nothing above has to change shape.
- **Tiered memberships**: `wall_subscriptions.variant_id` already
  distinguishes Lemon Squeezy variants, so a second/third tier is a new
  variant id and a branch in `ls-webhook`, not a schema change.
- **Ko-fi as a secondary support channel**: a second, differently-shaped
  webhook handler writing into the same `wall_ledger` table with
  `source = 'kofi'` — the ledger design was chosen so this doesn't require
  touching anything else.
