# Map: Stripe Gateway Plugin

## Destination

A Stripe Gateway Plugin in `apps/api/src/gateways/stripe/` that implements Core's `PaymentGateway` port, passes the shared contract suite, and is registered in the composition root (`apps/api/src/gateways/gateways.module.ts`). It is accompanied by the small Core port change it needs and by a merchant integration guide. The spec is [spec.md](spec.md); the implementation tickets are in [issues/](issues/).

## Notes

- **Depends on**: Payment Core Phase 1, merged into `main` ([noidontfa/paybridge#3](https://github.com/noidontfa/paybridge/pull/3)). The port, Gateway Manager, contract suite (`apps/api/test/contract/payment-gateway.contract.ts`) and the fake plugin already exist.
- **Context**: single context. Vocabulary follows [GLOSSARY.md](../../GLOSSARY.md); no new terms were introduced.
- **Location**: plugins live in `apps/api/src/gateways/<gateway>/`, not in `packages/`. The port types live in the app, and the lint rule that stops Core importing plugins matches `**/gateways/**`.
- **Language**: every artifact saved in the repo is written in English.

## Decisions so far

Settled by grilling on 2026-11-24 (no separate tickets):

- Stripe is integrated through **PaymentIntent + Stripe.js**, not hosted Checkout ([ADR 0003](../../docs/adr/0003-stripe-via-paymentintent-not-checkout.md)).
- **Cards only**, **automatic capture only**, **VND only** (the merchant's Stripe account is in a Stripe-supported country and charges in VND).
- **Payments only**: refunds stay in the Stripe Dashboard until the refund effort exists.
- **Provider Reference** is the PaymentIntent id `pi_…`.
- The **publishable key** reaches the browser through a new optional `clientParams` bag on the `CLIENT_SDK` next action, together with the return URL.
- **Webhook mapping**: `payment_intent.succeeded` → `SUCCEEDED`; `payment_intent.payment_failed` and `payment_intent.processing` → `PENDING`; `payment_intent.canceled` → `FAILED`; other events acknowledged and ignored.
- **Query without a `pi_…`** (after an `OutcomeUnknown` initiate) uses the Stripe Search API on the attempt key metadata; no match is `NotFound`.
- **Ignored callbacks**: the port gains an ignored `parseCallback` result, so other event types and PaymentIntents PayBridge did not create are acknowledged and never stored in the webhook inbox.
- **No minimum amount** in the plugin; Stripe's rejection surfaces as `GatewayRejected`.
- **Config**: three keys, all or none; a partial set fails boot. Gateway id `stripe`.
- **Tests**: contract suite against recorded test-mode fixtures; no live Stripe calls in CI; manual `stripe listen` smoke test before release.
- **Merchant docs**: a short integration guide with a Payment Element snippet; no sample app.

## Tickets

- [01: `clientParams` on the client SDK next action](issues/01-client-params-on-client-sdk-next-action.md)
- [02: Ignored callbacks in the port](issues/02-ignored-callbacks.md)
- [03: Stripe configuration](issues/03-stripe-configuration.md)
- [04: Stripe initiate, query and cancel](issues/04-stripe-initiate-query-cancel.md)
- [05: Stripe webhook parsing](issues/05-stripe-parse-callback.md)
- [06: Stripe contract suite registration](issues/06-stripe-contract-suite.md)
- [07: Register the Stripe plugin](issues/07-register-stripe-plugin.md)
- [08: Merchant integration guide and smoke test](issues/08-merchant-integration-guide.md)

## Out of scope

- Refunds through Stripe (refund effort).
- Manual capture / authorise-then-capture.
- Delayed or voucher payment methods (Konbini, bank debits, and so on).
- Hosted Checkout Sessions.
- Currencies other than VND.
- A sample merchant frontend application.
- Moving Gateway Plugins into `packages/` (would first require moving the port into a package).
