Status: ready-for-agent

# Spec: Stripe Gateway Plugin

Source: [Map: Stripe Gateway Plugin](map.md), grilled on 2026-11-24. Vocabulary follows [GLOSSARY.md](../../GLOSSARY.md). Architecture decision: [ADR 0003](../../docs/adr/0003-stripe-via-paymentintent-not-checkout.md). Provider facts: [gateway divergences research](../payment-core/research/gateway-divergences.md), section "Stripe". Builds on [Spec: Payment Core (Phase 1)](../payment-core/spec.md), merged in [noidontfa/paybridge#3](https://github.com/noidontfa/paybridge/pull/3).

## Problem Statement

Payment Core is merged with a provider-neutral `PaymentGateway` port, a Gateway Manager, a shared contract suite, and a fake plugin. No real PaymentGateway is connected yet, so the merchant cannot collect money. The merchant wants to accept card payments through Stripe inside their own checkout UI.

Stripe does not fit the port without care. A PaymentIntent never expires on its own. A decline sends it back to `requires_payment_method` instead of ending it. The browser needs a publishable key as well as the client secret, and the port gives the plugin no way to pass it. Stripe sends events for PaymentIntents that PayBridge did not create, and the port has no way to acknowledge and ignore such an event. If these are not handled, a customer can pay after the Payment Expiry, a decline can close an attempt the customer could still pay, or the webhook inbox fills with rows that alert forever.

## Solution

- A Stripe Gateway Plugin, gateway id `stripe`, in `apps/api/src/gateways/stripe/`, registered in `apps/api/src/gateways/gateways.module.ts` when its configuration is present.
- It creates a PaymentIntent (cards only, automatic capture, VND) and returns its `client_secret` as a `CLIENT_SDK` next action. The merchant's frontend renders the Stripe Payment Element and confirms the payment.
- Core enforces Payment Expiry by calling the plugin's `cancel`, which cancels the PaymentIntent.
- Two small, provider-neutral changes to Core's port:
  1. the `CLIENT_SDK` next action gains an optional `clientParams` bag;
  2. `parseCallback` may report a callback as ignored, with its acknowledgement, and Core then stores nothing.
- The plugin passes the shared contract suite against recorded Stripe test-mode responses.
- A merchant integration guide with a Payment Element snippet.

## User Stories

### Merchant

1. As a merchant integrator, I want to start an attempt with `gatewayId: "stripe"` and receive a `CLIENT_SDK` next action with a client secret, a publishable key and a return URL, so that my frontend can mount the Stripe Payment Element without its own Stripe configuration.
2. As a merchant integrator, I want a short guide with a code snippet, so that I can wire the Payment Element and `confirmPayment` to PayBridge correctly.
3. As a merchant, I want Stripe payments to reach `SUCCEEDED` only from Stripe's server-side signal, so that a closed browser or a forged redirect never marks an order paid.
4. As a merchant, I want events for PaymentIntents that PayBridge did not create (Dashboard payments, other apps on the same Stripe account) to be acknowledged and ignored, so that they neither fail in the inbox nor raise alerts.

### Customer

5. As a customer, I want a declined card to let me try another card on the same checkout, so that one decline does not force the merchant to restart the payment.
6. As a customer whose card needs 3-D Secure, I want to be sent back to the merchant's return URL after approving with my bank, so that I see the result.
7. As a customer, I want to be unable to pay after the Payment has expired or been cancelled, so that I am not charged for a closed order.

### Payment Core

8. As Payment Core, I want the Stripe plugin to report only the four normalised states, so that the state machine stays provider-neutral.
9. As Payment Core, I want to query an attempt whose `initiate` timed out, so that an `OutcomeUnknown` attempt can still be resolved.
10. As Payment Core, I want a callback the plugin marks as ignored to be acknowledged with the plugin's acknowledgement and not stored, so that irrelevant provider events do not enter the webhook inbox.
11. As Payment Core, I want the `CLIENT_SDK` next action to carry opaque client parameters that I never interpret, so that I stay independent of Stripe.

### Operator and engineer

12. As an operator, I want the Stripe plugin to be registered only when all three Stripe keys are set, and the boot to fail when only some are set, so that a half-configured deployment never starts.
13. As an engineer, I want the plugin to pass the same contract suite as every other plugin, without live Stripe calls in CI, so that CI is fast and deterministic.
14. As an engineer, I want a documented manual smoke test with the Stripe CLI, so that the real signature and event flow is checked before release.

## Implementation Decisions

### Location and registration

- Code lives in `apps/api/src/gateways/stripe/`, next to `fake/`. Not in `packages/`: the port types live in the app, and the lint rule in `apps/api/.oxlintrc.json` that stops Core importing plugins matches `**/gateways/**`.
- The plugin is registered explicitly in the `GATEWAY_PLUGINS` factory in `gateways.module.ts`. It is registered in every environment when configured. The fake plugin keeps its current rule (outside production only).
- Gateway id: `stripe`. Webhooks arrive at `POST /api/webhooks/stripe`.
- `capabilities.supportsCancel = true`.
- `callbackHeaders = ['stripe-signature']`.

### Configuration

- Three new optional keys in `envSchema`: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY`.
- All three set: the plugin is registered. None set: it is not. Any other combination: boot fails with an error naming the missing keys.
- Light format checks: secret key starts with `sk_` or `rk_`, webhook secret with `whsec_`, publishable key with `pk_`. Test and live keys must not be mixed (`sk_test_` with `pk_live_` fails boot).
- Added to `.env.example` files with empty values. No real keys are committed.

### Stripe SDK

- Official `stripe` npm package, exact version pinned, and an explicit `apiVersion` pinned in the client constructor.
- Every write call sends `Idempotency-Key` equal to the attempt key (hyphenated UUID form, as fixed in the Core spec). The SDK's network retries reuse it, so a retry can never create a second PaymentIntent.
- The HTTP layer is injectable (Stripe SDK `httpClient` option, or a constructor seam), so tests replay recorded responses.

### `initiate`

- Creates a PaymentIntent with:
  - `amount`: the Core amount as an integer. VND is zero-decimal in Stripe, so whole dong is sent unchanged. A non-integer amount is a defensive `GatewayRejected`.
  - `currency: "vnd"`.
  - `allowed_payment_method_types: ["card"]` (the pinned `apiVersion` `2026-11-18.endive` uses this param instead of `payment_method_types`).
  - `capture_method: "automatic"`.
  - `description`: the input description.
  - `metadata.attemptKey`: the attempt key.
- No minimum amount is checked in the plugin. Stripe's rejection of a too-small amount (about US$0.50 in the settlement currency) surfaces as `GatewayRejected`.
- `expiresAt` is not sent to Stripe; a PaymentIntent has no expiry. Core enforces the deadline by cancelling.
- `returnUrl` is not sent to Stripe on creation; it is used by the browser during confirmation.
- Result:
  - `providerRef`: the PaymentIntent id `pi_…`.
  - `nextAction`: `{ type: 'CLIENT_SDK', token: <client_secret>, clientParams: { publishableKey, returnUrl } }`.
  - `providerMetadata`: `{ paymentIntentId, livemode }`.
  - `rawPayload`: the PaymentIntent as returned, with `client_secret` removed (it is already in the next action, and the raw table is audit data kept indefinitely).

### `query`

- With `providerMetadata.paymentIntentId`: retrieve that PaymentIntent.
- Without it (an `initiate` that ended in `OutcomeUnknown`): Stripe Search API, `metadata['attemptKey']:'<attemptKey>'`. No match is `NotFound`. More than one match is impossible by idempotency; if it happens, use the newest and log a warning. Search is eventually consistent (about one minute); Core's re-query runs later than that.
- Status mapping:

| PaymentIntent status                                                                | Normalised                                                                                     |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `succeeded`                                                                         | `SUCCEEDED`                                                                                    |
| `canceled`                                                                          | `FAILED`                                                                                       |
| `requires_payment_method`, `requires_confirmation`, `requires_action`, `processing` | `PENDING`                                                                                      |
| `requires_capture`                                                                  | `REQUIRES_REVIEW` (should not happen with automatic capture; never silently treated as unpaid) |

- Reported amount: `amount_received` when `SUCCEEDED`, otherwise `null`.
- `providerRef`: the PaymentIntent id.

### `cancel`

- Cancels the PaymentIntent (`POST /v1/payment_intents/:id/cancel`) with `Idempotency-Key` derived from the attempt key (for example `<attemptKey>:cancel`).
- Already `canceled`: success.
- `succeeded` or `processing` (Stripe answers `payment_intent_unexpected_state`): `GatewayRejected`. Core's cancel is best-effort; the success arrives through the webhook or the query before close, and Core's Late Success rules apply.
- After a successful cancel the customer can no longer confirm that PaymentIntent, so no payment is possible after Core closes the attempt.

### `parseCallback`

- Verifies `Stripe-Signature` over the exact raw body bytes with `STRIPE_WEBHOOK_SECRET` and a 300-second timestamp tolerance, before reading anything else. Missing header, bad signature, stale timestamp, or unparseable body: `InvalidCallback`, with a 400 acknowledgement.
- Snapshot (classic) event payloads only; the Stripe endpoint must not be configured for thin events.
- Event mapping:

| Event type                                                                    | Result                                                       |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `payment_intent.succeeded`                                                    | `SUCCEEDED`, amount `amount_received`                        |
| `payment_intent.payment_failed`                                               | `PENDING` (the customer can retry on the same PaymentIntent) |
| `payment_intent.processing`                                                   | `PENDING`                                                    |
| `payment_intent.canceled`                                                     | `FAILED`                                                     |
| any other type                                                                | ignored                                                      |
| one of the above, but `data.object.metadata.attemptKey` missing or not a UUID | ignored (a PaymentIntent PayBridge did not create)           |

- `attemptKey`: from `data.object.metadata.attemptKey`. `providerRef`: `data.object.id`. `providerEventId`: the event id `evt_…`.
- Acknowledgement: HTTP 200 with an empty body, for both handled and ignored events.
- A test-mode event reaching a live-mode configuration (or the reverse) is ignored.

### Core change 1: `clientParams` on the `CLIENT_SDK` next action

- `ClientSdkNextAction` becomes `{ type: 'CLIENT_SDK'; token: string; clientParams?: Readonly<Record<string, string>> }`.
- Core stores and returns it as part of the next action and never interprets it. The publishable key is therefore stored in the attempt's next-action JSON. It is a public key; after a key rotation, still-open attempts keep the old key until they close.
- The contract suite's next-action check accepts the optional field and checks that its values are strings. The response DTO descriptions mention it.

### Core change 2: ignored callbacks

- `parseCallback` may return an ignored result: `{ kind: 'ignored', ack: CallbackAck }`, alongside the existing result. The existing result keeps its shape (marked with `kind: 'handled'` or distinguished by the absence of `kind`; the implementer picks the variant that keeps existing plugins compiling with least churn).
- Webhook intake: on an ignored result, replies with the plugin's `ack` and writes nothing to `core_webhook_inbox`. It logs the event at debug level with the gateway id.
- Webhook processing (replay of a stored row): if re-parsing a stored row returns ignored, the row is marked processed with no state change.
- The contract suite gains an optional `ignoredCallbacks` list in the registration. Each entry must produce an ignored result with a 2xx acknowledgement, and must not throw. The fake plugin gains one ignored case so the suite path is exercised.

### Error mapping

| Stripe SDK error                                                                                                                                  | Category             | Retryable                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ----------------------------- |
| `StripeInvalidRequestError` (400, including amount below minimum), `StripeAuthenticationError`, `StripePermissionError`, `StripeIdempotencyError` | `GatewayRejected`    | no                            |
| `StripeRateLimitError` (429)                                                                                                                      | `GatewayUnavailable` | yes                           |
| `StripeConnectionError`, `StripeAPIError` (5xx) on `initiate` or `cancel`                                                                         | `OutcomeUnknown`     | no (Core re-queries)          |
| `StripeConnectionError`, `StripeAPIError` on `query`                                                                                              | `GatewayUnavailable` | yes (a read is safe to retry) |
| `resource_missing` on `query` or `cancel`                                                                                                         | `NotFound`           | no                            |
| signature or payload problems in `parseCallback`                                                                                                  | `InvalidCallback`    | no                            |

## Testing Decisions

- The plugin is tested through the shared contract suite (`apps/api/test/contract/payment-gateway.contract.ts`) with a registration in `apps/api/src/gateways/stripe/stripe-gateway.contract.spec.ts`. It covers every normalised state, every operation error category, the invalid callbacks (bad signature, missing header, stale timestamp), and the ignored callbacks (other event type, PaymentIntent with no attempt key).
- Provider responses are JSON fixtures recorded from Stripe test mode and kept in `apps/api/src/gateways/stripe/fixtures/`, with secrets scrubbed. Replayed through the injectable HTTP layer. No live Stripe calls in CI.
- Signed callbacks are built with `stripe.webhooks.generateTestHeaderString` and a test webhook secret.
- Focused unit tests only where the contract suite cannot reach: the amount conversion, the Search fallback in `query`, `cancel` on an already-cancelled PaymentIntent, and the removal of `client_secret` from the raw payload.
- Configuration: tests for the all-or-none rule and the test/live mix check.
- Core changes: the existing port type test gains a case for `clientParams`; webhook intake gets a test that an ignored callback is acknowledged and not stored; webhook processing gets a test for a re-parsed ignored row.
- Prior art: `apps/api/src/gateways/fake/fake-gateway.contract.spec.ts`.
- Manual smoke test before release, documented in the guide: Stripe test keys, `stripe listen --forward-to localhost:<port>/api/webhooks/stripe`, a test card payment end to end, a decline then a retry, a 3-D Secure card, and a cancel by expiry.

## Out of Scope

- Refunds through Stripe; done in the Stripe Dashboard until the refund effort exists.
- Manual capture.
- Delayed or voucher payment methods.
- Hosted Checkout Sessions ([ADR 0003](../../docs/adr/0003-stripe-via-paymentintent-not-checkout.md)).
- Currencies other than VND.
- A sample merchant frontend application.
- Moving plugins into `packages/`.
- Stripe Connect or multiple Stripe accounts.

## Further Notes

- The Stripe webhook endpoint should still be configured to send only the four `payment_intent.*` event types, to reduce traffic. Ignoring other events is a safety net, not the main filter.
- The Stripe Search API is not available in every region (for example India). The merchant's account is assumed to be in a region where it is; if not, `query` without a PaymentIntent id returns `NotFound`.
