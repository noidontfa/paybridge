# 06: Stripe contract suite registration

Status: ready-for-agent

**What to build:** The Stripe plugin passes the shared `PaymentGateway` contract suite against recorded Stripe test-mode responses, with no live Stripe calls in CI. See [spec](../spec.md), "Testing Decisions".

**Blocked by:** 04, 05

- [ ] Fixtures recorded from Stripe test mode live in `apps/api/src/gateways/stripe/fixtures/`, with secrets and client secrets scrubbed. A short README there says how they were recorded.
- [ ] `apps/api/src/gateways/stripe/stripe-gateway.contract.spec.ts` registers the plugin with `describeGatewayContract`, modelled on `fake-gateway.contract.spec.ts`.
- [ ] Outcomes cover `PENDING` (requires_payment_method, and a decline), `SUCCEEDED`, `FAILED` (canceled) and `REQUIRES_REVIEW` (requires_capture), for both `query` and callbacks.
- [ ] Errors cover `GatewayRejected`, `GatewayUnavailable`, `OutcomeUnknown` and `NotFound`.
- [ ] Invalid callbacks cover a wrong secret, a missing `Stripe-Signature` header, and a stale timestamp.
- [ ] Ignored callbacks cover an unhandled event type and a PaymentIntent with no attempt key.
- [ ] The suite runs in the normal `pnpm test` with no network access.
