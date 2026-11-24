# 09: Schema foundation

Status: resolved

**What to build:** The Payment Core PostgreSQL schema can be created from an empty database. It contains all eight `core_*` tables with the columns decided in the spec, the single initial migration (including the raw partial indexes), and the schema test that guards ownership and indexes. This is the base every later ticket writes to.

**Blocked by:** None (can start immediately)

- [x] Eight `core_*` tables exist: payments, payment transactions, refunds, gateway raw responses, idempotency keys, outbox events, webhook inbox, status transitions.
- [x] Column conventions hold: UUID ids, millisecond `timestamptz`, snake_case columns, foreign keys `ON DELETE RESTRICT`, native enums, text gateway identifier.
- [x] Partial unique indexes exist: at most one open attempt per Payment (`CREATED` or `PENDING`), at most one `SUCCEEDED` attempt per Payment.
- [x] Unique constraints exist: provider reference per gateway (pair with gateway identifier), upstream reference across PayBridge, webhook inbox on gateway identifier plus dedupe key.
- [x] The expiry index on status and expiry time exists, partial on `PENDING`.
- [x] Amount columns are `numeric(19,4)` with a check that the amount is greater than zero (payments and refunds).
- [x] The refund status enum has `PENDING`, `SUCCEEDED`, `FAILED`, `REQUIRES_ACTION`, `CANCELLED` (not `CANCELED`).
- [x] The schema test fails when any model lacks a `core_` table mapping, and fails when any listed partial index is missing.
- [x] The migration applies cleanly to an empty PostgreSQL 18 database.
- [x] The refund table exists with no write path in code.
