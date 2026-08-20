# Project Wall — payment architecture

Backend: **Supabase** (Postgres + Edge Functions). Payments: **Lemon Squeezy**
(Merchant of Record — handles one-time packs and the monthly subscription
through one integration, real overlay checkout, tax collected/remitted for
you). No sign-in for the MVP: every visitor is an anonymous **session**
identified by an opaque token in `localStorage`.

## 1. Flow overview

```
Browser (no login)
  1. On first visit, generate a session token (uuid), store in localStorage.
  2. User clicks BUY or SUBSCRIBE.
  3. Frontend calls Edge Function `create-checkout` with
     { session_token, kind: 'pack' | 'sub', variant_id }.
  4. create-checkout calls the Lemon Squeezy API to build a checkout,
     stamping session_token into checkout_data.custom, returns the
     checkout URL.
  5. Frontend opens it with the Lemon Squeezy overlay JS SDK
     (LemonSqueezy.Url.Open) — no full page redirect.
  6. Buyer pays on the Lemon Squeezy-hosted overlay.

Lemon Squeezy → webhook → Edge Function `ls-webhook`
  7. Verify X-Signature (HMAC-SHA256 of the raw body).
  8. Look up session_token from custom_data.
  9. Insert a `ledger` row (idempotent on external_id) granting sprays.
     order_created            -> one-time pack grant
     subscription_created     -> first monthly grant + create `subscriptions` row
     subscription_payment_success -> renewal grant
     subscription_cancelled / subscription_expired -> mark subscription inactive

Browser, live balance
  10. Frontend subscribes to Supabase Realtime on `ledger` (or polls a
      `balance` view) filtered by session_token, so the SPRAYS counter
      updates the moment the webhook lands — no page refresh needed.

Spraying (spending sprays)
  11. Frontend calls Edge Function `spend-spray`
      { session_token, project_id }.
  12. spend-spray runs a single atomic Postgres function that checks
      balance and, only if sufficient, inserts a `spend` ledger row and
      bumps the project's glue — avoiding a race where two rapid clicks
      both read a balance of 1 and both succeed.
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
    checkout.js                 calls create-checkout, opens LS overlay
    balance.js                  Realtime subscription + spend-spray calls

/supabase
  /migrations
    0001_init.sql               schema, RLS, spend_spray() function
  /functions
    create-checkout/index.ts    builds a Lemon Squeezy checkout
    ls-webhook/index.ts         verifies + applies LS webhook events
    spend-spray/index.ts        thin wrapper around the spend_spray() SQL fn
```

## 3. Database schema

- **sessions** — one row per anonymous visitor. The token itself lives only
  in the browser; the server just needs a stable id to hang a balance off.
- **projects** — server-authoritative glue/position, replacing the
  client-only simulation in the current mockup.
- **ledger** — event-sourced grants and spends. Balance is *derived*
  (`sum(grant) - sum(spend)`), never stored as a mutable counter, so it can
  always be reconstructed/audited. `external_id` is the Lemon Squeezy
  order or invoice id, unique, giving webhook idempotency for free.
- **subscriptions** — one row per active Lemon Squeezy subscription, with
  the pinned project it auto-glues.

See `supabase/migrations/0001_init.sql` for the actual DDL.

## 4. Extending later

- **Accounts**: add a `user_id` nullable column on `sessions` and a
  "claim this session" flow — nothing above has to change shape.
- **Tiered memberships**: `subscriptions.variant_id` already distinguishes
  Lemon Squeezy variants, so a second/third tier is a new variant id and a
  branch in `ls-webhook`, not a schema change.
- **Ko-fi as a secondary support channel**: a second, differently-shaped
  webhook handler writing into the same `ledger` table with
  `source = 'kofi'` — the ledger design was chosen so this doesn't require
  touching anything else.
