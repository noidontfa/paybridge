# Stripe is integrated through PaymentIntents and Stripe.js, not Checkout Sessions

The Stripe Gateway Plugin creates a PaymentIntent and returns its `client_secret` as a `CLIENT_SDK` next action, so the merchant's frontend renders the Stripe Payment Element and confirms the payment itself. We chose this because the merchant wants to own the payment UI. The cost is that the merchant frontend must embed Stripe.js, and that a PaymentIntent never expires on its own, so Payment Expiry depends entirely on Core cancelling the PaymentIntent through the plugin's `cancel`.

## Considered Options

- **Hosted Checkout Session** (rejected): no frontend work, and its `expires_at` range (30 minutes to 24 hours) matches the Payment Expiry range exactly, so the deadline would be enforced by Stripe as well as by Core. We rejected it because the customer leaves the merchant's UI for a Stripe-hosted page. A future reader should not "simplify" to Checkout without revisiting this.

## Consequences

- The `CLIENT_SDK` next action gains an optional, provider-neutral `clientParams` bag, used by Stripe to hand the browser its publishable key and the return URL for 3-D Secure.
- The Provider Reference is the PaymentIntent id (`pi_…`), which exists at creation and is the id refunds will target later.
- A Stripe decline does not end the attempt: the PaymentIntent returns to `requires_payment_method` and the customer retries on it, so the plugin reports `PENDING`.
