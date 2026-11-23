Labels: wayfinder:map

# Map: Payment Core (Phase 1)

## Destination

A complete, English design spec for Phase 1 Payment Core, written to `.scratch/payment-core/spec.md`, plus the root `GLOSSARY.md` and any `docs/adr/` records the decisions require. It covers: the domain model and invariants of `Payment` and `PaymentTransaction`; their state machines; the `PaymentGateway` port that Core owns; the PostgreSQL schema (Prisma) on the shared `public` schema with a table-ownership convention; the async reliability boundary (Idempotency, Transactional Outbox, Webhook Inbox on BullMQ over Redis); and the `PaymentService` and `Repository` boundaries. No application code is written on this map.

## Notes

- **Domain**: PayBridge, a Single-Merchant Payment Hub. Multi-Merchant Platform is a future effort, not this one.
- **Context**: single context. Glossary at `GLOSSARY.md` (root). ADRs go in `docs/adr/`, created lazily.
- **Language**: every artifact saved in the repo is written in English. Discussion in chat is in Vietnamese.
- **Stack**: NestJS 12, Prisma 7, PostgreSQL 18, Redis 7. Queue is **BullMQ on Redis, mandatory**.
- **Database**: one shared PostgreSQL `public` schema. Ownership is expressed by a table-ownership convention (how it is expressed is decided in ticket 02).
- **Dependency rule**: Payment Core never depends on VNPay, ZaloPay or Stripe. Gateway plugins depend on the `PaymentGateway` port that Core defines. Core never imports a plugin.
- **Skills**: `grilling` and `domain-modeling` for grilling tickets; `research` for research tickets.
- **Settled at charting** (recorded here, no ticket): Phase 1 includes the Refund data hook but not the RefundService flow; Admin UI, Reconciliation/Settlement, Double-entry Ledger and Subscription/Tokenization are out of scope; Multi-Merchant is the next step after this effort.

## Decisions so far

<!-- one line per closed ticket: gist plus link -->

- [Research: gateway divergences from VNPay, ZaloPay and Stripe](issues/01-research-gateway-divergences.md): the providers disagree on initiation shape, reference timing, VND scaling, failure visibility, authoritative channel and refund idempotency; the port needs a `NextAction` union and Core needs its own `attemptId` separate from `providerRef`. Full sources in [research/gateway-divergences.md](research/gateway-divergences.md).
- [Table ownership convention on the shared public schema](issues/02-table-ownership-convention.md): ownership is a `core_` table prefix set with `@@map`, checked by a Vitest spec over `schema.prisma`; Core alone owns and writes `core_*` tables, plugins own none and hand raw payloads to Core through the port's extension field; recorded as [ADR 0001](../../docs/adr/0001-shared-public-schema-with-table-prefix-ownership.md).
- [Domain model and invariants for Payment and PaymentTransaction](issues/03-domain-model-invariants.md): `Payment` is the aggregate root, and `PaymentTransaction` is keyed by a UUID v7 `attemptKey` that the plugin formats per gateway. `Amount` is a decimal VND amount (whole dong) on `Payment` only. `merchantOrderId` is globally unique and immutable. At most one in-flight and one succeeded transaction per `Payment`. A `Refund` attaches to `PaymentTransaction`. Eleven testable invariants are listed. No `merchantId` column in Phase 1.

- [Payment and PaymentTransaction state machines](issues/04-payment-state-machine.md): `Payment` is `PENDING` until `SUCCEEDED`, `CANCELLED` or `EXPIRED`, with no `FAILED` state. Every Payment has a required `expiresAt` (default 30 minutes, range 30 minutes to 24 hours) that is sent to the provider and enforced by Core. A late success is promoted only while the Payment is still `PENDING`; otherwise it goes to `REQUIRES_REVIEW`, which blocks new attempts and has no refund flow in Phase 1.
- [PaymentGateway port (Core-owned contract)](issues/05-gateway-plugin-contract.md): four operations (`initiate`, `query`, `cancel`, `parseCallback`), with no refund operations in Phase 1. `initiate` returns a `NextAction` union of four variants, and `providerMetadata` is kept separate from `rawPayload`. Plugins report four normalized states, and Core decides `EXPIRED` and `CANCELLED`. Five error categories. Gateway Plugins are registered explicitly and enforced by a CI lint rule.
- [Async reliability boundary: Idempotency, Transactional Outbox, Webhook Inbox, BullMQ](issues/06-async-reliability-boundary.md): PostgreSQL is the source of truth and BullMQ is a derived dispatch queue ([ADR 0002](../../docs/adr/0002-postgresql-source-of-truth-bullmq-dispatch.md)). Idempotency-Key on `POST /payments` (24 hours). The Outbox holds Payment-level events only. Webhooks are verified before storage and deduplicated on `(gatewayId, dedupeKey)`. The expiry sweep runs every minute on PostgreSQL, so a Payment closes up to about one minute late.
- [PostgreSQL schema](issues/07-postgres-schema.md): eight `core_*` tables, including `core_status_transitions` as an append-only audit trail. Money is `numeric(19,4)`, IDs are UUID v7, and the database is PostgreSQL 18. Partial unique indexes enforce at most one open (`CREATED`/`PENDING`) attempt and at most one `SUCCEEDED` attempt per Payment; `REQUIRES_REVIEW` is checked by the service. `RefundStatus` has five values. A `REQUIRES_REVIEW` attempt is classified by `review_reason` and goes to operators after 72 hours. Migration is one initial migration, then forward-only.
- [PaymentService and Repository boundaries](issues/08-payment-service-repository.md): `PaymentService` exposes API use cases (`createPayment`, `startAttempt` including gateway switch, `getPayment`, `cancelPayment`, `handleBrowserReturn`, `resolveReview`), and worker handlers stay outside it. Concurrency is a `FOR UPDATE` lock on `core_payments` with no version column. A `TransactionRunner` is the only place that opens transactions, and no transaction is held across a gateway call. One `PaymentRepository` aggregate plus one repository per Core table, with no `RefundRepository` in Phase 1.

## Not yet specified

<!-- in-scope fog; graduates to a ticket once the question is sharp -->

- **Provider behaviours the research could not verify**: whether VNPay sends a late `00` IPN after `vnp_ExpireDate`; whether ZaloPay allows multiple sequential partial refunds on one `zp_trans_id`; how ZaloPay `/v2/refund` responds to a repeated `m_refund_id`; the ZaloPay callback retry interval. Hangs on vendor confirmation or sandbox testing, not on another ticket.
## Out of scope

<!-- ruled out of this effort; never graduates -->

- **Multi-Merchant Platform** (per-merchant tenancy and gateway credentials): future effort, after Payment Core.
- **Admin UI**: the user chose to focus on the API Server.
- **Reconciliation and settlement**: needs its own domain model.
- **Double-entry ledger**: accounting concern, separate effort.
- **Tokenization and subscriptions** (saved cards, recurring billing).
- **Concrete plugin implementations** (VNPay, ZaloPay, Stripe, and later MoMo, PayPal, PayOS): later phases, after the port is fixed.
- **RefundService orchestration flow**: later phase. Only the data hook is in scope.
- **Queue worker implementation**: the boundary is in scope (ticket 06), the consumer code is not.
- **Refund for money collected on a `REQUIRES_REVIEW` attempt** (for example, a late success on a closed Payment): belongs to the RefundService flow, which is out of scope. The state machine only records `REQUIRES_REVIEW` ([state machines](issues/04-payment-state-machine.md)).
