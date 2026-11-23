Labels: wayfinder:grilling
Type: grilling
Status: resolved
Blocked by: 04, 05, 07

# PaymentService and Repository boundaries

## Question

Define the application layer of Payment Core. Decide:

1. The use cases `PaymentService` exposes. Candidates: create a `Payment`, start a `PaymentTransaction` through a gateway, handle a browser return, handle a webhook result, switch to another gateway after a failure.
2. The collaborators each use case depends on: the Gateway Manager, repositories, the outbox writer, the queue producer.
3. Transaction boundaries: which writes must commit together.
4. How concurrent updates to the same `PaymentTransaction` are serialised (row lock, optimistic version, or another mechanism).
5. The repository interface: one repository per aggregate, or per table, and what it is allowed to return.

## Answer

Resolved in a grilling session with the user, rounds 1 to 3.

### Use cases

`PaymentService` exposes the API-facing use cases:

- **`createPayment`**: creates the `Payment` only. It does not create an attempt. Covered by the `Idempotency-Key` rule in [Async reliability boundary](06-async-reliability-boundary.md).
- **`startAttempt(paymentId, gatewayId)`**: creates a new `PaymentTransaction` and calls the gateway. If an attempt is open (`CREATED` or `PENDING`), it cancels that attempt (best-effort) inside the same Payment lock, then creates the new one. This is also how the customer switches gateway. There is no separate switch endpoint.
- **`getPayment`**: reads the Payment and its attempts.
- **`cancelPayment`**: merchant cancel, as defined in [Payment and PaymentTransaction state machines](04-payment-state-machine.md).
- **`handleBrowserReturn`**: writes nothing to the database. It only enqueues a status query for the attempt.
- **`resolveReview`**: operator action on a `REQUIRES_REVIEW` attempt. Exposed as an internal HTTP endpoint, `POST /internal/payments/:id/review-resolution`, restricted to operators.

Worker-driven handlers are separate application services and are not part of `PaymentService`. They use the same repositories and domain model: `processWebhook` (the Webhook Inbox worker), `expirePayment` (the expiry sweep), `requeryAttempt`, and the automatic re-query of `REQUIRES_REVIEW` attempts.

### Collaborators

- `PaymentService` depends on `PaymentRepository`, the infrastructure repositories, `TransactionRunner`, `GatewayManager`, the BullMQ producer, and a clock (for `expiresAt` checks).
- `TransactionRunner` is the only place that opens a database transaction (it wraps Prisma `$transaction`). It passes transaction-bound repositories into a callback. Repositories never open transactions themselves. Unit tests can replace it with a fake.
- The outbox, status transitions, idempotency keys, webhook inbox and raw responses are written through their own repositories inside the same transaction as the state change. Use cases never write those tables directly.

### Transaction boundaries

- **`createPayment`**: one transaction. Inserts `core_payments`, stores the `core_idempotency_keys` row with the response, and writes the `PaymentCreated` outbox event.
- **`startAttempt`**: three steps, as decided in the grilling. (1) A short transaction locks the Payment, checks the invariants, cancels any open attempt, and inserts the new attempt as `CREATED` with its `attemptKey`. (2) `plugin.initiate` is called with no transaction open. (3) A short transaction locks the Payment again, re-validates its state, and records `PENDING` or `FAILED` with `providerRef`, `nextAction`, `providerMetadata`, and the raw response. While the attempt is `CREATED` it blocks other attempts (invariant 6a), and a webhook that arrives early is still accepted (state machine ticket).
- **Webhook processing (worker)**: one transaction. It locks the Payment, applies the transition, writes the status transition, writes the outbox event if the Payment status changed, and marks the inbox row `PROCESSED`. Cancelling other attempts when a late success is promoted is best-effort and runs after commit. If a cancel fails, the attempt stays non-terminal. A later success on it goes to `REQUIRES_REVIEW`, as the state machine defines.
- **Expiry sweep (worker)**: transaction 1 locks the Payment and checks that it is still `PENDING` with `expiresAt < now`. The provider query runs with no transaction open. Transaction 2 locks the Payment again, re-checks its state, applies the result, cancels attempts best-effort, and writes `PaymentExpired`.
- **Merchant cancel**: commits first. One transaction sets the Payment and its open attempts to `CANCELLED` and writes `PaymentCancelled`. The provider cancel runs after commit, best-effort. This differs from `startAttempt` because the local state is committed before any gateway call.
- **Browser return**: no database write. It enqueues the query job.
- **Operator `resolveReview`**: one transaction. It locks the Payment, changes the status, writes the status transition with actor and note, and writes the outbox event if the Payment status changed.

### Concurrency

- Serialisation uses a pessimistic row lock: `SELECT ... FOR UPDATE` on `core_payments`. Every use case that changes a Payment or any of its attempts locks the Payment row first.
- There is no `version` column in Phase 1. Invariant 6b and the sweep / webhook / merchant action ordering all rely on this single lock.

### Repositories

- `PaymentRepository` is the aggregate repository. It loads and saves a `Payment` together with its `PaymentTransaction`s, and exposes `findForUpdate(id)`, which takes the row lock. It does not load `Refund`s in Phase 1.
- One infrastructure repository per table owned by Core: `OutboxRepository`, `WebhookInboxRepository`, `IdempotencyRepository`, `GatewayRawResponseRepository`, `StatusTransitionRepository`.
- Repositories return domain objects only, never Prisma types.
- Refunds: there is no `RefundRepository` in Phase 1. The RefundService effort adds it later, together with the write path for `core_refunds`.

### Gateway calls and transactions

- No database transaction is held open across a gateway HTTP call. Any use case that calls a gateway reads state under lock, releases the lock while calling the gateway, then re-locks and re-validates state before writing. `startAttempt` and the expiry sweep follow this pattern. Merchant cancel commits local state first and calls the gateway after commit.

### Deferred

- Authentication of the merchant API and the operator endpoint: not decided by this ticket.
- Schema and column details of the tables written by these repositories: [PostgreSQL schema](07-postgres-schema.md).
- Queue wiring and job retry policy: [Async reliability boundary](06-async-reliability-boundary.md).
