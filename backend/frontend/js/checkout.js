// Opens Lemon Squeezy's real overlay checkout (their official JS SDK —
// this is what makes it feel like a popup rather than a full page
// redirect). Load their SDK script once, e.g. in <head>:
//   <script src="https://assets.lemonsqueezy.com/lemon.js" defer></script>
//
// No server call needed to build the checkout: standard Lemon Squeezy Buy
// Links accept custom data as a query parameter directly
// (docs.lemonsqueezy.com/help/checkout/passing-custom-data). This only
// works on Buy Links (/checkout/buy/...), not on checkouts created via
// their API, which is exactly why there's no create-checkout function.

import { getSessionToken } from './session.js';

const STORE_SUBDOMAIN = 'YOUR-STORE'; // e.g. 'projectwall' for projectwall.lemonsqueezy.com

function buyLinkUrl(variantId) {
  const url = new URL(`https://${STORE_SUBDOMAIN}.lemonsqueezy.com/checkout/buy/${variantId}`);
  url.searchParams.set('checkout[custom][session_token]', getSessionToken());
  return url.toString();
}

// Call this from a pack "BUY" button or the "SUBSCRIBE" button —
// variantId is whichever Lemon Squeezy variant that button represents.
export function openCheckout(variantId) {
  // window.LemonSqueezy comes from their lemon.js SDK loaded on the page;
  // it opens the checkout as an in-page overlay, not a new tab.
  window.LemonSqueezy.Url.Open(buyLinkUrl(variantId));
}
