# Taking Stripe card payments

How a merchant takes a card payment through PayBridge with the Stripe Payment Element. Your frontend renders Stripe's card form; PayBridge creates the PaymentIntent, receives Stripe's webhooks, and tells you when the Payment is paid. Why PayBridge uses PaymentIntents and not Stripe Checkout: [ADR 0003](../adr/0003-stripe-via-paymentintent-not-checkout.md). Terms follow the [glossary](../../GLOSSARY.md).

Scope: cards only, automatic capture, VND (whole dong). All PayBridge routes below sit under the public `/api` prefix. There is no sample app.

## 1. Configure PayBridge

Set all three keys in the API's environment (see `apps/api/.env.example`):

| Variable                 | Value                                                     |
| ------------------------ | --------------------------------------------------------- |
| `STRIPE_SECRET_KEY`      | `sk_...` or `rk_...` (restricted) key                     |
| `STRIPE_WEBHOOK_SECRET`  | `whsec_...`, the signing secret of the endpoint in step 2 |
| `STRIPE_PUBLISHABLE_KEY` | `pk_...`                                                  |

- All three set: the `stripe` gateway is registered. None set: it is not, and starting an attempt with `gatewayId: "stripe"` fails.
- Only some set, a wrong prefix, or test and live keys mixed (for example `sk_test_` with `pk_live_`): the API refuses to boot and names the problem.
- Use test keys with test keys and live keys with live keys, the webhook secret included.

## 2. Configure the Stripe webhook endpoint

In the Stripe Dashboard (Developers, Webhooks), add an endpoint:

- **URL:** `https://<your-paybridge-host>/api/webhooks/stripe`
- **Events:** exactly these four, with snapshot payloads (not thin events):
  - `payment_intent.succeeded`
  - `payment_intent.payment_failed`
  - `payment_intent.processing`
  - `payment_intent.canceled`
- **API version:** the version PayBridge pins in its Stripe client, currently `2026-11-18.endive` (`STRIPE_API_VERSION` in `apps/api/src/gateways/stripe/stripe-gateway.plugin.ts`). An event's payload follows the endpoint's version, so a different version can change the fields PayBridge reads.

Copy the endpoint's signing secret into `STRIPE_WEBHOOK_SECRET`. PayBridge verifies the `Stripe-Signature` header over the exact request body (300-second tolerance) and answers 400 to anything it cannot verify. Any other event type, and any PaymentIntent PayBridge did not create (a Dashboard payment, another app on the same Stripe account), is acknowledged with 200 and ignored.

## 3. The flow

1. **Create the Payment.** `POST /api/payments` with `amount` (a decimal string of whole dong, such as `"150000"`), `currency: "VND"`, your `upstreamReference`, and optionally `expiresAt` (30 minutes to 24 hours after creation; default 30 minutes). Send an `Idempotency-Key` header if you may retry. Keep the returned `id`.
2. **Start an attempt.** `POST /api/payments/:id/attempts`:

   ```json
   {
     "gatewayId": "stripe",
     "returnUrl": "https://shop.example/orders/2026-0001/return",
     "description": "Order 2026-0001"
   }
   ```

   `returnUrl` is your page, where Stripe sends the customer back; `description` is optional. The response is `{ attempt, payment }`. When the attempt is `PENDING`, `attempt.nextAction` is:

   ```json
   {
     "type": "CLIENT_SDK",
     "token": "pi_..._secret_...",
     "clientParams": {
       "publishableKey": "pk_test_...",
       "returnUrl": "https://shop.example/orders/2026-0001/return"
     }
   }
   ```

   `token` is the PaymentIntent client secret. If the gateway rejects the attempt, `attempt.status` is `FAILED` and `nextAction` is `null`; you may start another attempt. Only one attempt can be open at a time.

3. **Confirm in the browser** with the snippet below.
4. **Wait for the Payment to be `SUCCEEDED`.** Poll `GET /api/payments/:id` until its `status` leaves `PENDING` (the values are `PENDING`, `SUCCEEDED`, `CANCELLED`, `EXPIRED`).

`GET /api/payments/:id` returns each attempt with its `nextAction`, so a reloaded checkout page can mount the Payment Element again from the open attempt.

## 4. Payment Element snippet

```js
import { loadStripe } from '@stripe/stripe-js';

// `nextAction` is attempt.nextAction from the start-attempt response.
const { token, clientParams } = nextAction;

const stripe = await loadStripe(clientParams.publishableKey);
const elements = stripe.elements({ clientSecret: token });
elements.create('payment').mount('#payment-element');

document.querySelector('#pay').addEventListener('click', async () => {
  const { error } = await stripe.confirmPayment({
    elements,
    confirmParams: { return_url: clientParams.returnUrl },
  });
  // Reached only on an immediate error such as a declined card.
  // On success or 3-D Secure the browser is redirected to return_url.
  if (error) document.querySelector('#error').textContent = error.message;
});
```

The page needs a `#payment-element` container, a `#pay` button and an `#error` element. Without a bundler, load `https://js.stripe.com/v3/` and call `Stripe(clientParams.publishableKey)` instead of `loadStripe`.

## 5. Rules to follow

- **The redirect is not proof of payment.** The customer can reach `returnUrl` without paying, with a forged URL, or not at all (closed tab). On your return page, read the Payment with `GET /api/payments/:id` and treat the order as paid only when `status` is `SUCCEEDED`, which comes from Stripe's server-side webhook. If it is still `PENDING`, show a "processing" message and keep polling.
- **A declined card can be retried on the same checkout.** A decline leaves the attempt `PENDING` and the client secret stays valid, so the customer enters another card in the same Payment Element and you call `confirmPayment` again. Do not start a new attempt.
- **Expiry closes the attempt.** At Payment Expiry (or when you cancel the Payment with `POST /api/payments/:id/cancel`), PayBridge cancels the PaymentIntent at Stripe, so `confirmPayment` then fails and the customer cannot pay a closed order. Create a new Payment to try again.
- **Refunds are done in the Stripe Dashboard for now.** PayBridge has no refund route yet.

## 6. Smoke test before release

Use Stripe test keys and the [Stripe CLI](https://docs.stripe.com/stripe-cli). Run the API locally with `pnpm dev` (the port is `PORT`, default 3000).

1. Forward webhooks, copy the printed `whsec_...` into `STRIPE_WEBHOOK_SECRET`, and restart the API:

   ```bash
   stripe listen --forward-to localhost:<port>/api/webhooks/stripe
   ```

   Forwarded events use your account's default API version. For a faithful check of the pinned version, also test once through a real endpoint created with it.

2. **Success.** Create a Payment, start a `stripe` attempt, mount the Payment Element and pay with `4242 4242 4242 4242` (any future expiry, any CVC). `GET /api/payments/:id` shows `SUCCEEDED`.
3. **Decline, then retry.** On a new Payment, pay with `4000 0000 0000 0002` (declined). The attempt stays `PENDING`. Pay again in the same Payment Element with `4242 4242 4242 4242`; the Payment reaches `SUCCEEDED`.
4. **3-D Secure.** On a new Payment, pay with `4000 0025 0000 3155` and approve on the test authentication page. You land on your `returnUrl` and the Payment reaches `SUCCEEDED`.
5. **Expiry.** On a new Payment, start an attempt and do not pay. Wait past the Payment Expiry (30 minutes is the minimum; the expiry sweep runs every minute) until the Payment is `EXPIRED` and the PaymentIntent shows `canceled` in the Dashboard. Then press pay: `confirmPayment` returns an error.
6. **Foreign event.** Create a payment in the Stripe Dashboard, not through PayBridge. The CLI shows the event forwarded and answered 200, and PayBridge stores nothing.
