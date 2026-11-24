# 08: Merchant integration guide and smoke test

Status: ready-for-agent

**What to build:** A short guide in `docs/` that shows a merchant how to take a Stripe card payment through PayBridge with the Payment Element, plus the manual smoke test to run before release. No sample app. See [spec](../spec.md), user stories 2 and 14.

**Blocked by:** 06, 07

- [ ] `docs/integrations/stripe.md` covers:
  - setting the three keys;
  - configuring the Stripe webhook endpoint at `/webhooks/stripe` with only the four `payment_intent.*` events, using snapshot payloads;
  - the flow: create Payment, start attempt with `gatewayId: "stripe"`, read the `CLIENT_SDK` next action;
  - a snippet that loads Stripe.js with `clientParams.publishableKey`, mounts the Payment Element with `token` as the client secret, and calls `stripe.confirmPayment` with `confirmParams.return_url = clientParams.returnUrl`;
  - that the redirect is never proof of payment, and the merchant waits for the Payment's `SUCCEEDED` state;
  - that a declined card can be retried on the same checkout;
  - that refunds are done in the Stripe Dashboard for now.
- [ ] The guide's smoke test section lists:
  - `stripe listen --forward-to localhost:<port>/webhooks/stripe`;
  - a successful test card;
  - a decline followed by a retry;
  - a 3-D Secure test card;
  - an attempt cancelled by Payment Expiry, after which confirmation fails.
- [ ] The README links to the guide.
