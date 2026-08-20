// Lemon Squeezy webhook receiver.
//
// Verifies the signature against the RAW request body (must happen before
// any JSON parsing — re-serializing a parsed body will not byte-match what
// Lemon Squeezy signed), then applies the event to the ledger.
//
// Idempotent by construction: `ledger.external_id` has a unique index, so a
// duplicate delivery of the same event just fails the insert harmlessly.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const WEBHOOK_SECRET = Deno.env.get("LS_WEBHOOK_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Maps Lemon Squeezy variant ids -> how many sprays a pack/subscription grants.
// Configure these to match the variants created in the Lemon Squeezy dashboard.
const PACK_SPRAYS: Record<string, number> = {
  "VARIANT_ID_PACK_5": 5,
  "VARIANT_ID_PACK_20": 20,
  "VARIANT_ID_PACK_50": 50,
};
const SUBSCRIPTION_MONTHLY_SPRAYS = 25;

async function verifySignature(rawBody: string, signatureHeader: string | null): Promise<boolean> {
  if (!signatureHeader) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  // timing-safe compare
  if (expected.length !== signatureHeader.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  const rawBody = await req.text();
  const signature = req.headers.get("X-Signature");

  if (!(await verifySignature(rawBody, signature))) {
    return new Response("invalid signature", { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const eventName: string = payload.meta?.event_name;
  const customData = payload.meta?.custom_data ?? {};
  const sessionToken: string | undefined = customData.session_token;

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Resolve (or lazily create) the session row for this token. In
  // production the session row is created on first page load via a
  // lightweight Edge Function — this upsert is a defensive fallback.
  async function resolveSessionId(): Promise<string | null> {
    if (!sessionToken) return null;
    const { data, error } = await supabase
      .from("sessions")
      .upsert({ id: sessionToken }, { onConflict: "id", ignoreDuplicates: true })
      .select("id")
      .single();
    if (error) {
      console.error("session upsert failed", error);
      return null;
    }
    return data.id;
  }

  switch (eventName) {
    case "order_created": {
      const attrs = payload.data.attributes;
      if (attrs.status !== "paid") break; // ignore unpaid/refunded-at-creation edge cases

      const variantId = String(payload.data.attributes.first_order_item?.variant_id ?? "");
      const sprays = PACK_SPRAYS[variantId];
      const sessionId = await resolveSessionId();
      if (!sprays || !sessionId) break;

      await supabase.from("ledger").insert({
        session_id: sessionId,
        kind: "grant",
        amount: sprays,
        source: "ls_order",
        external_id: `order_${payload.data.id}`,
      });
      break;
    }

    case "subscription_created": {
      const sessionId = await resolveSessionId();
      if (!sessionId) break;
      const attrs = payload.data.attributes;

      await supabase.from("subscriptions").upsert({
        session_id: sessionId,
        ls_subscription_id: String(payload.data.id),
        variant_id: String(attrs.variant_id),
        status: "active",
        current_period_end: attrs.renews_at,
      }, { onConflict: "ls_subscription_id" });

      await supabase.from("ledger").insert({
        session_id: sessionId,
        kind: "grant",
        amount: SUBSCRIPTION_MONTHLY_SPRAYS,
        source: "ls_subscription",
        external_id: `sub_create_${payload.data.id}`,
      });
      break;
    }

    case "subscription_payment_success": {
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("session_id")
        .eq("ls_subscription_id", String(payload.data.id))
        .single();
      if (!sub) break;

      await supabase.from("ledger").insert({
        session_id: sub.session_id,
        kind: "grant",
        amount: SUBSCRIPTION_MONTHLY_SPRAYS,
        source: "ls_subscription",
        // invoice/renewal id keeps each billing cycle's grant idempotent
        external_id: `sub_renew_${payload.data.attributes.invoice_id ?? payload.data.id}_${payload.data.attributes.renews_at}`,
      });
      break;
    }

    case "subscription_cancelled":
    case "subscription_expired": {
      await supabase
        .from("subscriptions")
        .update({ status: eventName === "subscription_cancelled" ? "cancelled" : "expired", updated_at: new Date().toISOString() })
        .eq("ls_subscription_id", String(payload.data.id));
      break;
    }

    default:
      // Unhandled event types are fine to ignore — Lemon Squeezy sends
      // several we don't act on (e.g. subscription_updated for plan
      // changes we don't support yet).
      break;
  }

  return new Response("ok", { status: 200 });
});
