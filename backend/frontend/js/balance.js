// Live spray balance: fetched once, then kept in sync over Supabase
// Realtime so the SPRAYS counter updates the instant the webhook lands a
// grant — no polling, no page refresh.

import { getSessionToken } from './session.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient('https://YOUR-PROJECT.supabase.co', 'YOUR_ANON_PUBLIC_KEY');

export async function getBalance() {
  const { data, error } = await supabase
    .from('session_balances')
    .select('balance')
    .eq('session_id', getSessionToken())
    .maybeSingle();
  if (error) throw error;
  return data?.balance ?? 0;
}

export function subscribeToBalance(onChange) {
  const sessionToken = getSessionToken();
  return supabase
    .channel(`ledger-${sessionToken}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'ledger', filter: `session_id=eq.${sessionToken}` },
      async () => onChange(await getBalance()),
    )
    .subscribe();
}

export async function spendSpray(projectId) {
  const EDGE_FUNCTION_BASE = 'https://YOUR-PROJECT.functions.supabase.co';
  const res = await fetch(`${EDGE_FUNCTION_BASE}/spend-spray`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_token: getSessionToken(), project_id: projectId }),
  });
  const body = await res.json();
  if (res.status === 402) return { ok: false, balance: body.balance };
  if (!res.ok) throw new Error('spend failed');
  return body; // { ok: true, balance, glue }
}
