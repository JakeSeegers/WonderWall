// Opens Lemon Squeezy's real overlay checkout (their official JS SDK —
// this is what makes it feel like a popup rather than a full page
// redirect). Load their SDK script once, e.g. in <head>:
//   <script src="https://assets.lemonsqueezy.com/lemon.js" defer></script>

import { getSessionToken } from './session.js';

const EDGE_FUNCTION_BASE = 'https://YOUR-PROJECT.functions.supabase.co';

async function createCheckoutUrl(variantId) {
  const res = await fetch(`${EDGE_FUNCTION_BASE}/create-checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_token: getSessionToken(),
      variant_id: variantId,
    }),
  });
  if (!res.ok) throw new Error('checkout creation failed');
  const { checkout_url } = await res.json();
  return checkout_url;
}

// Call this from a pack "BUY" button or the "SUBSCRIBE" button —
// variantId is whichever Lemon Squeezy variant that button represents.
export async function openCheckout(variantId) {
  const url = await createCheckoutUrl(variantId);
  // window.LemonSqueezy comes from their lemon.js SDK loaded on the page;
  // it opens the checkout as an in-page overlay, not a new tab.
  window.LemonSqueezy.Url.Open(url);
}
