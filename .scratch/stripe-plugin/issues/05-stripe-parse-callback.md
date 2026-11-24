# 05: Stripe webhook parsing

Status: resolved

**What to build:** The Stripe plugin's `parseCallback` verifies `Stripe-Signature` over the raw body, maps the four `payment_intent.*` events to normalised states, and ignores everything else. See [spec](../spec.md), "`parseCallback`".

**Blocked by:** 02, 04

- [ ] The signature is verified over the exact raw body bytes with the webhook secret and a 300-second tolerance, before anything else is read.
- [ ] A missing header, bad signature, stale timestamp, or unparseable body is `InvalidCallback` with a 400 acknowledgement.
- [ ] `payment_intent.succeeded` → `SUCCEEDED` with amount `amount_received`; `payment_intent.payment_failed` and `payment_intent.processing` → `PENDING`; `payment_intent.canceled` → `FAILED`.
- [ ] The attempt key comes from `data.object.metadata.attemptKey`, `providerRef` from `data.object.id`, and `providerEventId` from the event id.
- [ ] Other event types, events for a PaymentIntent with a missing or non-UUID `attemptKey`, and events whose `livemode` does not match the configured keys all return the ignored result.
- [ ] The acknowledgement is HTTP 200 with an empty body for handled and ignored events.
- [ ] Tests build signed callbacks with `stripe.webhooks.generateTestHeaderString`.
