# 09: Events and Audit log

**What to build:** A developer opens Events and sees the Payment Events Core emitted (type, Payment, created time, published time), filters by type and by published or unpublished to spot a stuck relay, and opens one to see its payload. An Operator opens the Audit log and sees every status transition (entity type, entity id, from status, to status, trigger, actor, note, time), filters by entity type, trigger and actor, and follows each row to its Payment.

See [spec](../spec.md): Events (stories 75–77), Audit log (stories 78–80); Implementation Decisions › API contract (Payment Events list and detail, Status transitions list).

**Blocked by:** 03: Payments list.

**Status:** resolved

- [x] The fixture store includes published and unpublished Payment Events of every type, and status transitions with every trigger used by Core, including `operator_resolution` and `operator_note`.
- [x] The mock serves the Payment Events list (`type`, `published`, cursor pagination) and detail, and the status transitions list (`entityType`, `entityId`, `trigger`, `actor`, cursor pagination).
- [x] Both pages reuse the shared data table, URL state and status badges (Payment Event type added to the badge mapping).
- [x] The payload view is pretty-printed JSON with copy.
- [x] Audit rows link to the Payment, resolving a PaymentTransaction entity to its Payment.
- [x] Loading, empty, not-found and error states.
- [x] Screen tests: Events filters and payload, Audit log filters and links.

## Answer

`/events` is the Payment Events list, `/events/[id]` one event, and `/audit-log` the status-transition trail. Tests: seed coverage, a handler test for the three mocked endpoints (`src/mocks/events-audit.test.ts`), screen tests for Events, Event detail and the Audit log, a badge-mapping test, and Playwright `e2e/events-audit.spec.ts` (unpublished filter and payload, operator-resolution filter and link to the Payment, event not found).

Decisions to know about:

- **Endpoints** (all newest first, `{ items, nextCursor }`, 400 `VALIDATION_FAILED` for a bad value): `GET /internal/payment-events` (`type`, `published=true|false`, `cursor`, `limit`; the list **omits the payload**), `GET /internal/payment-events/:id` (adds `payload`; 404 `PAYMENT_EVENT_NOT_FOUND`), `GET /internal/status-transitions` (`entityType`, `entityId`, `trigger`, `actor`, `cursor`, `limit`). Schemas and client functions are in `src/lib/api/payment-events.ts` and `status-transitions.ts`; mocks in `src/mocks/events-audit.ts`.
- **Audit rows carry `paymentId`** (server-resolved): the Payment's own id for a PAYMENT row, the attempt's Payment for a PAYMENT_TRANSACTION row, `null` for REFUND. The backend endpoint must return it too. A row with a `paymentId` opens the Payment on click; a REFUND row opens nothing. The shared `DataTable.getRowHref` now may return `null`.
- **Badge mapping**: new kind `event` in `src/lib/status-badges.ts` (label such as "Payment succeeded", toned like the status it announces). Audit from and to statuses use the `payment` kind for PAYMENT rows and `transaction` otherwise.
- **Filters**: native selects. Trigger options are Core's eleven triggers and Actor options are `system`, `merchant`, `operator` (constants in `src/lib/queries/audit-log.ts`; update when Core adds one or when Operator identities exist). No sort in the URL: both lists are always newest first (`sortable: []`).
- **Seed additions**: unpublished Payment Events of every type (a few old events are "stuck"), a gateway switch (`gateway_switch`), Operator notes on late-success and duplicate-success Reviews (`operator_note`, from and to both `REQUIRES_REVIEW`), and two resolved Reviews (`operator_resolution`, actor `operator`, with a note; the Payment closes with the same cause when it succeeds). A resolved attempt has no `reviewReason`. The seed's random stream changed, so seeded ids differ from before.
- **Payload view**: pretty-printed JSON (`JSON.stringify(payload, null, 2)`) in a scrollable `pre` with the shared `CopyButton`.
- Playwright runs flaky when parallel workers all compile `next dev` for the first time (unrelated tests failed once); all 18 pass with `--workers=1`.
