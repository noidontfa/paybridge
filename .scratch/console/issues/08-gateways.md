# 08: Gateways list and detail

**What to build:** An Operator opens Gateways and sees the PaymentGateways the API reports for this deployment, each with registered and configured state, test or live mode, and its Callback URL with copy. The detail page shows Callback counts by status in the last 24 hours, the time of the last Callback, and recent gateway error counts by error category, with links to that gateway's Payments and Callbacks already filtered. Everything is read-only: there is no way to enter credentials or enable or disable a gateway.

See [spec](../spec.md): Gateways (stories 63–69); Implementation Decisions › API contract (Gateways list and detail).

**Blocked by:** 03: Payments list; 07: Callbacks list and detail.

**Status:** ready-for-agent

- [ ] The mock serves the Gateways list and detail for `stripe` and `fake` only, with values derived from the fixture store's Callbacks and PaymentTransactions.
- [ ] Mode, registration and Callback URL come from the API response, never from Console configuration.
- [ ] Live mode is visually distinct from test mode.
- [ ] Links open the Payments list and the Callbacks list with the gateway filter set in the URL.
- [ ] Loading, empty, not-found and error states.
- [ ] Screen tests: list, detail health figures, links carry the right filter, unknown gateway id.
