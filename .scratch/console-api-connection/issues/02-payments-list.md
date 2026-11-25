# 02: Payments list (tracer bullet)

**What to build:** `GET /internal/payments` served from the real database, so the Console's Payments page works on seeded data. This is the first operator read endpoint, so it also sets up the structure every later endpoint reuses (ADR 0005): read-only use-cases in Payment Core backed by read-model repositories in the Prisma adapter, controllers under `/internal` outside the public `/api` prefix, an opaque keyset cursor, and the contract-test harness with hand-copied Console schemas.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] The endpoint supports the filters, search, sort and cursor paging defined by the Console's Payments list contract, and returns `{ items, nextCursor }` with `nextCursor` null on the last page
- [ ] Each item carries the gateway and status of the Payment's latest PaymentTransaction (greatest creation time, ties broken by id); a Payment with no attempt has none
- [ ] Paging across several pages returns no duplicate and no missing row, including when a Payment is inserted between requests
- [ ] A malformed cursor, an unknown filter value and an out-of-range limit are rejected with the API's standard error response
- [ ] Amounts are decimal strings in the major unit
- [ ] The cursor helper, read-model structure and any index migration needed by the queries are in place for later tickets to reuse
- [ ] The Console's schemas used by this endpoint are copied into the API's test code, each with a header naming its source file, and every response in the tests is validated against them
- [ ] Integration tests over HTTP on real PostgreSQL cover each filter, each sort, search, paging, the empty result and the error cases, and assert that the seeded data returns every Payment status
- [ ] Payment Core's boundary checks (only the Prisma adapter imports the database client, only the transaction runner opens a transaction) still pass; the use-case opens no transaction and writes nothing
- [ ] The Console's Payments page, with mocks turned off, shows seeded Payments
