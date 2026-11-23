Labels: wayfinder:grilling
Type: grilling
Status: resolved
Blocked by: 02, 04

# Async reliability boundary: Idempotency, Transactional Outbox, Webhook Inbox, BullMQ

## Question

Design the reliability layer. BullMQ on Redis is mandatory for queues. Decide:

1. **Idempotency**: the scope of an idempotency key (per client request, per `Payment`, or per `PaymentTransaction`), where the key comes from, how long it is stored, and what a repeated request returns.
2. **Transactional Outbox**: which domain events are written to it, which component relays them to BullMQ, and what happens if the relay fails.
3. **Webhook Inbox**: what is persisted before any processing (raw payload, headers), when signature verification happens, the deduplication key, and the processing states.
4. **Failure ownership**: when Redis and PostgreSQL disagree, which one is the source of truth, and how a job is recovered.
5. How all of the above fits the table-ownership convention from ticket 02.

Consider whether an ADR is warranted for the BullMQ-plus-PostgreSQL split. Apply the three-part test in `domain-modeling`.

## Answer

Resolved in a grilling session with the user, rounds 1 to 3.

### Idempotency (Payment creation)

- The client sends an `Idempotency-Key` header on `POST /payments`. Its scope is one create request.
- Core stores the key, a hash of the request body and the response in `core_idempotency_keys` for 24 hours.
- Same key and same body: return the stored response.
- Same key and different body: `422`.
- New key but `merchantOrderId` already exists: `409`, with the id of the existing Payment.
- Gateway retries are not covered by this key. They use the `attemptKey` decided in [Domain model and invariants](03-domain-model-invariants.md).

### Transactional Outbox

- Only Payment-level events are written: `PaymentCreated`, `PaymentSucceeded`, `PaymentCancelled`, `PaymentExpired`, `PaymentRequiresReview`. A `PaymentTransaction` transition writes no outbox row in Phase 1, unless it also changes the Payment status. The one exception is `PaymentRequiresReview`, which is written when a `PaymentTransaction` first enters `REQUIRES_REVIEW`, even though the Payment status does not change.
- The outbox row is written in the same database transaction as the state change, into `core_outbox_events`.
- A relay inside Core reads unpublished rows, adds each one to BullMQ with `jobId` = outbox row id, then sets `published_at`. Delivery is at-least-once, so consumers must be idempotent.
- If Redis is unavailable, rows stay unpublished in PostgreSQL. The relay retries on the next poll, and writes keep working.
- Phase 1 consumers are internal only. Delivery to merchants belongs to a later effort.

### Webhook Inbox

- `parseCallback` verifies the signature before any write.
- A valid callback is stored in `core_webhook_inbox` (raw body bytes, headers, gateway id) before processing. An invalid callback gets an error ack in the provider's format, is not stored, and only its rejection reason is logged.
- Webhook routes must keep the raw body, because Stripe signs the raw bytes.
- The ack is returned as soon as the inbox row is committed. Processing runs in a BullMQ worker.
- States: `RECEIVED` → `PROCESSING` → `PROCESSED`, or `FAILED`. `PROCESSING` carries `lockedAt`. A sweep resets rows that have been `PROCESSING` for more than 5 minutes back to `RECEIVED`.
- The sweep retries `FAILED` rows up to 5 times. After that the row stays `FAILED` and raises an alert for manual handling.
- Dedupe key: `providerEventId` when the provider supplies one (Stripe `event.id`), otherwise the SHA-256 of the raw body. Unique on `(gatewayId, dedupeKey)`.
- A duplicate gets a success ack in the provider's format and is not processed again. Transitions are idempotent, so correctness holds even when the body differs between retries (VNPay has no event id).

### Failure ownership and recovery

- PostgreSQL is the single source of truth.
- Redis and BullMQ are a derived dispatch mechanism. Every job can be rebuilt from unprocessed rows in `core_outbox_events`, `core_webhook_inbox` and `core_payments`.
- Decided in [ADR 0002](../../../docs/adr/0002-postgresql-source-of-truth-bullmq-dispatch.md).

### Expiry job

- A periodic sweep runs every minute. It is a BullMQ repeatable job registered at boot, so there is one schedule across all instances.
- The sweep queries PostgreSQL for `Payment` rows in `PENDING` with `expiresAt < now`.
- For each one it enqueues a job with `jobId` = `paymentId`. The worker queries the provider for each non-terminal attempt, then closes the attempt and the Payment according to [Payment and PaymentTransaction state machines](04-payment-state-machine.md).
- If Redis loses a job, the next sweep finds the Payment still `PENDING` and enqueues it again. The deadline never lives only in Redis.
- Accepted latency: a Payment may close up to about one minute after `expiresAt`.
- Scaling requirements: an index on `(status, expires_at)`, preferably partial with `WHERE status = 'PENDING'`; a batch size limit per sweep; and a rate limiter on provider queries, so an expiry burst does not trigger provider rate limits.

### Table ownership

- New tables: `core_idempotency_keys`, `core_outbox_events`, `core_webhook_inbox`. Together with `core_gateway_raw_responses` from [Table ownership convention](02-table-ownership-convention.md), these are all the tables of the async boundary.
- Only Core repositories write these tables. Workers and the sweep call repositories and do not write through Prisma directly. Gateway plugins read and write none of them.

### Retention

- `core_idempotency_keys`: kept 24 hours, then deleted by the sweep.
- `core_outbox_events`: published rows are deleted after 7 days. Unpublished rows are never deleted.
- `core_webhook_inbox`: kept 90 days, then deleted. `FAILED` rows are not deleted automatically within that window.
- `core_gateway_raw_responses`: not deleted in Phase 1. Column details are decided in [PostgreSQL schema](07-postgres-schema.md).

### Deferred

- Columns, indexes and constraints of the new tables: [PostgreSQL schema](07-postgres-schema.md).
- Locking between the sweep, webhooks and merchant actions on the same Payment: [PaymentService and Repository boundaries](08-payment-service-repository.md).
- Provider-specific rate limit values: implementation detail, not part of the spec.
