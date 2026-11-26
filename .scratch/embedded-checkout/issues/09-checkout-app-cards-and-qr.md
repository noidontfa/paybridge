# 09: Checkout app: price cards and QR checkout

**What to build:** This is the tracer bullet for the Customer's experience. A new public app, `apps/checkout`, serves the versioned SDK and the checkout page. Pasting the snippet into a plain HTML page on an allowed website shows the Pricing Table. Picking a Pricing Plan opens a PayBridge-hosted iframe in a modal, where the Customer chooses a PaymentGateway and pays by QR with the fake gateway. The page then learns the result. See the [spec](../spec.md) (SDK and checkout page).

**Blocked by:** 07, 08

**Status:** done

- [ ] `apps/checkout` is a new public app, separate from the Console (ADR 0004). It calls only the API's public checkout endpoints and is wired into the workspace, docker-compose and CI like the other apps.
- [ ] The SDK is served under a major-version path, with exact-version paths for pinning. It reads `data-key`, `data-table`, `data-customer-ref`, `data-success-url` and `data-cancel-url`.
- [ ] The SDK draws the Pricing Table's cards inside a Shadow DOM, using the theme, language, features (✓/✗, plain text) and recommended badge. Host page styles do not change them.
- [ ] Picking a buyable Pricing Plan opens a modal with the checkout page in an iframe.
- [ ] The SDK and the iframe talk only through `postMessage`, with origin checks on both sides. The SDK passes the host origin, and the checkout page checks it against the Publishable Key.
- [ ] The checkout app sends `Content-Security-Policy: frame-ancestors` with the Publishable Key's allowed origins.
- [ ] In the checkout page, the Customer:
  - sees the Pricing Plan and Amount;
  - chooses among the allowed and enabled PaymentGateways;
  - gets a QR NextAction rendered;
  - is moved to a result screen automatically when the Payment succeeds, expires or is cancelled.
- [ ] A Customer can switch PaymentGateway after an abandoned attempt.
- [ ] The checkout session token is kept in the iframe's storage. Closing and reopening the modal, or clicking "Buy" again, resumes the same open Payment. If storage is unavailable, a new Payment starts each time.
- [ ] The SDK calls the optional `onSuccess`, `onCancel` and `onError` callbacks, and fires matching DOM events, with the Payment id. The SDK documentation says these must never unlock a purchase.
- [ ] Unavailable states (archived Pricing Plan, suspended Organization, origin not allowed, revoked key, deleted table) show "Payment is not available right now" in the table's language. The reason code goes only to the browser console.
- [ ] Playwright, with a plain HTML host page on an allowed origin and another on a disallowed one, covers:
  - the cards rendering;
  - a QR purchase with the fake gateway, ending in `onSuccess`;
  - cancel;
  - resume after reopening;
  - an archived Pricing Plan showing unavailable;
  - the disallowed origin being refused;
  - the iframe refusing to load on a disallowed origin.
