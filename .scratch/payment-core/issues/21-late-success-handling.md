# 21: Late success handling

Status: resolved

**What to build:** A payment that the customer made after the attempt had already failed, expired or been cancelled is never dropped. It is promoted only when that is safe, and otherwise it goes to review with a recorded reason.

**Blocked by:** 17: Merchant cancel; 19: Process webhook

- [x] A success on a `FAILED`, `EXPIRED` or `CANCELLED` attempt is recorded on that attempt and is never dropped.
- [x] The Payment is promoted to `SUCCEEDED` only when it is `PENDING`, no attempt is already `SUCCEEDED`, and the amount matches. Then `PaymentSucceeded` is written and other non-terminal attempts are cancelled best-effort after commit.
- [x] When the Payment is `EXPIRED` or `CANCELLED`, the attempt goes to `REQUIRES_REVIEW` with reason `LATE_SUCCESS_ON_CLOSED_PAYMENT`.
- [x] When another attempt is already `SUCCEEDED`, the attempt goes to `REQUIRES_REVIEW` with reason `DUPLICATE_SUCCESS`.
- [x] When the amount differs, the attempt goes to `REQUIRES_REVIEW` with reason `AMOUNT_MISMATCH`. The Payment is not promoted.
- [x] A success on a merchant-cancelled Payment is never promoted.
- [x] Any non-terminal attempt that succeeds after a late promotion goes to `REQUIRES_REVIEW`.
- [x] Each review records the reason and the review opened time, and sets `refund_required` to true. `PaymentRequiresReview` is written when the attempt first enters review.
- [x] The full late-success matrix is covered by pure domain tests. Integration tests use seeded `EXPIRED` attempts, since expiry itself is built in tickets 23 and 24.
