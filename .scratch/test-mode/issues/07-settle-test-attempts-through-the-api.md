# 07: Settle Test Gateway attempts through the API

**What to build:** An Organization's automated tests choose a Test Gateway outcome with a Test API Key, without a browser. See the [spec](../spec.md) (Test Gateway).

**Blocked by:** 02, 06

**Status:** ready-for-agent

- [ ] An endpoint that sets the outcome of a Test Gateway PaymentTransaction (by Attempt Key), with the same outcomes and effects as the simulator page.
- [ ] Accepted only with a Test API Key; Live keys, Publishable Keys and attempts on other PaymentGateways are refused.
- [ ] Documented in the public API docs (Swagger).
- [ ] Integration tests: each outcome through the API produces the same Payment status, Review and Webhook as through the page.
