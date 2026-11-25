# Stripe fixtures

Replayed by `FixtureHttpClient` so the plugin specs and the contract suite
(`../stripe-gateway.contract.spec.ts`) run with no network access.

## Provenance: hand-built, NOT recorded

**Every file here was written by hand in the shape of Stripe's documented API
responses. None was recorded from Stripe test mode.** They carry fake ids
(`pi_3QxTest1…`), a fake `client_secret` (`…_secret_TestSecretValue123`) and
`created: 1764000000`. They prove the plugin handles the documented shape, not
that Stripe really answers this way for our requests (VND, card-only,
automatic capture). Re-record before relying on them as evidence.

| Group                | Files                   | Notes                                                                                                                |
| -------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| PaymentIntent states | `payment-intent.*.json` | One per status the plugin maps. `declined` is `requires_payment_method` plus `last_payment_error` (`card_declined`). |
| Errors               | `error.*.json`          | Bodies of Stripe error responses; the HTTP status is chosen in the spec.                                             |
| Search               | `search.*.json`         | `GET /v1/payment_intents/search` results.                                                                            |

Webhook events are not stored as files. The specs build them in code around
these PaymentIntent fixtures and sign them with `generateTestHeaderString`.

## Re-recording from Stripe test mode

Use a Stripe account in test mode only (`sk_test_…`). Never record live mode.

1. Install the Stripe CLI and run `stripe login`.
2. Put your test secret key in `STRIPE_KEY` and use the pinned API version
   from `STRIPE_API_VERSION` in `../stripe-gateway.plugin.ts`
   (`2026-11-18.endive`).
3. Record each response (the `Stripe-Version` header pins the shape):

   ```sh
   H='Stripe-Version: 2026-11-18.endive'
   KEY=$STRIPE_KEY
   KEY_UUID=0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b

   # requires_payment_method (create)
   curl -s https://api.stripe.com/v1/payment_intents -u "$KEY:" -H "$H" \
     -H "Idempotency-Key: $KEY_UUID" \
     -d amount=150000 -d currency=vnd -d "allowed_payment_method_types[]=card" \
     -d capture_method=automatic -d description="Order 1001" \
     -d "metadata[attemptKey]=$KEY_UUID" > payment-intent.requires-payment-method.json
   PI=$(jq -r .id payment-intent.requires-payment-method.json)

   # succeeded / declined / requires_action / requires_capture: confirm a new
   # PaymentIntent with a Stripe test payment method, e.g.
   #   -d payment_method=pm_card_visa                     (succeeded)
   #   -d payment_method=pm_card_chargeDeclined           (declined)
   #   -d payment_method=pm_card_threeDSecure2Required    (requires_action)
   # and, with -d capture_method=manual, pm_card_visa    (requires_capture)
   curl -s https://api.stripe.com/v1/payment_intents/$PI/confirm -u "$KEY:" -H "$H" \
     -d payment_method=pm_card_visa -d confirmation_method=automatic

   # canceled
   curl -s -X POST https://api.stripe.com/v1/payment_intents/$PI/cancel -u "$KEY:" -H "$H"

   # search
   curl -s -G https://api.stripe.com/v1/payment_intents/search -u "$KEY:" -H "$H" \
     --data-urlencode "query=metadata['attemptKey']:'$KEY_UUID'"

   # resource_missing
   curl -s https://api.stripe.com/v1/payment_intents/pi_does_not_exist -u "$KEY:" -H "$H"
   ```

   `processing`, `requires_confirmation`, the 429 and 500 errors, and
   `error.unexpected-state-*` cannot be produced on demand in test mode. Keep
   them hand-built, or capture them with `stripe listen` / the Dashboard
   request log when they occur.

4. Scrub before committing: replace `client_secret` with the fake value above,
   replace real ids with the fixture ids (the specs assert on
   `pi_3QxTest1AbCdEfGh0aBcDeFg` and the attempt key
   `0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b`), and drop any customer, charge or
   payment-method details. Never commit a real secret, key or client secret.
5. Run `pnpm test` in `apps/api` and fix the plugin or specs where the real
   shape differs from the hand-built one.
