// Thin wrapper around the spend_spray() Postgres function — the balance
// check and the spend happen atomically in the database (see migration
// 0001), so this function has no race-condition logic of its own to get
// wrong.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface SpendRequest {
  session_token: string;
  project_id: string;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const { session_token, project_id } = (await req.json()) as SpendRequest;
  if (!session_token || !project_id) {
    return new Response("session_token and project_id are required", { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data, error } = await supabase
    .rpc("spend_spray", { p_session_id: session_token, p_project_id: project_id, p_amount: 1 })
    .single();

  if (error) {
    console.error("spend_spray failed", error);
    return new Response("internal error", { status: 500 });
  }

  if (!data.ok) {
    return new Response(JSON.stringify({ ok: false, balance: data.new_balance }), {
      status: 402, // Payment Required — out of sprays
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, balance: data.new_balance, glue: data.new_glue }), {
    headers: { "Content-Type": "application/json" },
  });
});
