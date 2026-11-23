Labels: wayfinder:grilling
Type: grilling
Status: resolved
Blocked by: 01

# Domain model and invariants for Payment and PaymentTransaction

## Question

Define the domain model of `Payment` and `PaymentTransaction` using the terms in `GLOSSARY.md`. Decide:

1. Entities, value objects and identity for each. Which fields belong to `Payment` and which to `PaymentTransaction`.
2. Amount and currency representation (VND and any other currency), using the unit findings from the research ticket.
3. The upstream reference on `Payment` (for example `merchantOrderId`) and its uniqueness rule.
4. The `1 Payment : N PaymentTransaction` relation, including the rule that at most one attempt may be in-flight at a time (to be confirmed).
5. Invariants that must always hold, stated as testable rules.
6. Data hooks for `Refund` (see the Refund data hook in the map's Not yet specified section) and for a future `merchantId`, without implementing either.

Add any new domain terms to `GLOSSARY.md` inline, in English.

## Answer

Resolved in a grilling session with the user, rounds 1 to 4.

### Entities and identity

- **`Payment`** is the aggregate root. Identity: `id`, UUID v7, stored as `uuid`. Fields: `id`, `merchantOrderId` (Upstream Reference), `amount`, `currency`, `status`, `createdAt`, `updatedAt`. `status` is defined in the state machine ticket.
- **`PaymentTransaction`** is an entity owned by `Payment`. Identity: `id` = `attemptKey`, UUID v7, stored as `uuid`. There is no separate bigint key. Fields: `id`, `paymentId`, `gatewayId`, `status`, `providerRef` (nullable), `providerMetadata` (opaque extension bag), `createdAt`, `updatedAt`. `status` is defined in the state machine ticket.
- **`Refund`** is an entity owned by `PaymentTransaction`. Identity: `id` = `refundKey`, UUID v7, stored as `uuid`. Minimum fields: `id`, `paymentTransactionId`, `amount`. Its lifecycle is out of scope here.

### Amount and currency

- `Amount` is a value object: `amount` is a decimal count of the currency's major unit, stored as `numeric(19,4)` (for VND, whole dong, for example `100000.0000`), and `currency` is an ISO 4217 code. The number of decimal places each currency allows is validated by the application, not the schema.
- Phase 1 accepts `VND` only, enforced by validation. The `currency` field stays so that adding a currency later needs no schema change.
- Only `Payment` holds `amount`. `PaymentTransaction` has no amount of its own, because Phase 1 has no partial capture.
- Gateway-specific scaling (VNPay ×100) belongs to the plugin at the port boundary.

### Keys sent to gateways

- **`attemptKey`** (UUID v7): the identifier of a `PaymentTransaction`. The gateway-facing value is built by the plugin once, when the attempt is created, and is never rebuilt on retry.
  - ZaloPay `app_trans_id`: `yymmdd` (GMT+7 date of attempt creation) + `_` + 32 hex characters of `attemptKey`, without hyphens. Length 39, within the 40 limit.
  - VNPay `vnp_TxnRef`: 32 hex characters.
  - Stripe `Idempotency-Key`: `attemptKey` with hyphens. Also written to `metadata.attempt_key`.
  - The value is reversible: strip the first 7 characters of the ZaloPay value and insert hyphens in the 8-4-4-4-12 pattern.
- **`refundKey`** (UUID v7): the same rule, applied by the plugin to refunds.
  - ZaloPay `m_refund_id`: `yymmdd` (GMT+7 date of refund creation) + `_` + `appid` + `_` + 32 hex characters of `refundKey`. The plugin checks at startup that `appid` has at most 5 digits, which keeps the total within 45. The 45 limit comes from earlier research, not from the doc page re-read on this day.
  - VNPay `vnp_RequestId`: 32 hex characters.
  - Stripe `Idempotency-Key`: `refundKey` with hyphens.
- **`providerRef`** is nullable and is set once. It is immutable after that. Its uses are refund calls (ZaloPay requires `zp_trans_id`), status queries, and reconciliation. It is not used to match callbacks. VNPay and ZaloPay echo the `attemptKey` value back, and Stripe is matched through `metadata.attempt_key`.

### Upstream reference and relations

- `merchantOrderId` is required, unique across PayBridge, and immutable. Phase 1 has a single merchant, so uniqueness is global. Repeated create calls with the same `merchantOrderId` are handled by the idempotency ticket.
- `1 Payment : N PaymentTransaction`.
- At most one `PaymentTransaction` in `CREATED` or `PENDING` per `Payment` at any time (in-flight). A `REQUIRES_REVIEW` attempt also blocks new attempts, as invariant 6b.
- At most one `SUCCEEDED` `PaymentTransaction` per `Payment`.
- `1 PaymentTransaction : N Refund`. A `Refund` attaches to a `PaymentTransaction`, not directly to a `Payment`. A `Payment`'s refunded total is derived through its transactions.
- No `merchantId` column in Phase 1. When Multi-Merchant arrives, `merchantOrderId` uniqueness changes scope to `(merchantId, merchantOrderId)` through a migration.

### Invariants (testable)

1. `Payment.amount` is positive, has no more fraction digits than its currency allows, and does not change after creation.
2. `merchantOrderId` is non-empty, unique, and does not change after creation.
3. `Payment.currency` is `VND` in Phase 1.
4. `attemptKey` is globally unique, does not change, and is created before any call to a gateway.
5. `providerRef`, once set, does not change. The pair `(gatewayId, providerRef)` is unique.
6. (6a) A `Payment` has at most one `PaymentTransaction` in `CREATED` or `PENDING`. (6b) A `Payment` with any `PaymentTransaction` in `REQUIRES_REVIEW` accepts no new attempt. 6a is enforced by the database, and 6b by the service under the Payment row lock.
7. A `Payment` has at most one `PaymentTransaction` in `SUCCEEDED`.
8. `PaymentTransaction.gatewayId` does not change after creation.
9. A `PaymentTransaction` is recorded as `SUCCEEDED` only when the amount reported by the gateway equals `Payment.amount`. If the amounts differ, it is not recorded as `SUCCEEDED`, and the handling state is set by the state machine ticket.
10. A `Refund` attaches only to a `PaymentTransaction` in `SUCCEEDED`.
11. The sum of `Refund.amount` across all transactions of a `Payment` does not exceed `Payment.amount`.

### Storage notes

- Store identifiers as the native `uuid` type. Index: primary key on `id`, `UNIQUE (gateway_id, provider_ref)` on `core_payment_transactions`, and an index on `payment_id`. `UNIQUE (merchant_order_id)` on `core_payments`.
- Invariants 6a and 7 are enforced at the database level with partial unique indexes (`CREATED`/`PENDING` and `SUCCEEDED`). Invariant 6b is enforced by the service. Prisma does not declare partial indexes in `schema.prisma`, so they are written as SQL in the migration. This is handled in the schema ticket.

### Deferred to other tickets

- `status` values, transitions, and the handling state for amount mismatch: state machine ticket.
- Late success after expiry and duplicate-paid handling: state machine ticket.
- Refund lifecycle (status, asynchronous result): state machine and gateway port tickets.
- Handling of repeated create calls with the same `merchantOrderId`: async reliability boundary ticket.
- Partial unique indexes and the migration: PostgreSQL schema ticket.
- Mapping of keys and the port operations: PaymentGateway port ticket.
