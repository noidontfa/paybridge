# 04: Stripe initiate, query and cancel

Status: ready-for-agent

**What to build:** A `StripeGatewayPlugin` in `apps/api/src/gateways/stripe/` that creates, reads and cancels PaymentIntents, maps their status to the four normalised states, and maps Stripe SDK errors to Core's error categories. See [spec](../spec.md), sections "Stripe SDK", "`initiate`", "`query`", "`cancel`" and "Error mapping".

**Blocked by:** 01

- [ ] Adds the official `stripe` package at an exact version, and pins `apiVersion` in the client constructor.
- [ ] The plugin has gateway id `stripe`, `supportsCancel: true`, and `callbackHeaders: ['stripe-signature']`. It imports only from Core's port, never from other Core modules.
- [ ] The Stripe HTTP layer is injectable, so tests replay recorded responses.
- [ ] `initiate` creates a PaymentIntent with integer VND amount, `currency: "vnd"`, `payment_method_types: ["card"]`, `capture_method: "automatic"`, the description, and `metadata.attemptKey`, sending `Idempotency-Key` equal to the attempt key.
- [ ] `initiate` returns `providerRef` `pi_…`; a `CLIENT_SDK` next action with the client secret and `clientParams: { publishableKey, returnUrl }`; `providerMetadata: { paymentIntentId, livemode }`; and a raw payload with `client_secret` removed.
- [ ] A non-integer amount is rejected as `GatewayRejected` without calling Stripe.
- [ ] `query` retrieves by `paymentIntentId`. Without one, it searches on `metadata['attemptKey']` and returns `NotFound` on no match.
- [ ] `query` maps `succeeded` → `SUCCEEDED` (amount `amount_received`), `canceled` → `FAILED`, `requires_payment_method` / `requires_confirmation` / `requires_action` / `processing` → `PENDING`, and `requires_capture` → `REQUIRES_REVIEW`.
- [ ] `cancel` cancels the PaymentIntent with an idempotency key derived from the attempt key. An already-cancelled PaymentIntent is a success. `payment_intent_unexpected_state` is `GatewayRejected`.
- [ ] Errors map as in the spec's table, including `query` 5xx and connection errors as retryable `GatewayUnavailable`, and those same errors on `initiate` and `cancel` as `OutcomeUnknown`.
- [ ] Unit tests on recorded fixtures cover the Search fallback, cancel on an already-cancelled PaymentIntent, and the removal of `client_secret`.
