# Map: Connect the Console to the real API

## Destination

The Operator Console (`apps/console`) runs against the NestJS API (`apps/api`) and a real, seeded PostgreSQL database instead of its in-process mocks. The API provides the admin read endpoints the Console already calls, and a small seed script fills a local database with data that covers every case the Console can show. Mock mode stays available for Playwright and for demos without a backend.

## Notes

- **Context**: single context. Vocabulary follows [GLOSSARY.md](../../GLOSSARY.md). No glossary term changes in this effort.
- **Related**: [Console map](../console/map.md) and [spec](../console/spec.md); [Payment Core spec](../payment-core/spec.md); [ADR 0001](../../docs/adr/0001-shared-public-schema-with-table-prefix-ownership.md), [ADR 0004](../../docs/adr/0004-console-reaches-api-only-through-its-bff.md), [ADR 0005](../../docs/adr/0005-operator-read-models-live-in-payment-core.md).
- **State today**: the API has one `/internal` route (`POST /internal/payments/:id/review-resolution`). The Console calls twelve more read routes that exist only as MSW mocks. The API has no seed. `apps/console/.env.development` sets `CONSOLE_API_MOCKS=true`.

## Decisions so far

Settled by grilling on 2026-11-25:

- **Contract**: the Console's Zod schemas (`apps/console/src/lib/api/*.ts`) are the contract. The API conforms to those shapes; the Console changes only when a field cannot be computed from the database. There is no shared contract package.
- **Contract test**: the schemas are **copied** into `apps/api/test/contract/console/` and kept in sync by hand. API responses are validated against the copies. Each copied file carries a header naming its source file, so drift is visible in review.
- **Where the code lives**: inside `payment-core`, not a new `ConsoleModule` ([ADR 0005](../../docs/adr/0005-operator-read-models-live-in-payment-core.md)). Use-cases in `application/use-cases/console/`, read models in `infrastructure/prisma/console-read/` (the only place that imports Prisma, per `architecture.spec.ts`), controllers in `http/console/`, all registered in `PaymentCoreModule`. Read use-cases open no transaction. `review-resolution` stays where it is. Future domains (for example a product catalog with an embeddable storefront widget) are separate modules with their own table prefix.
- **Routes**: all under `/internal`, outside the public `/api` prefix, no authentication (the BFF still stamps `actor`). Names follow the glossary: `/internal/callbacks` and `/internal/payment-events`. The `WebhookInbox` and `OutboxEvent` models and the public `/webhooks/:gatewayId` route are not renamed.
- **UI labels**: the primary names stay **Callbacks** and **Events**. In the Developers section, subtitles use the code names ("Webhook inbox", "Outbox") so a developer can map the page to the table.
- **Pagination and search**: opaque keyset cursor (base64 of `createdAt` and `id`), substring search with `ILIKE`, and a migration adding only the indexes the queries need.
- **Definitions the Console contract leaves open**:
  - The **latest PaymentTransaction** of a Payment is the one with the greatest `createdAt`, ties broken by `id`.
  - Overview buckets are **rolling**, counted backwards from `to`: 24 hourly buckets for `24h`, 24-hour buckets for `7d` and `30d`. They do not follow calendar days, so no time zone is involved.
  - All other definitions (volume, success rate, review state, `resolvableAt`) are the ones written in the Console's `src/lib/api/*.ts` headers.
- **Gateways**: `mode` comes from the Stripe key prefix (`sk_test_` is test, `sk_live_` is live; `fake` is always test). `registered` and `configured` come from the Gateway Manager. `callbackUrl` is built from a new `PUBLIC_BASE_URL` env variable plus `/api/webhooks/:gatewayId`. `recentErrors` returns `[]` until gateway errors are persisted; that is a follow-up, with no new table now.
- **Seed**: `prisma db seed`, writing directly to the database with a deterministic generator. Times are relative to the moment the seed runs (fixed offsets, fixed ids), so the 24-hour, 7-day and 30-day ranges and the 72-hour Review window stay meaningful. It deletes and recreates only its own rows (deterministic ids, `merchantOrderId` prefix `SEED-`), refuses to run when `NODE_ENV=production`, and requires `--force` when `DATABASE_URL` points to a host other than `localhost`, `127.0.0.1` or `postgres`. An optional `--bulk N` flag (off by default) adds many more Payments for pagination and performance checks. Only the `stripe` and `fake` gateways appear.
- **Seed contents (minimal, about 22 Payments)**:
  - `PENDING` Payments: no attempt; attempt `CREATED`; attempt `PENDING` for each NextAction type (`REDIRECT`, `QR_CODE`, `CLIENT_SDK`, `VOUCHER`).
  - `SUCCEEDED`: one on Stripe; one that switched gateway (Stripe attempt `CANCELLED` by `gateway_switch`, then a `fake` attempt `SUCCEEDED`).
  - `CANCELLED` (`merchant_cancel`); `EXPIRED` (`expiry`); an attempt `FAILED` (`gateway_rejected`) with the Payment still `PENDING`.
  - Open Reviews: `AMBIGUOUS_PROVIDER_STATUS` open more than 72 hours and one open less than 72 hours; `AMOUNT_MISMATCH` with a provider-reported amount; `LATE_SUCCESS_ON_CLOSED_PAYMENT` with refund required on an `EXPIRED` Payment; `DUPLICATE_SUCCESS` on a `SUCCEEDED` Payment.
  - Closed Reviews: resolved to `SUCCEEDED`; resolved to `FAILED`; one with an Operator note.
  - Payments spread across 30 days so every Overview range has data.
  - Six Callbacks (`PROCESSED`, `RECEIVED`, `PROCESSING`, `FAILED` with a last error, one without a provider event id, one naming an Attempt Key that matches no attempt); six Payment Events covering all five types with at least one unpublished; status transitions covering every trigger (`create_payment`, `start_attempt`, `gateway_accepted`, `gateway_rejected`, `gateway_switch`, `status_query`, `webhook`, `expiry`, `merchant_cancel`, `operator_resolution`, `operator_note`). No Refunds (Phase 1 has no write path).
- **Mocks**: kept for Playwright and demos. `CONSOLE_API_MOCKS` defaults to `false` in `.env.development`; the README explains how to switch.
- **Tests and CI**: each endpoint gets integration tests in the existing `pnpm test:int` (Postgres and Redis services, Nest booted in process) plus the contract test. CI is unchanged otherwise: no job starts the real API server. A Playwright run against the real API and a seeded database is a local-only command.

## Tickets

- [01: Seed script](issues/01-seed-script.md)
- [02: Payments list (tracer bullet)](issues/02-payments-list.md) (blocked by 01)
- [03: Payment detail for Operators](issues/03-payment-detail.md) (blocked by 02)
- [04: Reviews list and summary](issues/04-reviews.md) (blocked by 02)
- [05: Overview](issues/05-overview.md) (blocked by 02)
- [06: Gateways](issues/06-gateways.md) (blocked by 02)
- [07: Developer views: Callbacks, Payment Events and Audit log](issues/07-developer-views.md) (blocked by 02)
- [08: Switch the Console to the real API](issues/08-switch-console-to-real-api.md) (blocked by 03, 04, 05, 06, 07)

Ticket 02 also sets up the shared structure (read-model layout, cursor helper, contract-test harness, indexes). Tickets 03 to 07 are independent of each other once 02 is done.

## Follow-ups (out of scope)

- Persist gateway errors so `recentErrors` has a source.
- Product catalog and storefront widget (new module, new table prefix, public API for the embed script; extend the BFF's allowed methods when the first non-`POST` write arrives).
- Authentication.
