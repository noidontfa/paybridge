# 29: Operator review resolution

Status: resolved

**What to build:** An operator can settle a review that has been open for 72 hours, with a mandatory note and an audit record. The rules stop the operator from creating an invalid state. Two review reasons can only receive notes. The endpoint is internal and is not exposed publicly. Phase 1 has no authentication, so its restriction is set by deployment, not by code.

**Blocked by:** 21: Late success handling; 28: Automatic review re-query

- [x] `POST /internal/payments/:id/review-resolution` resolves a review on a specific attempt that has been open for at least 72 hours.
- [x] A note is required. A request without one is rejected.
- [x] Setting `SUCCEEDED` is allowed only when the amount equals the Payment amount and the Payment is `PENDING`.
- [x] For `AMOUNT_MISMATCH`, only `FAILED` can be set.
- [x] Setting `FAILED` is always allowed (subject to the 72-hour rule).
- [x] Each resolution writes a status transition with the actor and note. The Payment outbox row is written if the Payment status changed.
- [x] For `LATE_SUCCESS_ON_CLOSED_PAYMENT` and `DUPLICATE_SUCCESS`, the operator can add a note without changing the status. The note is recorded with the actor.
- [x] The actor is taken from a required caller field. This is trusted only because the route is internal (see the decision in the spec). Authentication remains out of scope.
- [x] The route is not exposed on any public route. A test checks the route is registered only under the internal prefix.
