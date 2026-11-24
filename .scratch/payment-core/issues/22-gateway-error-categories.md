# 22: Gateway error categories

Status: resolved

**What to build:** Every gateway error category has one defined effect on the attempt. A provider outage or a timeout after the request was sent never fails a payment by mistake.

**Blocked by:** 20: Browser return and status query

- [x] `GatewayUnavailable` on initiate leaves the attempt state unchanged and schedules a retry, bounded in number of attempts.
- [x] `OutcomeUnknown` on initiate leaves the attempt as it is and schedules a status query for it. It is not treated as a failure.
- [x] `GatewayRejected` on initiate moves the attempt to `FAILED` (behaviour from ticket 15, verified here).
- [x] On a query, `GatewayUnavailable` and `OutcomeUnknown` leave the attempt unchanged and are retried.
- [x] On a query, `NotFound` leaves the attempt unchanged and is logged. It is not treated as unpaid by default. Ticket 24 decides its effect on expiry.
- [x] On cancel, errors are logged and not retried in Phase 1, because cancel is best-effort.
- [x] Retry decisions use the retryable flag from the error, not the provider name.
