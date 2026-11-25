# 07: Developer views: Callbacks, Payment Events and Audit log

**What to build:** `GET /internal/callbacks[/:id]`, `GET /internal/payment-events[/:id]` and `GET /internal/status-transitions`, so the three Developers pages of the Console work on real data. Route names follow the glossary (Callback, Payment Event); the underlying models and the public `/webhooks/:gatewayId` route are not renamed. The pages keep the names Callbacks and Events, with the subtitles "Webhook inbox" and "Outbox".

**Blocked by:** 02

**Status:** resolved

- [x] Callbacks list filters by gateway and status and pages by cursor; the detail adds allow-listed headers, query, the raw body as text, delivery attempts and last error
- [x] A Callback's `paymentId` is resolved from its Attempt Key when it matches a PaymentTransaction, and is null otherwise (including the seeded Callback naming an unknown Attempt Key)
- [x] Payment Events list omits the payload and filters by type and by published or unpublished; the detail includes the payload
- [x] The audit log lists status transitions with entity type, entity id, from status, to status, trigger, actor, note and time; it filters by entity type, entity id, trigger, actor and search, and each row carries `paymentId` (a PaymentTransaction resolves to its Payment, a Payment to itself, a Refund to none)
- [x] Unknown ids return 404 with the API's standard error response; invalid filter values and cursors are rejected
- [x] The Console's Callbacks and Events pages show the subtitles "Webhook inbox" and "Outbox"
- [x] Integration tests validate every response against the copied Console schemas and, on seeded data, return every Callback status, every Payment Event type with both published and unpublished, and every status-transition trigger
- [ ] The three Console pages, with mocks turned off, show seeded data (not exercised in a browser; see Answer)

## Answer

`GET /internal/callbacks[/:id]`, `GET /internal/payment-events[/:id]` and `GET /internal/status-transitions` work on real PostgreSQL with the shapes of the Console's schemas. The last criterion (the three pages with mocks off) was not exercised in a browser; every response is parsed with the copied Console schemas in the tests, and the seeded data is asserted over HTTP.

- Code: one module, `payment-core/console/developer-views.module.ts` (imported from `console-read.module.ts` in place of the ticket 07 placeholders). Per ticket 02 layout: use-cases `application/use-cases/console/{callbacks,payment-events,status-transitions}.ts`; read repositories `infrastructure/prisma/console-read/{callbacks,payment-events,status-transitions}-read.repository.ts` (plus `developer-views.shared.ts` with `escapeLike`, `uuidNeedle`, `toStringRecord`); controllers and query schemas `http/console/{callbacks,payment-events,status-transitions}.*.ts` (plus `developer-views.vocab.ts`). Domain files (`statuses.ts`, `errors.ts`, `domain-error.mapping.ts`) are untouched, so parallel tickets do not conflict.
- Cursor: `[tag, ISO time, id]` with tags `callbacks`, `payment-events`, `status-transitions`; all three sort newest first (time, then id).
- 404: the controllers throw Nest's `NotFoundException`, so the standard error envelope applies. A malformed (non-UUID) id is also a 404. Invalid filters or cursors are 400 (`entityId` must be a UUID).
- Search `q`: Callbacks match Callback id or Attempt Key (exact UUID), Provider Event id (substring) and the Payment id or Upstream Reference of the Payment the Attempt Key resolves to. Payment Events match event id or Payment id (exact) and Upstream Reference (substring). The audit log matches entity id or Payment id (exact) and Upstream Reference (substring). `trigger` and `actor` filters are exact matches.
- Audit `paymentId`: one raw SQL query (`$queryRaw`) joins each transition to its Payment (a Payment to itself, a PaymentTransaction through its attempt, a Refund to none). The Callback detail resolves `paymentId` with a lookup of the Attempt Key.
- Migration `20261125000700_operator_developer_views_indexes`: `(created_at, id)` indexes on `core_outbox_events` and `core_status_transitions` (Callbacks reuse the existing `received_at` index). `prisma migrate diff` shows no drift.
- Contract copies: `test/contract/console/{callbacks,payment-events,status-transitions}.ts`.
- Tests: `test/payment-core/console/{callbacks,payment-events,status-transitions}.int-spec.ts` (filters, search, paging with ties and concurrent inserts, rejects, 404s, and seeded coverage of every Callback status, every Payment Event type with published and unpublished, every trigger, and the unknown-Attempt-Key Callback). Full `pnpm test:int` (396 tests) and `pnpm test` pass.
- Console: the Callbacks and Events page descriptions now start with "Webhook inbox." and "Outbox.".
