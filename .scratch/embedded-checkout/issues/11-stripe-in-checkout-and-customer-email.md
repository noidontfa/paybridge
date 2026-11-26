# 11: Stripe in the checkout and Customer email

**What to build:** Customers can pay with Stripe inside the checkout iframe. Organizations whose page has no sign-in can ask Customers for their email, so they know who bought. See the [spec](../spec.md) (SDK and checkout page) and ADR 0003.

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] When the NextAction is client SDK, the checkout page loads Stripe.js and mounts the Payment Element using the `clientParams` (publishable key, return URL). The Customer confirms in the iframe.
- [ ] A Stripe decline keeps the Customer on the same attempt so they can retry, matching the plugin's `PENDING` behaviour. 3-D Secure returns through the return page (10 if it is done; otherwise straight to the checkout page).
- [ ] With `data-ask-email`, the checkout asks for and validates an email before starting the Payment. The email is sent as the Customer Reference email (07), alongside any `data-customer-ref`.
- [ ] The email appears on the Payment's detail in the Console and in its Webhooks' payload.
- [ ] Playwright covers the email step with the fake gateway. Stripe is covered by an integration or e2e test in Stripe test mode where credentials are available, following the existing real-gateway test setup, and is skipped otherwise.
