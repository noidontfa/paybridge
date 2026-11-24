# 19: Process webhook

Status: resolved

**What to build:** A stored webhook is applied to its attempt and Payment. A matching success makes the Payment `SUCCEEDED`. A clear failure fails the attempt only. A success with a different amount, or an ambiguous status, goes to review and blocks new attempts.

**Blocked by:** 15: Start attempt; 18: Verified webhook intake

- [x] Processing locks the Payment row first, then applies the transition, writes the status transitions, writes outbox rows when the Payment status changes, and marks the inbox row `PROCESSED`, all in one transaction.
- [x] A success with an amount equal to the Payment amount moves the attempt to `SUCCEEDED` and the Payment to `SUCCEEDED`, and writes `PaymentSucceeded`.
- [x] Other open attempts on that Payment are cancelled best-effort after commit.
- [x] A clear failure moves the attempt to `FAILED`. The Payment stays `PENDING`.
- [x] A callback for an attempt still in `CREATED` is accepted.
- [x] A success with a different amount moves the attempt to `REQUIRES_REVIEW` with reason `AMOUNT_MISMATCH`, sets the review opened time and sets `refund_required` to true. The Payment is not promoted. `PaymentRequiresReview` is written.
- [x] An ambiguous non-binary result moves the attempt to `REQUIRES_REVIEW` with reason `AMBIGUOUS_PROVIDER_STATUS`, with the same flags and event.
- [x] A Payment with an attempt in `REQUIRES_REVIEW` rejects new attempts (checked under the Payment lock).
- [x] Repeating a transition to the state the entity is already in does nothing.
