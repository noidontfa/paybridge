# 17: Merchant cancel

Status: resolved

**What to build:** A merchant withdraws an order by cancelling its Payment. The customer can no longer continue paying, and the merchant's decision is kept even if the customer pays late. The endpoint path (proposed: `POST /payments/:id/cancel`) is fixed at implementation.

**Blocked by:** 16: Gateway switch

- [x] A `PENDING` Payment and all its open attempts move to `CANCELLED` in one transaction, which also writes the `PaymentCancelled` outbox row and the status transitions.
- [x] The provider cancel for each open attempt runs after commit, only for plugins that declare `supportsCancel`. Failures are logged and do not change local state.
- [x] Cancelling an already `CANCELLED` Payment is a no-op and returns success.
- [x] Cancelling a `SUCCEEDED` or `EXPIRED` Payment is rejected with a conflict response.
- [x] A later success on a cancelled attempt is not promoted; it goes to review (ticket 21).
