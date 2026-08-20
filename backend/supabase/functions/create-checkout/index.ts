// Builds a Lemon Squeezy checkout and hands the URL back to the browser,
// which opens it in the LS overlay (see frontend/js/checkout.js). The
// anonymous session token is stamped into checkout_data.custom so the
// webhook can attribute the resulting payment to the right browser without
// any login step.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LS_API_KEY = Deno.env.get("LS_API_KEY")!;
const LS_STORE_ID = Deno.env.get("LS_STORE_ID")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface CheckoutRequest {
  session_token: string;
  variant_id: string; // one of the pack variants, or the subscription variant
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const { session_token, variant_id } = (await req.json()) as CheckoutRequest;
  if (!session_token || !variant_id) {
    return new Response("session_token and variant_id are required", { status: 400 });
  }

  // Make sure the session row exists before we ever reference it.
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  await supabase.from("sessions").upsert({ id: session_token }, { onConflict: "id", ignoreDuplicates: true });

  const res = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
    method: "POST",
    headers: {
      "Accept": "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
      "Authorization": `Bearer ${LS_API_KEY}`,
    },
    body: JSON.stringify({
      data: {
        type: "checkouts",
        attributes: {
          checkout_data: {
            custom: { session_token },
          },
          product_options: {
            redirect_url: "https://your-project-wall.example/thanks",
          },
        },
        relationships: {
          store: { data: { type: "stores", id: LS_STORE_ID } },
          variant: { data: { type: "variants", id: variant_id } },
        },
      },
    }),
  });

  if (!res.ok) {
    console.error("Lemon Squeezy checkout creation failed", await res.text());
    return new Response("checkout creation failed", { status: 502 });
  }

  const body = await res.json();
  const checkoutUrl = body.data.attributes.url;

  return new Response(JSON.stringify({ checkout_url: checkoutUrl }), {
    headers: { "Content-Type": "application/json" },
  });
});
