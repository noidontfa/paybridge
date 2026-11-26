# 02: Webhook retries

**What to build:** A delivery that does not succeed is retried with growing delays for about three days, then marked as failed. An outage on the Organization's side, or a PayBridge restart, never loses a Payment Event. PostgreSQL is the source of truth for deliveries; BullMQ only dispatches them (ADR 0002). See the [spec](../spec.md) (Webhook Endpoint and delivery).

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] A failed attempt (a non-2xx answer, a timeout, a network error or a refused address) schedules the next attempt with exponential backoff and jitter. The schedule spans about three days.
- [ ] After the last attempt fails, the delivery is marked failed and is not retried automatically.
- [ ] A success at any attempt marks the delivery succeeded and stops retries.
- [ ] A sweep re-enqueues deliveries that are due but missing from Redis, following the webhook inbox sweep pattern.
- [ ] Several API instances never send the same attempt twice at once.
- [ ] Delivery records are pruned after the configured retention period, following the existing retention sweep.
- [ ] The backoff schedule is a pure function with unit tests.
- [ ] Integration tests use the local receiver and `FakeClock`. They assert:
  - a receiver answering 500 and then 200 gets the delivery on the retry;
  - a timeout is retried;
  - a delivery is failed after the last attempt;
  - deliveries survive a simulated Redis outage (TCP proxy, as in the outbox relay test).
