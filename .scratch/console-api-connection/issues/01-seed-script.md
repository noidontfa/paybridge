# 01: Seed script

**What to build:** A database seed command that fills a local database with a small, deterministic data set (about 22 Payments) covering every case the Console can show, so a developer can run the API and see every screen with real data. The matrix is in the [spec](../spec.md) (Implementation Decisions, "Seed contents") and the [map](../map.md).

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] One seed command populates Payments, PaymentTransactions, Callbacks, Payment Events and status transitions covering: every Payment status, every PaymentTransaction status, all four review reasons, all four NextAction types, every Callback status, all five Payment Event types (at least one unpublished) and every status-transition trigger
- [x] Includes a Review open more than 72 hours and one open less than 72 hours, an `AMOUNT_MISMATCH` Review with a provider-reported amount, closed Reviews (resolved to `SUCCEEDED`, resolved to `FAILED`, one with an Operator note), a Payment that switched gateway, a Callback whose Attempt Key matches no PaymentTransaction, and a Callback with no provider event id
- [x] Only the `stripe` and `fake` gateways appear; there are no Refunds
- [x] Payments are spread across 30 days so the 24-hour, 7-day and 30-day Overview ranges all have data
- [x] All timestamps are relative to the moment the seed runs, with fixed offsets and deterministic ids
- [x] Running the seed again deletes and recreates only its own rows (deterministic ids, Upstream Reference prefix `SEED-`) and leaves other data untouched
- [x] The seed refuses to run when `NODE_ENV` is `production`, and requires a force flag when the database host is not `localhost`, `127.0.0.1` or `postgres`
- [x] An optional bulk flag (off by default) adds many more Payments
- [x] The seed's observable behaviour (coverage counts, idempotent rerun, only-own-rows, both refusals) is tested

## Answer

Run `pnpm db:seed` (root or `apps/api`; `prisma db seed` runs `tsx seed/main.ts`). Flags: `--bulk N` adds N extra Payments (`SEED-BULK-nnnnnn`), `--force` allows a non-local host. It reads the same env files as the app.

- Code: `apps/api/seed/` (`seed.ts` = `runSeed`, `scenarios.ts` = the 22 Payments, 6 Callbacks and 6 Payment Events as data, `main.ts` = CLI). It lives outside `src/` on purpose: it is a dev tool, is not built into `dist`, and may use the database client and open its own transaction (the Core boundary spec scans `src/`).
- Test: `apps/api/test/seed/seed.int-spec.ts` (in `pnpm test:int`). No operator endpoints exist yet, so the seam is the seed command (in-process `runSeed` plus the CLI) and its observable result in the database; later tickets re-assert coverage over HTTP.
- Ids are UUID v5 of fixed names; rows are recognised by `SEED-` on the Upstream Reference and the Callback dedupe key. A re-run deletes those rows (and their transitions and Payment Events) in one transaction and recreates them.
- The AMOUNT_MISMATCH provider-reported amount is stored as `providerMetadata.providerReportedAmount` on the attempt (Core persists no such value yet); ticket 03 should read it from there or change the seed together with Core.
- Added devDependency `tsx` and `esbuild: false` in `pnpm-workspace.yaml` allowBuilds.
