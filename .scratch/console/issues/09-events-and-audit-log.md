# 09: Events and Audit log

**What to build:** A developer opens Events and sees the Payment Events Core emitted (type, Payment, created time, published time), filters by type and by published or unpublished to spot a stuck relay, and opens one to see its payload. An Operator opens the Audit log and sees every status transition (entity type, entity id, from status, to status, trigger, actor, note, time), filters by entity type, trigger and actor, and follows each row to its Payment.

See [spec](../spec.md): Events (stories 75–77), Audit log (stories 78–80); Implementation Decisions › API contract (Payment Events list and detail, Status transitions list).

**Blocked by:** 03: Payments list.

**Status:** ready-for-agent

- [ ] The fixture store includes published and unpublished Payment Events of every type, and status transitions with every trigger used by Core, including `operator_resolution` and `operator_note`.
- [ ] The mock serves the Payment Events list (`type`, `published`, cursor pagination) and detail, and the status transitions list (`entityType`, `entityId`, `trigger`, `actor`, cursor pagination).
- [ ] Both pages reuse the shared data table, URL state and status badges (Payment Event type added to the badge mapping).
- [ ] The payload view is pretty-printed JSON with copy.
- [ ] Audit rows link to the Payment, resolving a PaymentTransaction entity to its Payment.
- [ ] Loading, empty, not-found and error states.
- [ ] Screen tests: Events filters and payload, Audit log filters and links.
