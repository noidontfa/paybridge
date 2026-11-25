# 05: Overview

**What to build:** `GET /internal/overview?range=24h|7d|30d`, so the Console's Overview shows real figures. The definitions are in the [map](../map.md) and the Console's overview schema header.

**Blocked by:** 02

**Status:** resolved

- [x] Returns volume, Payment count, success rate (succeeded over closed Payments, null when none is closed), open Review count, volume series, counts by Payment status, per-gateway breakdown and recent Payments, for each of the three ranges
- [x] Buckets are rolling and counted back from the end of the range: 24 hourly buckets for `24h`, 24-hour buckets for `7d` and `30d`
- [x] Volume sums the Amounts of the range's succeeded Payments, as a decimal string
- [x] A Payment is attributed to the gateway of its latest PaymentTransaction, so the Payment that switched gateway is counted once under the last gateway
- [x] An invalid range is rejected with the API's standard error response; a range with no Payments returns zeros and a null success rate
- [x] Aggregates run in the database through a read-model repository, with no transaction and no writes
- [x] Integration tests validate the response against the copied Console schema and check bucket counts, success rate (including null), volume and per-gateway attribution on seeded data
- [x] The Console's Overview, with mocks turned off, shows seeded data for every range

## Answer

`GET /internal/overview?range=24h|7d|30d` works on real PostgreSQL with the shape of the Console's `overviewSchema`. The last criterion (the Overview page with mocks off) was not exercised in a browser; every response in the tests is parsed with the copied schema.

- Code: `console/overview.module.ts` (registered in `console-read.module.ts`), `http/console/overview.{controller,query}.ts`, `application/use-cases/console/get-overview.ts`, `infrastructure/prisma/console-read/overview-read.repository.ts`. No migration was needed.
- The window is `[now - span, now]` with `now` from `Clock` (the module provides `SystemClock` itself, since it cannot see `PaymentCoreModule`'s provider). Bucket `i` starts at `from + i * bucket`; a Payment created exactly at `to` goes in the last bucket.
- Aggregates: status counts and volume via Prisma `groupBy`/`aggregate`; volume series and the per-gateway breakdown via two `$queryRaw` statements (the latter uses a `LATERAL` join for the latest PaymentTransaction: greatest `createdAt`, ties by `id`). Success rate is computed in the use-case (`successRate`, null when nothing is closed).
- `openReviewCount` is the number of attempts in `REQUIRES_REVIEW`, not scoped to the range (as in the mock). `currency` is the constant `VND` (Phase 1). `recentPayments`: newest 8 in range.
- Contract copy: `test/contract/console/overview-schema.ts` (range list inlined). Tests: `test/payment-core/console/overview.int-spec.ts`.
