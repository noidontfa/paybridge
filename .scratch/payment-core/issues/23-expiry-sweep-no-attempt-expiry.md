# 23: Expiry sweep and expiry of Payments with no attempt

Status: resolved

**What to build:** Every minute, a sweep finds `PENDING` Payments whose deadline has passed and queues each one. A Payment that has no attempt expires at its deadline with no provider call. Payments that have attempts are handled in ticket 24.

**Blocked by:** 12: Create Payment

- [x] A repeatable schedule is registered once at boot, so running several instances produces one schedule.
- [x] The sweep selects `PENDING` Payments with a passed deadline, using the partial expiry index, and respects the batch size limit.
- [x] Each queued job uses the Payment id as its job id. Queuing the same Payment twice produces one job.
- [x] A `PENDING` Payment with no attempt moves to `EXPIRED` at its deadline, with `PaymentExpired` and the status transition written in one transaction. No provider query is made.
- [x] A Payment with open attempts is passed to ticket 24's worker and is not closed here.
- [x] A test with a fake clock shows the Payment closes within about one minute after its deadline.
- [x] When Redis is unavailable, the sweep changes no state, and the next run picks up the same Payments.
