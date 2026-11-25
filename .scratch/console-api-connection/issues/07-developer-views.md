# 07: Developer views: Callbacks, Payment Events and Audit log

**What to build:** `GET /internal/callbacks[/:id]`, `GET /internal/payment-events[/:id]` and `GET /internal/status-transitions`, so the three Developers pages of the Console work on real data. Route names follow the glossary (Callback, Payment Event); the underlying models and the public `/webhooks/:gatewayId` route are not renamed. The pages keep the names Callbacks and Events, with the subtitles "Webhook inbox" and "Outbox".

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Callbacks list filters by gateway and status and pages by cursor; the detail adds allow-listed headers, query, the raw body as text, delivery attempts and last error
- [ ] A Callback's `paymentId` is resolved from its Attempt Key when it matches a PaymentTransaction, and is null otherwise (including the seeded Callback naming an unknown Attempt Key)
- [ ] Payment Events list omits the payload and filters by type and by published or unpublished; the detail includes the payload
- [ ] The audit log lists status transitions with entity type, entity id, from status, to status, trigger, actor, note and time; it filters by entity type, entity id, trigger, actor and search, and each row carries `paymentId` (a PaymentTransaction resolves to its Payment, a Payment to itself, a Refund to none)
- [ ] Unknown ids return 404 with the API's standard error response; invalid filter values and cursors are rejected
- [ ] The Console's Callbacks and Events pages show the subtitles "Webhook inbox" and "Outbox"
- [ ] Integration tests validate every response against the copied Console schemas and, on seeded data, return every Callback status, every Payment Event type with both published and unpublished, and every status-transition trigger
- [ ] The three Console pages, with mocks turned off, show seeded data
