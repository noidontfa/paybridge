Status: ready-for-agent

# Spec: Payment Core (Phase 1)

Source: [Map: Payment Core (Phase 1)](map.md) and its resolved tickets [01](issues/01-research-gateway-divergences.md) to [08](issues/08-payment-service-repository.md). Vocabulary follows [GLOSSARY.md](../../GLOSSARY.md). Architecture decisions are recorded in [ADR 0001](../../docs/adr/0001-shared-public-schema-with-table-prefix-ownership.md) and [ADR 0002](../../docs/adr/0002-postgresql-source-of-truth-bullmq-dispatch.md).

## Problem Statement

PayBridge is a Single-Merchant Payment Hub. The merchant system needs to collect a payment for one of its orders through a payment service provider (PSP) such as VNPay, ZaloPay or Stripe, without the merchant's system knowing how each provider works. Today there is no system that holds the state of a payment across providers.

Each provider behaves differently. VNPay builds a signed redirect URL locally, ZaloPay returns a synchronous order URL, QR payload or SDK token, and Stripe returns a client secret. VNPay's IPN is authoritative, ZaloPay sends callbacks only on success so it must be polled, and Stripe declines leave the PaymentIntent open. Some outcomes are non-binary (VNPay `07` or `04`). Late successes can arrive after the customer's time has run out. If Core assumes any of these behaviours away, a customer can be charged without the merchant's order being marked paid, or be charged twice.

Payment Core is the part of PayBridge that owns the lifecycle of a Payment across all of these providers. It must give the merchant one stable state model, and it must keep that state correct when providers are slow, duplicate callbacks, arrive late, or disagree.

## Solution

Payment Core provides:

- a `Payment` aggregate that the merchant creates once for an upstream order, with an amount in VND, an expiry, and a unique upstream reference;
- `PaymentTransaction` attempts under a Payment, each sent to one PaymentGateway. A customer can switch gateway by starting a new attempt;
- a provider-neutral `PaymentGateway` port that Core owns. Gateway Plugins implement it and Core never imports them;
- a state machine for Payment and PaymentTransaction that decides, from provider results, whether the Payment is paid, cancelled, expired, or under review;
- a reliability layer in which PostgreSQL is the source of truth and BullMQ on Redis only dispatches work. Every job can be rebuilt from PostgreSQL rows;
- a PostgreSQL schema of eight `core_*` tables that only Core writes.

Refunds are out of scope for this effort except for the data hook: the `core_refunds` table exists and the Refund model is fixed, but no code writes to it.

## User Stories

### Merchant (API client)

1. As a merchant integrator, I want to create a Payment for an order with an amount in VND and an upstream reference, so that PayBridge can collect the money for that order.
2. As a merchant integrator, I want the create call to return the Payment identifier and its status, so that I can store it against my order.
3. As a merchant integrator, I want to send an `Idempotency-Key` header with the create call, so that a network retry does not create a second Payment.
4. As a merchant integrator, I want a repeated create call with the same key and the same body to return the original response, so that retries are safe.
5. As a merchant integrator, I want a repeated create call with the same key but a different body to be rejected with `422`, so that I notice a bug in my client.
6. As a merchant integrator, I want a create call with a new key but an upstream reference that already exists to be rejected with `409` and the id of the existing Payment, so that I can find the Payment I already have.
7. As a merchant integrator, I want every Payment to have an expiry between 30 minutes and 24 hours after creation, with a default of 30 minutes, so that unpaid orders close on a known schedule.
8. As a merchant integrator, I want to read a Payment with its attempts, so that I can show the current state to my support team.
9. As a merchant integrator, I want to cancel a Payment that is still pending, so that the customer cannot pay for an order I have withdrawn.
10. As a merchant integrator, I want a Payment I cancelled to stay cancelled even when the customer pays late, so that the merchant decides what happens to that money.
11. As a merchant integrator, I want to be told when a Payment succeeds, is cancelled, expires, or goes to review through an internal event, so that my order system can update in time. (Phase 1 events are internal only; merchant delivery is a later effort.)
12. As a merchant integrator, I want the Payment's amount and upstream reference to never change after creation, so that the record I store stays valid.

### Customer (payer)

13. As a customer, I want to be sent to the gateway I chose and pay there, so that I can complete the payment with my preferred method.
14. As a customer, I want to be shown the right next step for the gateway I chose (a redirect, a QR code, an SDK token, or a voucher), so that I can complete the payment without confusion.
15. As a customer whose payment attempt failed or timed out, I want to choose another gateway and pay again, so that I am not stuck with one provider.
16. As a customer, I want to be prevented from starting a second payment while the first one is still being confirmed, so that I do not pay twice by mistake.
17. As a customer who paid after the Payment had already expired or been cancelled, I want my money to be kept on record and sent for review, so that the merchant can refund or resolve it.
18. As a customer, I want to see the Payment's outcome when I return from the gateway, even when the server-to-server notification has not arrived yet, so that the page I land on is not misleading.

### Payment Core: Payment lifecycle

19. As Payment Core, I want a Payment to start in `PENDING`, so that every new Payment is open for attempts.
20. As Payment Core, I want a Payment to move to `SUCCEEDED` only when one of its attempts is `SUCCEEDED` with an amount equal to the Payment amount, so that a Payment is never marked paid for the wrong amount.
21. As Payment Core, I want a `PENDING` Payment to move to `CANCELLED` on a merchant cancel and cancel its open attempts best-effort, so that the customer's open attempts stop.
22. As Payment Core, I want a `PENDING` Payment to move to `EXPIRED` at `expiresAt` only after the provider has confirmed the attempt is unpaid, so that a customer who paid just before the deadline is not marked expired.
23. As Payment Core, I want a Payment to never move back from `SUCCEEDED`, `CANCELLED` or `EXPIRED`, so that terminal states are final.
24. As Payment Core, I want `EXPIRED` and `CANCELLED` kept as separate Payment states, so that reconciliation can tell a merchant cancel from a timeout.
25. As Payment Core, I want no `FAILED` state on Payment, so that a failed attempt does not end a Payment the customer can still pay.

### Payment Core: Attempt lifecycle (PaymentTransaction)

26. As Payment Core, I want a new attempt to be stored as `CREATED` with its attempt key before the gateway is called, so that the key exists even if the call fails midway.
27. As Payment Core, I want an attempt to move from `CREATED` to `PENDING` when the gateway accepts it, so that I know the customer can continue paying.
28. As Payment Core, I want an attempt to move from `CREATED` to `FAILED` when the gateway rejects it synchronously, so that the customer can try another gateway.
29. As Payment Core, I want a webhook result to be accepted for an attempt still in `CREATED`, so that a notification that arrives before my own `PENDING` record is not lost.
30. As Payment Core, I want an attempt to move to `SUCCEEDED`, `FAILED` or `REQUIRES_REVIEW` from a webhook or a status query, so that the gateway result is the basis for the outcome.
31. As Payment Core, I want an attempt to move to `EXPIRED` at the Payment deadline only after the provider is queried and reports it unpaid, so that the deadline never closes a payment that was already made.
32. As Payment Core, I want an open attempt to be cancelled best-effort when the customer switches gateway, so that the old provider does not keep an open session for the same Payment.
33. As Payment Core, I want the browser return to never set an attempt to `SUCCEEDED` or `FAILED`, so that an unverified redirect cannot mark a Payment paid.
34. As Payment Core, I want a repeated transition to the state an entity is already in to do nothing, so that duplicate callbacks and retries are harmless.

### Payment Core: late success and review

35. As Payment Core, I want a late success on a `FAILED`, `EXPIRED` or `CANCELLED` attempt to be kept, so that money the customer paid is never dropped.
36. As Payment Core, I want a late success to promote the Payment to `SUCCEEDED` only when the Payment is still `PENDING`, no attempt is already `SUCCEEDED`, and the amount matches, so that promotion is safe.
37. As Payment Core, I want a late success on a closed Payment, a Payment that already has a succeeded attempt, or a mismatched amount to go to `REQUIRES_REVIEW`, so that a human or a rule decides.
38. As Payment Core, I want a success whose amount differs from the Payment amount to go to `REQUIRES_REVIEW` without promoting the Payment, so that a wrong amount is never recorded as paid.
39. As Payment Core, I want an attempt in `REQUIRES_REVIEW` (ambiguous status, amount mismatch, late success, duplicate success) to block new attempts on the Payment, so that the customer cannot pay again while the money is unresolved.
40. As Payment Core, I want every attempt in review to record a review reason and the time the review opened, so that operators can prioritise.
41. As Payment Core, I want `AMBIGUOUS_PROVIDER_STATUS` and `AMOUNT_MISMATCH` reviews to be re-queried on schedule and resolved by the normal rules when the provider gives a clear answer, so that most reviews close without an operator.
42. As Payment Core, I want a review that is still unclear 72 hours after it opened to be left for an operator, so that nothing waits forever.
43. As Payment Core, I want `refund_required` set to `true` whenever money was collected but the attempt is not `SUCCEEDED`, so that the refund effort can find these cases later.
44. As Payment Core, I want `LATE_SUCCESS_ON_CLOSED_PAYMENT` and `DUPLICATE_SUCCESS` reviews to stay open with `refund_required = true` until the refund effort exists, so that the money is tracked and not silently closed.

### Operator

45. As an operator, I want to resolve a review on an attempt that has been open for 72 hours by setting it to `SUCCEEDED` or `FAILED` with a mandatory note, so that every stuck case has a decision.
46. As an operator, I want my resolution to be allowed only when the rules permit it (for example `SUCCEEDED` only when the amount equals the Payment amount and the Payment is `PENDING`), so that I cannot create an invalid state by hand.
47. As an operator, I want every status change I make recorded with my identity and my note in the audit trail, so that the change can be explained later.
48. As an operator, I want to add notes to `LATE_SUCCESS_ON_CLOSED_PAYMENT` and `DUPLICATE_SUCCESS` reviews without changing their status, so that I can record what I know until refunds exist.
49. As an operator, I want the operator endpoint to be reachable only by operators, so that merchants and customers cannot resolve reviews.

### Gateway integration

50. As a Gateway Plugin author, I want to implement one port with four operations (`initiate`, `query`, `cancel`, `parseCallback`), so that adding a provider does not change Core.
51. As a Gateway Plugin author, I want to receive the attempt key as a UUID v7 and format it into the provider's required shape myself, so that each provider's length and character rules stay inside its plugin.
52. As a Gateway Plugin author, I want to receive the amount in whole dong and scale it to the provider's unit myself (for example VNPay ×100), so that Core never knows provider units.
53. As a Gateway Plugin author, I want to return a provider's raw response separately from the provider metadata Core needs later, so that the raw response is stored for audit and the metadata is available for future calls.
54. As a Gateway Plugin author, I want to report only the four normalised states (`PENDING`, `SUCCEEDED`, `FAILED`, `REQUIRES_REVIEW`) and the amount reported by the provider, so that Core decides `EXPIRED` and `CANCELLED` itself.
55. As a Gateway Plugin author, I want a Stripe decline to stay inside one attempt as `PENDING` until the PaymentIntent succeeds or Core closes the attempt, so that Core never sees Stripe's intermediate statuses.
56. As a Gateway Plugin author, I want to report errors in five categories (`GatewayRejected`, `GatewayUnavailable`, `OutcomeUnknown`, `InvalidCallback`, `NotFound`) with a retryable flag, so that Core can react without knowing the provider.
57. As Payment Core, I want an `OutcomeUnknown` error to leave the attempt as it is and be re-queried by the scheduler, so that a timeout after the request was sent is not treated as a failure.
58. As Payment Core, I want a `GatewayUnavailable` error to leave the attempt state unchanged and be retried, so that a provider outage does not fail payments.
59. As Payment Core, I want `query` to return `NotFound` when the provider has no such transaction, so that I can decide what it means for the attempt.
60. As Payment Core, I want to check a capability flag (for example `supportsCancel`) before calling an optional operation, so that an unsupported operation is never called as a normal path.
61. As Payment Core, I want the next action for the customer (redirect, QR code, client SDK, or voucher) to be a discriminated union, so that a new kind of next action can be added without breaking existing ones.
62. As Payment Core, I want each plugin's registration to be explicit and checked at boot, so that a missing or duplicated gateway fails the deployment early.
63. As Payment Core, I want to resolve the plugin for an attempt from its gateway identifier, so that I do not depend on which plugin is in use.
64. As an engineer, I want a CI rule that fails the build when Core imports a Gateway Plugin, so that the dependency direction is enforced and not just documented.
65. As an engineer, I want Core to export no plugin types, so that the port stays the only contract.

### Webhooks and callbacks

66. As Payment Core, I want every callback's signature checked before anything is stored, so that forged notifications never change state.
67. As Payment Core, I want a verified callback stored with its raw body, headers, and gateway identifier before processing, so that I can replay it if processing fails.
68. As Payment Core, I want an invalid callback to get the provider's error acknowledgement and to be dropped with only the rejection reason logged, so that bad input is not stored.
69. As Payment Core, I want the acknowledgement sent as soon as the callback is stored, so that the provider does not retry because processing is slow.
70. As Payment Core, I want duplicate callbacks to be recognised by provider event identifier when one exists, and by the hash of the raw body otherwise, so that each event is processed once.
71. As Payment Core, I want a duplicate callback to receive the provider's success acknowledgement without being processed again, so that the provider stops retrying.
72. As Payment Core, I want raw request bodies preserved on the webhook route, so that signature checks that depend on the exact bytes (Stripe) still work.
73. As Payment Core, I want callbacks in `RECEIVED`, `PROCESSING` or `FAILED` to be picked up again by a sweep, so that a crash during processing does not lose the event.
74. As Payment Core, I want a row stuck in `PROCESSING` for more than 5 minutes reset to `RECEIVED`, so that a crashed worker does not block processing.
75. As Payment Core, I want a `FAILED` callback retried up to 5 times and then left for manual handling with an alert, so that a permanent error is visible.

### Expiry

76. As Payment Core, I want a sweep to run every minute and find `PENDING` Payments whose deadline has passed, so that expiry does not depend on the provider or on Redis.
77. As Payment Core, I want each expired Payment to be queued by its identifier with no duplicate jobs, so that one Payment is not processed in parallel.
78. As Payment Core, I want the expiry worker to query each open attempt before closing it, so that a payment confirmed just before the deadline is applied correctly.
79. As Payment Core, I want the expiry sweep to process Payments in batches with a rate limit on provider queries, so that a burst of expiries does not hit provider rate limits.
80. As an engineer, I want the expiry to close a Payment at most about one minute after `expiresAt`, so that the latency is known and accepted.

### Reliability

81. As Payment Core, I want domain events written to an outbox in the same database transaction as the state change, so that an event exists if and only if the state changed.
82. As Payment Core, I want a relay to publish outbox rows to BullMQ and mark them as published, so that events reach consumers.
83. As Payment Core, I want unpublished outbox rows to stay in PostgreSQL while Redis is unavailable and to be published when Redis returns, so that a Redis outage does not lose events or stop payments.
84. As an engineer, I want outbox delivery to be at-least-once with each job identified by its outbox row, so that consumers can deduplicate.
85. As an engineer, I want every BullMQ job to be rebuildable from PostgreSQL rows, so that losing Redis data never loses a deadline, an event, or a callback.
86. As an engineer, I want published outbox rows deleted after 7 days and unpublished rows never deleted, so that the table stays small without losing pending work.
87. As an engineer, I want idempotency key records deleted after 24 hours, and webhook inbox rows deleted after 90 days except `FAILED` ones, so that retention is defined.
88. As an engineer, I want raw gateway responses kept indefinitely in Phase 1, so that audit data is never lost.

### Data and audit

89. As an engineer, I want every Payment and attempt status change recorded in an append-only audit table in the same transaction, so that every state has a traceable reason and actor.
90. As an engineer, I want amounts stored with four decimal places and IDs stored as UUID v7, so that amounts from every currency fit and IDs can be created before any provider call.
91. As an engineer, I want at most one open attempt per Payment and at most one succeeded attempt per Payment enforced by the database, so that a bug in application code cannot double-charge.
92. As an engineer, I want provider references unique per gateway, and upstream references unique across PayBridge, enforced by the database.
93. As an engineer, I want the partial unique indexes and the expiry index to be checked by an automated test, so that they cannot be dropped silently.
94. As an engineer, I want Payment amounts validated against the currency's decimal places in the application, so that the schema stays the same when another currency is added.
95. As an engineer, I want Phase 1 to accept only VND, so that no other currency is processed before its rules are defined.
96. As an engineer, I want a Refund row to be able to reference a succeeded attempt and an amount, so that the refund effort needs no schema change to start.

### Concurrency and transactions

97. As Payment Core, I want every use case that changes a Payment or its attempts to lock the Payment row first, so that webhooks, the expiry sweep, and merchant actions cannot interleave.
98. As Payment Core, I want no database transaction open while calling a gateway, so that a slow provider does not hold locks.
99. As Payment Core, I want the state re-checked after each gateway call before it is written, so that a change made while I was waiting is not overwritten.
100. As Payment Core, I want a merchant cancel to commit local state before the provider cancel is called, so that a provider failure cannot undo the merchant's decision.
101. As an engineer, I want a single component to be the only place that opens database transactions, so that transaction boundaries are visible in one place.
102. As an engineer, I want repositories to return domain objects and never database client types, so that the domain does not depend on the ORM.

### Gateway switch

103. As a customer, I want switching gateway to be the same action as starting a new attempt, so that I do not need a separate endpoint.
104. As Payment Core, I want starting a new attempt to cancel the open attempt in the same Payment lock, so that at most one attempt is open at a time.
105. As Payment Core, I want an old attempt that is still paid after a switch to follow the late-success rule, so that no money is dropped.

## Implementation Decisions

### Modules

- **Payment Core domain**: the `Payment` aggregate root, the `PaymentTransaction` entity owned by it, the `Refund` entity owned by `PaymentTransaction` (fields only), and the value objects `Amount` and the normalised outcome. It contains the state machine and the invariants. It does no I/O.
- **Application services**: `PaymentService` with the API use cases (`createPayment`, `startAttempt`, `getPayment`, `cancelPayment`, `handleBrowserReturn`, `resolveReview`). Worker application services are separate from it and use the same repositories: `processWebhook`, `expirePayment`, `requeryAttempt`, and the automatic re-query of `REQUIRES_REVIEW` attempts.
- **Transaction runner**: the only component that opens database transactions. It hands transaction-bound repositories to a callback.
- **Gateway Manager**: builds a map from gateway identifier to Gateway Plugin at boot, failing on a duplicate or missing plugin, and resolves the plugin for an attempt.
- **Repositories**: `PaymentRepository` (aggregate: Payment plus its attempts, with `findForUpdate`, which takes the row lock; it does not load Refunds in Phase 1), and one infrastructure repository per Core table: outbox, webhook inbox, idempotency keys, gateway raw responses, status transitions. There is no Refund repository in Phase 1.
- **Outbox relay**: a Core component that reads unpublished outbox rows and enqueues them to BullMQ.
- **Schedulers**: the expiry sweep and the webhook-inbox sweep, registered as repeatable BullMQ jobs at boot so that only one schedule runs across instances.
- **Gateway port**: the `PaymentGateway` interface owned by Core, plus the types it uses. Gateway Plugins live outside Core's module tree and are registered explicitly in the composition root.

### Identifiers and keys

- Payment id, attempt key, refund key, outbox row id, and webhook inbox id are UUID v7 generated by the application.
- The attempt key is the identifier of a PaymentTransaction. It is created before any gateway call, never changes, and is the value the plugin formats into the provider's reference. The formatting is per provider: ZaloPay's application transaction id is a date prefix plus the 32 hex characters of the attempt key; VNPay's transaction reference is those 32 hex characters; Stripe's idempotency key and metadata field use the hyphenated form. The formatting is reversible, so a callback can be matched back to the attempt. The exact rule for each provider is recorded in the research and in the resolved ticket 03.
- The refund key follows the same rule, applied by the plugin to refunds. Refund formatting is written down now and implemented in the refund effort.
- `providerRef` is nullable, set once, and immutable. It is used for refunds, status queries and reconciliation. It is not used to match callbacks: callbacks are matched through the attempt key (VNPay and ZaloPay echo it; Stripe carries it in metadata).

### Payment fields

- `Payment`: id, `merchantOrderId` (upstream reference, required, globally unique in Phase 1, immutable), amount (decimal, whole dong in VND), currency (ISO 4217 code), status, expiry time, created time, updated time.
- `PaymentTransaction`: id (attempt key), payment id, gateway identifier, status, provider reference (nullable), provider metadata (opaque JSON), next action (nullable), review reason (nullable), review opened time (nullable), refund-required flag, created time, updated time. It has no amount of its own in Phase 1.
- `Refund` (fields only, no write path in Phase 1): id (refund key), attempt id, amount, status, provider reference (nullable), provider metadata, reason, created time, updated time.

### Amount and currency

- Money is stored as a decimal count of the currency's major unit with four decimal places. For VND this is whole dong.
- Phase 1 accepts VND only, enforced by validation. The currency field stays so that adding a currency later needs no schema change.
- Scaling for a provider (for example VNPay multiplies by 100) is done by the plugin at the port boundary.

### Payment states and rules

- Payment states: `PENDING`, `SUCCEEDED`, `CANCELLED`, `EXPIRED`. `PENDING` is the only non-terminal state.
- Payment deadline: required, sent to the provider when the payment URL is created (for VNPay as the expiry field, for ZaloPay as the expire-duration field, for Stripe Checkout as `expires_at`). Default 30 minutes after creation. Allowed range 30 minutes to 24 hours. Core enforces the deadline itself for every gateway. No attempt deadline is later than the Payment deadline.
- Attempt states: `CREATED`, `PENDING`, `SUCCEEDED`, `FAILED`, `EXPIRED`, `CANCELLED`, `REQUIRES_REVIEW`. `SUCCEEDED`, `FAILED`, `EXPIRED` and `CANCELLED` are terminal for the normal flow, subject to the late-success rule. `REQUIRES_REVIEW` is non-terminal.

Payment transitions:

| From | To | Triggered by | Condition |
|---|---|---|---|
| `PENDING` | `SUCCEEDED` | Callback, status query, or promotion of a late success | An attempt is `SUCCEEDED` with amount equal to the Payment amount |
| `PENDING` | `CANCELLED` | Merchant API | Open attempts are cancelled best-effort after commit |
| `PENDING` | `EXPIRED` | Expiry worker at the deadline | Provider queried first and confirmed unpaid |

Attempt transitions:

| From | To | Triggered by | Condition |
|---|---|---|---|
| `CREATED` | `PENDING` | Core, when the gateway accepts | |
| `CREATED` | `FAILED` | Core, when the gateway rejects synchronously | |
| `CREATED` or `PENDING` | `SUCCEEDED` | Callback or status query | Amount equals the Payment amount |
| `CREATED` or `PENDING` | `FAILED` | Callback or status query | Clear failure |
| `CREATED` or `PENDING` | `REQUIRES_REVIEW` | Callback or status query | Non-binary result, or amount differs |
| `PENDING` | `EXPIRED` | Expiry worker at the deadline | Provider queried first and confirmed unpaid |
| `CREATED` | `CANCELLED` | Core (gateway switch) | Best-effort cancel at the provider. Added to ticket 04's table, as confirmed by the user, because ticket 08 cancels an open `CREATED` attempt on switch. |
| `PENDING` | `CANCELLED` | Core (gateway switch or merchant cancel) | Best-effort cancel at the provider |
| `FAILED`, `EXPIRED` or `CANCELLED` | `SUCCEEDED` | Late success | Payment is `PENDING`, no attempt is `SUCCEEDED`, and amount equals the Payment amount |
| `FAILED`, `EXPIRED` or `CANCELLED` | `REQUIRES_REVIEW` | Late success | Payment is `EXPIRED` or `CANCELLED`, another attempt is already `SUCCEEDED`, or amount differs |
| `REQUIRES_REVIEW` | (see review exit) | Re-query, then operator | |

- Callbacks and status queries are the authoritative source of attempt outcomes. A browser return never sets `SUCCEEDED` or `FAILED`; it only enqueues a status query.
- Transitions are idempotent: moving to the current state is a no-op.

### Late success and review

- A success on a `FAILED`, `EXPIRED` or `CANCELLED` attempt is never dropped. It is promoted or sent to review by the rules in the table above.
- Other non-terminal attempts are cancelled best-effort after a late promotion. If one of them later succeeds, it goes to `REQUIRES_REVIEW`.
- Merchant cancel: a success after a merchant cancel goes to `REQUIRES_REVIEW` and is never promoted. Phase 1 records only the state.
- Each attempt in review records a review reason (`AMBIGUOUS_PROVIDER_STATUS`, `AMOUNT_MISMATCH`, `LATE_SUCCESS_ON_CLOSED_PAYMENT`, `DUPLICATE_SUCCESS`) and the time the review opened.
- Review exit: `AMBIGUOUS_PROVIDER_STATUS` and `AMOUNT_MISMATCH` are re-queried on schedule and resolved by the normal rules on a clear answer. After 72 hours without a clear answer, an operator may resolve the review. Operator resolution of `SUCCEEDED` requires the amount to equal the Payment amount and the Payment to be `PENDING`; operator resolution of `FAILED` is always allowed. A note is mandatory. Every resolution is recorded with its actor.
- `LATE_SUCCESS_ON_CLOSED_PAYMENT` and `DUPLICATE_SUCCESS` stay in review with the refund flag set until the refund effort exists. Operators may only add notes to them.
- `refund_required` is set to `true` whenever money was collected and the attempt is not `SUCCEEDED`.
- A `REQUIRES_REVIEW` attempt blocks new attempts on its Payment. This is enforced by the service under the Payment row lock.

### Port: PaymentGateway (owned by Core)

- Four operations: `initiate`, `query`, `cancel`, `parseCallback`. No refund operations in Phase 1; the refund effort adds them as an extension.
- Each plugin declares a constant gateway identifier and capability flags (for example `supportsCancel`). Core checks a flag before calling an optional operation. An unsupported call is a defensive error, not a normal path.
- `initiate` input: attempt key, amount (decimal VND, whole dong), currency, expiry time, return URL, description. Output: optional provider reference, a next action, provider metadata (opaque, stored by Core and passed back on later calls, never interpreted by Core), and the raw provider response (stored by Core in the raw responses table, never interpreted).
- Next action: a discriminated union with four variants: redirect (URL), QR code (payload), client SDK (token), voucher (details). The voucher variant is kept although no Phase 1 method uses it, so that adding variants later does not break the union.
- `query` and `cancel` input: attempt key and the attempt's provider metadata.
- `query` and `parseCallback` output: one of four normalised states (`PENDING`, `SUCCEEDED`, `FAILED`, `REQUIRES_REVIEW`), the amount the provider reports, and for callbacks: attempt key, optional provider reference, optional provider event id, and the acknowledgement payload in the provider's format. Plugins never report `EXPIRED` or `CANCELLED`; Core decides those.
- `parseCallback` input: raw body bytes, headers, and query parameters. The plugin verifies the signature and derives the attempt key from provider data, so Core never reads provider identifiers.
- Errors, each with a retryable flag:
  - `GatewayRejected`: clear provider rejection. Not retryable. Core moves the attempt to `FAILED`.
  - `GatewayUnavailable`: timeout, server error, or network error before the provider accepted the request. Retryable. The attempt state does not change.
  - `OutcomeUnknown`: timeout after the request was sent. Not retried directly. The attempt is kept and re-queried by the scheduler.
  - `InvalidCallback`: signature or payload invalid. Not processed; the plugin returns an error acknowledgement.
  - `NotFound`: the provider has no such transaction. Returned to Core to decide.
- A Stripe decline is absorbed inside one attempt: the plugin reports `PENDING` until the PaymentIntent succeeds or Core closes the attempt. Core never sees Stripe's intermediate statuses.
- Plugin registration: explicit, in the composition root. No automatic scanning. Core resolves the plugin from the attempt's gateway identifier.
- Dependency rule: Core never imports a Gateway Plugin. A CI lint rule enforces this. The composition root is the only exception. Core exports no plugin types.

### Use cases and transaction boundaries

- `createPayment`: one transaction. Inserts the Payment, stores the idempotency record with its response, and writes the `PaymentCreated` outbox event. No attempt is created.
- `startAttempt(paymentId, gatewayId)`: three steps. (1) A short transaction locks the Payment, checks invariants, cancels any open attempt, and inserts the new attempt as `CREATED` with its attempt key. (2) The plugin's `initiate` is called with no transaction open. (3) A short transaction locks the Payment again, re-validates its state, and records `PENDING` or `FAILED` with provider reference, next action, provider metadata, and the raw response.
- `getPayment`: read only.
- `cancelPayment`: one transaction sets the Payment and its open attempts to `CANCELLED`, and writes the `PaymentCancelled` event. The provider cancel runs after commit, best-effort.
- `handleBrowserReturn`: no database write. Enqueues a status query for the attempt.
- `resolveReview` (operator, internal endpoint `POST /internal/payments/:id/review-resolution`): one transaction locks the Payment, changes the status, writes the status transition with actor and note, and writes the outbox event if the Payment status changed.
- `processWebhook` (worker): one transaction locks the Payment, applies the transition, writes the status transition, writes the outbox event if the Payment status changed, and marks the inbox row `PROCESSED`. Best-effort cancellation of other attempts after a late promotion runs after commit.
- `expirePayment` (worker): transaction 1 locks the Payment and checks it is still `PENDING` with a passed deadline. The provider queries run with no transaction open. Transaction 2 locks the Payment again, re-checks state, applies the result, cancels attempts best-effort, and writes `PaymentExpired`.
- Rule: no database transaction is held open across a gateway call. Any use case that calls a gateway reads state under lock, releases it, calls the gateway, then re-locks and re-validates before writing.

### Concurrency

- Serialisation is a pessimistic row lock (`SELECT ... FOR UPDATE`) on the Payment row. Every use case that changes a Payment or any of its attempts locks the Payment first.
- No version column in Phase 1.

### Reliability layer

- PostgreSQL is the single source of truth. BullMQ on Redis is a derived dispatch mechanism. Every job can be rebuilt from unprocessed rows (outbox, webhook inbox, Payments). See [ADR 0002](../../docs/adr/0002-postgresql-source-of-truth-bullmq-dispatch.md).
- Idempotency: the client sends `Idempotency-Key` on `POST /payments`. Scope is one create request. Stored 24 hours with a hash of the request body and the response. Same key and body returns the stored response. Same key and different body returns `422`. New key with an existing upstream reference returns `409` with the existing Payment id. Gateway retries use the attempt key and are not covered by this key.
- Transactional outbox: only Payment-level events are written: `PaymentCreated`, `PaymentSucceeded`, `PaymentCancelled`, `PaymentExpired`, `PaymentRequiresReview`. Attempt transitions write no outbox row unless the Payment status changes. The one exception is `PaymentRequiresReview`, which is written when an attempt first enters `REQUIRES_REVIEW`, even though the Payment status does not change. The row is written in the same transaction as the state change. The relay adds each unpublished row to BullMQ with the row id as the job id, then sets the published time. Delivery is at-least-once. If Redis is unavailable, rows stay unpublished and the relay retries on the next poll.
- Webhook inbox: a verified callback is stored before processing. Processing states: `RECEIVED`, `PROCESSING`, `PROCESSED`, `FAILED`. `PROCESSING` records a lock time. A sweep resets `PROCESSING` rows older than 5 minutes to `RECEIVED`. The sweep retries `FAILED` rows up to 5 times; after that the row stays `FAILED` and raises an alert. The dedupe key is the provider event id when present, otherwise the SHA-256 of the raw body. Unique on gateway identifier plus dedupe key. A duplicate gets the provider's success acknowledgement and is not processed again.
- Expiry sweep: every minute, a repeatable job queries PostgreSQL for `PENDING` Payments with a passed deadline, and enqueues each with the Payment id as job id. A Payment with no attempt is expired too. No provider query is made for it. The sweep has a batch size limit and the provider queries it triggers have a rate limit, so an expiry burst does not hit provider limits. The supporting index is listed under the schema below. Accepted latency: up to about one minute after the deadline.
- Retention: idempotency records 24 hours, then deleted. Published outbox rows deleted after 7 days; unpublished rows never deleted. Webhook inbox rows kept 90 days, then deleted, except `FAILED` rows, which are not deleted automatically. Raw gateway responses not deleted in Phase 1.
- Queue wiring and job retry policy are decided at implementation; the boundary above is fixed.

### PostgreSQL schema (decision summary)

The schema is one initial migration, after which only forward-only migrations are allowed. It is described here by table and constraint, not by DDL.

- **Ownership**: every table is named with the `core_` prefix, set through the ORM's table-name mapping. Payment Core is the only writer. A test over the ORM schema file asserts every model has a mapped name with a valid owner prefix ([ADR 0001](../../docs/adr/0001-shared-public-schema-with-table-prefix-ownership.md)).
- **Tables**:
  - `core_payments`: id, upstream reference (unique), amount `numeric(19,4)` with check amount > 0, currency, status, expiry time, created and updated times.
  - `core_payment_transactions`: id (attempt key), payment id (foreign key), gateway identifier (plain text, not an enum), status, provider reference (nullable; unique together with gateway identifier), provider metadata (JSON), next action (JSON, nullable), review reason (enum, nullable), review opened time (nullable), refund-required flag (default false), created and updated times.
  - `core_refunds`: id (refund key), attempt id (foreign key), amount `numeric(19,4)` with check amount > 0, status (`PENDING`, `SUCCEEDED`, `FAILED`, `REQUIRES_ACTION`, `CANCELLED`), provider reference (nullable), provider metadata (JSON), reason (nullable), created and updated times. No write path in Phase 1.
  - `core_gateway_raw_responses`: id, attempt id (foreign key), operation (`initiate`, `query`, `cancel`), payload (JSON), created time. Indexed on attempt id and created time.
  - `core_idempotency_keys`: key (text, primary key, up to 255 characters), request hash, response status, response body (JSON), payment id (foreign key, nullable), created and expiry times. Indexed on expiry time.
  - `core_outbox_events`: id (UUID v7, also the job id), event type, payment id (foreign key), payload (JSON), created time, published time (nullable). Partial index on id where unpublished; index on published time.
  - `core_webhook_inbox`: id, gateway identifier, dedupe key, provider event id (nullable), attempt key (UUID, nullable, no foreign key), raw body (bytes), headers (JSON, allow-list per plugin), query (JSON), status, attempts (default 0), lock time, last error, received time, processed time. Unique on gateway identifier plus dedupe key. Partial indexes on lock time where `PROCESSING` and on received time where `RECEIVED` or `FAILED`. Index on received time and on attempt key.
  - `core_status_transitions`: append-only audit trail. id, entity type, entity id, from status, to status, trigger, actor, reason, created time. Written in the same transaction as the change it records.
- **Conventions**: IDs are `uuid`. Timestamps are `timestamptz` with millisecond precision. Column names are snake_case; ORM model and field names are camelCase. All foreign keys are `ON DELETE RESTRICT`. Nothing is cascaded. Enum-typed columns use native enums. Gateway identifier is text.
- **Constraints enforced by the database**:
  - At most one open attempt per Payment: unique on payment id where status is `CREATED` or `PENDING` (partial).
  - At most one succeeded attempt per Payment: unique on payment id where status is `SUCCEEDED` (partial).
  - Provider reference unique per gateway.
  - Upstream reference unique across PayBridge.
  - Expiry index on status and expiry time, partial on `PENDING`.
  - These partial indexes are written as raw SQL in the migration because the ORM cannot declare them. An automated test asserts they exist.
- **Enforced by the service**: a `REQUIRES_REVIEW` attempt blocks new attempts (under the Payment row lock). Refund totals (invariants 10 and 11) are enforced by the refund effort.
- **Review enum values**: `AMBIGUOUS_PROVIDER_STATUS`, `AMOUNT_MISMATCH`, `LATE_SUCCESS_ON_CLOSED_PAYMENT`, `DUPLICATE_SUCCESS`.
- **Migration**: one initial migration covering the generated DDL and the raw SQL above. Before the first shared deploy it may be regenerated. After that, forward-only. A later multi-merchant effort adds `merchant_id` and changes upstream-reference uniqueness to `(merchant_id, upstream reference)` in a separate migration.

### Invariants (must always hold)

1. Payment amount is positive, has no more fraction digits than its currency allows, and never changes after creation.
2. Upstream reference is non-empty, globally unique, and never changes after creation.
3. Payment currency is VND in Phase 1.
4. Attempt key is globally unique, never changes, and is created before any gateway call.
5. Provider reference, once set, never changes; the pair (gateway identifier, provider reference) is unique.
6. (a) A Payment has at most one attempt in `CREATED` or `PENDING`. (b) A Payment with any attempt in `REQUIRES_REVIEW` accepts no new attempt.
7. A Payment has at most one attempt in `SUCCEEDED`.
8. An attempt's gateway identifier never changes after creation.
9. An attempt is recorded as `SUCCEEDED` only when the reported amount equals the Payment amount. Otherwise it goes to `REQUIRES_REVIEW`.
10. A Refund attaches only to a `SUCCEEDED` attempt.
11. The sum of Refund amounts across all attempts of a Payment does not exceed the Payment amount.

## Testing Decisions

### What makes a good test

- Test external behaviour: the state a Payment or attempt ends in, the values returned to a caller, the rows written, the events published, and the acknowledgement sent to a provider. Do not test which private method was called or in what order internal helpers ran.
- Test the invariants and the state table directly, including the rules that depend on the amount, the deadline, and the review reason.
- Test concurrency with a real PostgreSQL database. A mocked database cannot show that row locks or partial indexes work.
- Test provider behaviour through the port with recorded or fake provider responses. Each Gateway Plugin must pass one shared contract suite, not its own bespoke suite.

### Seams

The proposed seams, to be confirmed with the user, are:

- **Primary seam: the application services (`PaymentService` use cases and the worker application services)**, called with a real PostgreSQL database and a fake Gateway Manager that returns scripted port results. The clock is injected so expiry is testable without waiting. The transaction runner is real in integration tests and replaceable with a fake in unit tests. This is the highest seam and covers most rules.
- **Pure domain seam: the state machine and invariants**, tested as functions over Payment and attempt values, with no database. Used for the full transition table and the late-success matrix.
- **Port seam: the `PaymentGateway` contract suite**, run against every Gateway Plugin. This is new; no plugin exists yet.
- **Schema seam: the schema test** over the ORM schema file (owner prefix on every model, and the presence of the partial indexes). This follows ADR 0001.

Existing seams to reuse: the Nest module test setup and the Vitest configuration in the API application. Unit tests live beside source as `*.spec.ts`; end-to-end tests live under the test directory as `*.e2e-spec.ts`.

### Modules to be tested

- Payment Core domain (state machine, invariants, amount rules): highest priority, unit tests.
- `PaymentService` use cases: integration tests against PostgreSQL, covering the transaction boundaries, the row lock, and the no-transaction-across-gateway rule.
- Webhook inbox processing: integration tests covering verification before storage, deduplication, the `PROCESSING` reset sweep, and the retry limit.
- Expiry sweep and expiry worker: tests with a fake clock, covering the provider-confirmed-paid case just before the deadline.
- Outbox relay: tests covering publish, Redis unavailable, and at-least-once replay.
- Idempotency: tests covering same key and same body, same key and different body, and new key with an existing upstream reference.
- Gateway Manager: tests covering boot-time failure on a duplicate or missing plugin.
- Gateway Plugins: the shared contract suite (for example each normalised state, each error category, and the callback acknowledgement format).
- Schema test: owner prefix and partial indexes.
- Lint rule: a check that a Core module importing a plugin fails CI.

### Prior art in the codebase

- Unit tests: the existing `*.spec.ts` files under the API source tree (for example the exception filter spec and the environment schema spec).
- End-to-end tests: the existing `*.e2e-spec.ts` setup under the API test directory, run by the e2e Vitest configuration.

## Out of Scope

- Merchant (multi-merchant) platform, per-merchant tenancy and gateway credentials. Future effort after Payment Core.
- Admin UI. The API server is the focus.
- Reconciliation and settlement.
- Double-entry ledger.
- Tokenization and subscriptions (saved cards, recurring billing).
- Concrete Gateway Plugin implementations (VNPay, ZaloPay, Stripe, and later MoMo, PayPal, PayOS). Later phases, after the port is fixed.
- RefundService orchestration: creating, querying or completing refunds, refund webhooks, and the refund status mapping from providers. Only the data hook is in scope.
- Refund for money collected on a `REQUIRES_REVIEW` attempt: belongs to the RefundService flow.
- Queue consumer code and job retry policy details beyond the boundary described above.
- Merchant-facing delivery of events (webhooks to merchants). Phase 1 events are internal.
- Authentication and authorisation of the merchant API and the operator endpoint.
- Provider behaviours that could not be verified in research (see Further Notes).
- Application code. This spec defines what to build; it does not build it.

## Further Notes

### Decisions confirmed by the user

These points were open while turning the resolved tickets into this spec. The user confirmed each one.

1. **`CREATED` to `CANCELLED` on gateway switch.** Confirmed. An open attempt in `CREATED` or `PENDING` is cancelled on a gateway switch. The transition table includes both.
2. **Operator resolution of `AMOUNT_MISMATCH`.** Confirmed: keep the rule as written. For `AMOUNT_MISMATCH`, an operator can only set `FAILED`. Setting `SUCCEEDED` requires the amount to equal the Payment amount, which a mismatch cannot satisfy.
3. **`PaymentRequiresReview` event.** Confirmed. It is written when an attempt first enters `REQUIRES_REVIEW`, as an exception to the Payment-status rule for outbox writes.
4. **Spelling of the refund cancelled status.** Confirmed: align to `CANCELLED`. The `RefundStatus` enum uses `CANCELLED`, the same as the other statuses. This must be applied before the first migration is generated.
5. **Expiry for Payments with no attempts.** Confirmed. A `PENDING` Payment with no attempt expires at its deadline, with no provider query.

The resolved ticket files (04, 06, 07) were updated to match these decisions.

### Unverified provider behaviour (not blocking Phase 1)

Recorded as fog on the map. These do not block the spec, because Core enforces the deadline itself and treats the provider as a query source:

- Whether VNPay sends a late success callback after its expiry time.
- Whether ZaloPay allows multiple sequential partial refunds on one transaction reference.
- How ZaloPay's refund endpoint responds to a repeated refund identifier.
- The ZaloPay callback retry interval.

### Source material

- Research on gateway divergences: [research/gateway-divergences.md](research/gateway-divergences.md).
- Resolved decision tickets: [01](issues/01-research-gateway-divergences.md), [02](issues/02-table-ownership-convention.md), [03](issues/03-domain-model-invariants.md), [04](issues/04-payment-state-machine.md), [05](issues/05-gateway-plugin-contract.md), [06](issues/06-async-reliability-boundary.md), [07](issues/07-postgres-schema.md), [08](issues/08-payment-service-repository.md).
