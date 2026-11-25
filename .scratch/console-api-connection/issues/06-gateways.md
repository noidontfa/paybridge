# 06: Gateways

**What to build:** `GET /internal/gateways` and `GET /internal/gateways/:id`, so the Console's Gateways pages show the real registered PaymentGateways and the health of their Callbacks. Adds the `PUBLIC_BASE_URL` environment variable.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] The list returns the gateways registered in this deployment with `registered`, `configured`, `mode` and `callbackUrl`
- [ ] `mode` is derived from the Stripe key prefix (`sk_test_` is test, `sk_live_` is live); the `fake` gateway is always test
- [ ] `registered` and `configured` come from the Gateway Manager, and no credential ever appears in a response
- [ ] `callbackUrl` is the new `PUBLIC_BASE_URL` plus the gateway's public webhook path; the variable is validated in the environment schema and documented in the example env files
- [ ] The detail adds Callback counts by status for the last 24 hours (every status present), the last Callback time, and `recentErrors` as an empty list until gateway errors are persisted
- [ ] An unknown gateway id returns 404 `GATEWAY_NOT_FOUND`
- [ ] Integration tests validate responses against the copied Console schemas and cover both seeded gateways
- [ ] The Console's Gateways pages, with mocks turned off, show the real gateways
