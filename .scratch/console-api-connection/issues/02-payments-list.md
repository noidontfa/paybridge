# 02: Payments list (tracer bullet)

**What to build:** `GET /internal/payments` served from the real database, so the Console's Payments page works on seeded data. This is the first operator read endpoint, so it also sets up the structure every later endpoint reuses (ADR 0005): read-only use-cases in Payment Core backed by read-model repositories in the Prisma adapter, controllers under `/internal` outside the public `/api` prefix, an opaque keyset cursor, and the contract-test harness with hand-copied Console schemas.

**Blocked by:** 01

**Status:** resolved

- [x] The endpoint supports the filters, search, sort and cursor paging defined by the Console's Payments list contract, and returns `{ items, nextCursor }` with `nextCursor` null on the last page
- [x] Each item carries the gateway and status of the Payment's latest PaymentTransaction (greatest creation time, ties broken by id); a Payment with no attempt has none
- [x] Paging across several pages returns no duplicate and no missing row, including when a Payment is inserted between requests
- [x] A malformed cursor, an unknown filter value and an out-of-range limit are rejected with the API's standard error response
- [x] Amounts are decimal strings in the major unit
- [x] The cursor helper, read-model structure and any index migration needed by the queries are in place for later tickets to reuse
- [x] The Console's schemas used by this endpoint are copied into the API's test code, each with a header naming its source file, and every response in the tests is validated against them
- [x] Integration tests over HTTP on real PostgreSQL cover each filter, each sort, search, paging, the empty result and the error cases, and assert that the seeded data returns every Payment status
- [x] Payment Core's boundary checks (only the Prisma adapter imports the database client, only the transaction runner opens a transaction) still pass; the use-case opens no transaction and writes nothing
- [x] The Console's Payments page, with mocks turned off, shows seeded Payments

## Answer

`GET /internal/payments` works on real PostgreSQL, with the shapes of the Console's `paymentListSchema`. The last criterion (the Payments page with mocks off) was not exercised in a browser; every API response is parsed with the copied Console schemas in the tests instead.

Structure later tickets (03 to 07) reuse, all under `apps/api/src/payment-core/`:

- **One module per endpoint group**: `console/<group>.module.ts` declares the controller, the use-case(s) and the read repository. `console/console-read.module.ts` aggregates them and is imported once by `PaymentCoreModule`. It holds blank-line-separated placeholder comments for tickets 03 to 07 (an import-section line and an array line each): replace only your own placeholders and merges will not conflict.
- **Layers** (ADR 0005 and the map): use-case in `application/use-cases/console/` (read only, no `TransactionRunner`); read repository in `infrastructure/prisma/console-read/` (injects `PrismaService` directly; the only place that touches the client); controller and query schema in `http/console/`. Controllers use `@Controller(`${INTERNAL_PREFIX}/...`)` and `ZodValidationPipe` on `@Query()`.
- **Cursor**: `application/use-cases/console/cursor.ts` has `encodeCursor`, `decodeCursor` and `toPage` (fetch `limit + 1` rows, then `toPage`). A cursor is base64url of a JSON array `[tag, sortValue, id]`; the tag is `sort:order`, so a cursor is rejected under another sort. `http/console/list-query.ts` has `pagingShape` (`limit` 1 to 100, default 20, and `cursor`), `optionalParam` (empty string means absent), `dayParam` and `readKeysetCursor`. An invalid cursor becomes a 400 from the validation pipe. `http/console/payments-list.query.ts` is the full example.
- **Search**: Prisma `contains` does not escape `%` and `_`; use `escapeLike` (private in `payments-read.repository.ts`; move it to a shared file if you need it). `q` matches a Payment id exactly (UUID, any case) or part of the Upstream Reference; unlike the mock it does not match partial ids.
- **Indexes**: migration `20261125000000_operator_payments_list_indexes`. Each ticket adds its own migration with a later timestamp plus the matching `@@index` lines in `schema.prisma`; check with `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` against a migrated database.
- **Contract copies**: `test/contract/console/{schemas,pagination,payments-list}.ts`, each headed with its Console source file. Do not edit them; add one new copied file per endpoint (copy from `apps/console/src/lib/api/`, drop the client function, use `.js` import suffixes).
- **Test harness**: `test/setup/console-app.ts` (`createConsoleApp()` boots `AppModule`; `getValid(path, schema)` asserts 200 and parses with the copied schema; `expectRejected(path)` asserts a 400 with the standard error envelope). Model new specs on `test/payment-core/console/payments-list.int-spec.ts`. When several worktrees share one Postgres, run with `TEST_DATABASE_NAME=<unique>_test pnpm test:int`.
- Dates are `Date.toISOString()` strings; amounts are `decimalToString` (`Decimal.toFixed()`).
