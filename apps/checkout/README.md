# PayBridge Checkout (`apps/checkout`)

The public side of the Embedded Checkout: the SDK script an Organization pastes into its pages, and the checkout page that the SDK opens in an iframe. It is separate from the Console (ADR 0004) and calls only the API's public checkout endpoints (`/api/checkout/...`, ADR 0009).

## Embedding a Pricing Table

```html
<script
  src="https://checkout.paybridge.example/v1/paybridge.js"
  data-key="pb_pk_..."
  data-table="<Pricing Table id>"
  data-customer-ref="user-42"
  data-success-url="https://shop.example.com/thanks"
  data-cancel-url="https://shop.example.com/pricing"
  data-on-success="onPaid"
  data-on-cancel="onCancelled"
  data-on-error="onCheckoutError"
></script>
```

- `data-key` (required): a Publishable Key whose allowed origins include this page's origin.
- `data-table` (required): the Pricing Table to show. The cards are drawn where the script tag is, inside a Shadow DOM, so the page's styles do not change them.
- `data-customer-ref` (optional): your own id for the Customer. It is stored on the Payment and sent in its Webhooks.
- `data-success-url`, `data-cancel-url` (optional): override the Pricing Plan's URLs after a redirect gateway. They must be on one of the Publishable Key's allowed origins, or the return page ignores them.
- `/v1/paybridge.js` always serves the latest 1.x. Pin an exact version with `/v1.0.0/paybridge.js`.

### Callbacks and events

`data-on-success`, `data-on-cancel` and `data-on-error` name global functions. Each is called with `{ paymentId }` (`paymentId` is `null` if no Payment was started; errors also carry a `reason`). The same detail is dispatched as the DOM events `paybridge:success`, `paybridge:cancel` and `paybridge:error`, which bubble up to `document`:

```js
document.addEventListener('paybridge:success', (event) => showThankYou(event.detail.paymentId));
```

> **Never unlock a purchase from these callbacks or events.** They run in the Customer's browser, where anyone can call them from the developer console. Use them only to update the page. Grant what was bought when your server receives the signed `payment.succeeded` Webhook for that Payment.

`cancel` fires when the Customer closes the checkout before paying (reopening it resumes the same Payment while it is open) or when the Payment expires or is cancelled.

### When nothing can be sold

The Customer sees only "Payment is not available right now", in the Pricing Table's language (or, when the table itself cannot be read, the page's `<html lang>`: `vi…` for Vietnamese, English otherwise). The reason (`ORIGIN_NOT_ALLOWED`, `INVALID_PUBLISHABLE_KEY`, `PRICING_TABLE_NOT_FOUND`, `PRICING_PLAN_ARCHIVED`, `ORGANIZATION_SUSPENDED`, `NO_GATEWAY_AVAILABLE`, ...) is written to the browser console, prefixed `[PayBridge]`, and passed to `onError`.

## How it fits together

- The SDK reads the Pricing Table from the API with the Publishable Key; the API checks the page's `Origin`.
- The checkout page runs at `/checkout?key=...&hostOrigin=...` in an iframe. Before serving it, the app asks the API (`GET /api/checkout/frame`) which origins may frame it and sends them as `Content-Security-Policy: frame-ancestors`; a refused key or host page gets `'none'`.
- The SDK and the page talk only through `postMessage`, each accepting messages only from the other's window and origin (`src/shared/messages.ts`).
- From the iframe, API calls carry the checkout app's origin and `X-PayBridge-Host-Origin`; the API accepts them only from `CHECKOUT_APP_ORIGINS` and checks the host origin against the key.
- The checkout session token lives in the iframe's `localStorage`, so reopening resumes the same open Payment. Without storage, every opening starts a new Payment.
- NextAction views are in `src/page/next-actions.ts`: QR codes are drawn there; redirects take the whole tab to the gateway; client SDKs such as Stripe.js are ticket 11.

## Running it

```bash
pnpm --filter @paybridge/checkout dev     # http://localhost:3200, API at http://localhost:9999
pnpm --filter @paybridge/checkout build && pnpm --filter @paybridge/checkout start
```

Environment: `PORT` (3200), `CHECKOUT_PUBLIC_URL` (how browsers reach this app), `PAYBRIDGE_API_URL` (how browsers reach the API), `PAYBRIDGE_INTERNAL_API_URL` (how this server reaches it). The API must list `CHECKOUT_PUBLIC_URL` in `CHECKOUT_APP_ORIGINS` (it allows `http://localhost:3200` outside production by default).

Try it after `pnpm db:seed`: serve a page containing the snippet above with the seed's Publishable Key and Pricing Table (both printed by the seed) on `http://localhost:5173`, the origin the seed key allows. The seed connects the `fake-qr` gateway, which pays by QR: send a signed fake callback for the attempt key in the QR payload.

## Tests

- `pnpm test`: unit tests (message protocol, session token, the server's routes and headers).
- `pnpm build && pnpm test:e2e`: Playwright against the real API (its own database `paybridge_e2e_checkout`, migrated and seeded; Redis from docker compose), the built app, and plain HTML host pages on `http://localhost:5173` (allowed) and `http://127.0.0.1:5174` (not allowed). Set `PLAYWRIGHT_CHANNEL=chrome` to use the installed Chrome.

## Return page

Redirect gateways send the Customer back to `/return` (`src/return/`). The checkout page builds that URL (`returnPageUrl()`) with the Payment id, the Publishable Key, the host page the Customer started from, the Pricing Table's language and the snippet's success and cancel URLs. The page reads the Payment's status from the API (never from the gateway's query parameters), asks Payment Core once to query the gateway, polls while the Payment is processing, and then forwards: the snippet's URL, else the Pricing Plan's, else the host page. Browser-supplied URLs count only on the key's allowed origins.
