# 06: Test Gateway and its simulator page

**What to build:** PayBridge's own Test Gateway, connected for every Organization in Test Mode, whose payments end on a PayBridge page where the tester chooses the outcome, which then arrives as a real signed Callback. See the [spec](../spec.md) (Test Gateway) and [ADR 0012](../../../docs/adr/0012-gateway-connections-per-mode-and-a-built-in-test-gateway.md).

**Blocked by:** 05

**Status:** ready-for-agent

- [ ] A Test Gateway plugin (gateway id `test`), separate from the scripted fake plugin, supporting Test Mode only and registered in every environment including production.
- [ ] Every new Organization gets an enabled Test Gateway Connection with a PayBridge-generated secret; a migration creates one for every existing Organization. It can be disabled like any Gateway Connection.
- [ ] `initiate` returns a redirect NextAction to a simulator page in `apps/checkout` showing the Amount and buttons: paid, declined, left pending, paid a different Amount, paid late.
- [ ] Choosing an outcome records it and makes PayBridge send a signed Callback to that Gateway Connection's callback URL through the normal intake; "paid late" after the attempt closed produces a Late Success, and "paid a different Amount" an amount-mismatch Review.
- [ ] `query` answers from the recorded outcome; Refunds through the Test Gateway succeed.
- [ ] A contract test like the Stripe and fake plugins, and an integration test from Payment creation through the simulator to a Webhook.
