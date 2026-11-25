# 02: Payment detail through the BFF and mock mode

**What to build:** The first data path, end to end. An Operator opens a Payment by id and sees its full story: the summary (Amount in VND, status, Upstream Reference, Payment Expiry, times), every PaymentTransaction as a timeline oldest first (PaymentGateway, status, Attempt Key, Provider Reference, NextAction type, review reason and how long the Review has been open, refund required), each PaymentTransaction's status history from the audit trail (from, to, trigger, actor, note, time), and the Payment Events emitted for the Payment. The data comes from the browser through the Console's own path-preserving BFF to the API, which in mock mode is served by MSW in Node over a seeded fixture store. A banner shows when mock mode is on.

See [spec](../spec.md): Payment detail (stories 37–41, 43–45), Platform and quality; Implementation Decisions › Data path, API contract (operator Payment detail), Mock mode, Modules (API client, Formatting, Status badges); [ADR 0004](../../../docs/adr/0004-console-reaches-api-only-through-its-bff.md).

**Blocked by:** 01: Console skeleton.

**Status:** ready-for-agent

- [ ] The BFF forwards a request to the API base URL with the same path, method, query and body; the browser never calls the API directly and no CORS is needed.
- [ ] Mock mode is switched on by a server environment flag, is off by default and refuses to start in a production build; a visible banner shows when it is on.
- [ ] The fixture store is seeded deterministically (fixed seed and fixed "now") with several hundred Payments covering every Payment status, PaymentTransaction status and review reason, gateway switches and late successes, using only the `stripe` and `fake` gateways, with matching status transitions and Payment Events.
- [ ] The mock serves the operator Payment detail endpoint defined in the spec (the `GET /payments/:id` shape plus Provider Reference, status transitions per PaymentTransaction, and the Payment's Payment Events), and returns the API's error response shape for an unknown id.
- [ ] Response types are copied into the Console as Zod schemas using the API's current wire names; the API client parses every response and turns failures into one typed error with the API's code and message.
- [ ] Amounts are formatted as VND with `vi-VN` grouping from the decimal string, never via floating point; times show local absolute time and a relative hint.
- [ ] One status badge mapping covers Payment status, PaymentTransaction status and review reason, with consistent label, tone and icon.
- [ ] Payment id, Upstream Reference and Attempt Key can be copied with one click.
- [ ] The page shows skeletons while loading, a not-found state for an unknown id, and an error state with retry; there is no cancel action.
- [ ] Screen tests render the page with a real QueryClient and the shared MSW handlers (mapped to the BFF prefix): a Payment with a gateway switch, a PaymentTransaction in Review, not-found, and an API error.
- [ ] Unit tests cover VND and date formatting, the badge mapping and the Zod schemas against sample responses.
