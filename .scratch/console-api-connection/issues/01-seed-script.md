# 01: Seed script

**What to build:** A database seed command that fills a local database with a small, deterministic data set (about 22 Payments) covering every case the Console can show, so a developer can run the API and see every screen with real data. The matrix is in the [spec](../spec.md) (Implementation Decisions, "Seed contents") and the [map](../map.md).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] One seed command populates Payments, PaymentTransactions, Callbacks, Payment Events and status transitions covering: every Payment status, every PaymentTransaction status, all four review reasons, all four NextAction types, every Callback status, all five Payment Event types (at least one unpublished) and every status-transition trigger
- [ ] Includes a Review open more than 72 hours and one open less than 72 hours, an `AMOUNT_MISMATCH` Review with a provider-reported amount, closed Reviews (resolved to `SUCCEEDED`, resolved to `FAILED`, one with an Operator note), a Payment that switched gateway, a Callback whose Attempt Key matches no PaymentTransaction, and a Callback with no provider event id
- [ ] Only the `stripe` and `fake` gateways appear; there are no Refunds
- [ ] Payments are spread across 30 days so the 24-hour, 7-day and 30-day Overview ranges all have data
- [ ] All timestamps are relative to the moment the seed runs, with fixed offsets and deterministic ids
- [ ] Running the seed again deletes and recreates only its own rows (deterministic ids, Upstream Reference prefix `SEED-`) and leaves other data untouched
- [ ] The seed refuses to run when `NODE_ENV` is `production`, and requires a force flag when the database host is not `localhost`, `127.0.0.1` or `postgres`
- [ ] An optional bulk flag (off by default) adds many more Payments
- [ ] The seed's observable behaviour (coverage counts, idempotent rerun, only-own-rows, both refusals) is tested
