Labels: wayfinder:grilling
Type: grilling
Status: resolved
Blocked by: 01, 03

# Payment and PaymentTransaction state machines

## Question

Design the state machines for `Payment` and `PaymentTransaction`. Decide:

1. The states of each, which are terminal, and the allowed transitions.
2. Who may trigger each transition: a client request, a gateway response, a webhook, a timeout, or an internal job.
3. How a `Payment` moves to a new `PaymentTransaction` after one fails or expires (for example, a customer switches from VNPay to ZaloPay). What state the earlier attempt ends in.
4. Races between the browser return and the webhook for the same `PaymentTransaction`, and what a late success after expiry does. Resolve these at the state level.
5. Whether a `Payment` can succeed after an attempt has been cancelled or expired.

Use the findings from the research ticket for provider status models.

## Answer

Resolved in a grilling session with the user, rounds 1 to 4.

### Payment states

- `PENDING`: non-terminal. Accepts new `PaymentTransaction`s.
- `SUCCEEDED`: terminal. Reached when a `PaymentTransaction` is `SUCCEEDED` with an amount equal to `Payment.amount`.
- `CANCELLED`: terminal. Set by the merchant through the API. Allowed while an attempt is in flight (see Merchant cancel).
- `EXPIRED`: terminal. Set by the system at `expiresAt`. Kept separate from `CANCELLED` so that reconciliation can tell them apart.
- There is no `FAILED` state on `Payment`. A failed attempt does not end the Payment.

### Payment deadline

- `Payment.expiresAt` is required. It is sent to the provider when the payment URL is created: VNPay `vnp_ExpireDate`, ZaloPay `expire_duration_seconds`, Stripe Checkout `expires_at`.
- Default window: 30 minutes from `createdAt`. Allowed range: 30 minutes to 24 hours. This range fits Stripe Checkout's limits, so no provider needs an exception.
- Stripe PaymentIntent has no expiry, and VNPay does not document an automatic IPN at expiry. Core therefore enforces `expiresAt` itself for every gateway. The provider-side value is a backup, not the authority.
- At `expiresAt`, a scheduler first queries the provider for each non-terminal attempt. If the provider confirms payment, the result follows the normal success rule. If not, the attempt goes to `EXPIRED` (with a best-effort cancel at the provider) and the Payment goes to `EXPIRED`.
- Attempt deadlines never exceed `Payment.expiresAt`.
- A `PENDING` Payment with no `PaymentTransaction` also expires at `expiresAt`. No provider query is made for it.

### PaymentTransaction states

- `CREATED`: `attemptKey` assigned, gateway not yet called.
- `PENDING`: gateway accepted the attempt; awaiting the result.
- `SUCCEEDED`, `FAILED`, `EXPIRED`, `CANCELLED`: terminal, subject to the late-success rule below.
- `REQUIRES_REVIEW`: non-terminal. Used for non-binary outcomes (VNPay `vnp_ResponseCode=07` or `vnp_TransactionStatus=04`), for a success whose amount differs from `Payment.amount`, and for a late success on a closed Payment. While an attempt is in `REQUIRES_REVIEW`, the Payment accepts no new attempt (invariant 6b, enforced by the service).

### Triggers

- **Merchant API**: creates the Payment; cancels the Payment (`CANCELLED`).
- **Gateway IPN/webhook**: the authoritative source for `SUCCEEDED`, `FAILED` and `REQUIRES_REVIEW` on an attempt.
- **Browser return**: never sets `SUCCEEDED` or `FAILED`. It only enqueues a status query.
- **Scheduler**: closes the Payment and its attempts at `expiresAt`, after querying the provider. Polls attempts that receive no callback (for example ZaloPay, which sends callbacks only on success).
- **Core**: moves an attempt from `CREATED` to `PENDING` or `FAILED` based on the gateway's synchronous response, and performs gateway switches.

### Transitions

Payment:

| From | To | Triggered by | Condition |
|---|---|---|---|
| `PENDING` | `SUCCEEDED` | Webhook/IPN, query, or promotion of a late success | An attempt is `SUCCEEDED` with amount equal to `Payment.amount` |
| `PENDING` | `CANCELLED` | Merchant API | Non-terminal attempts are cancelled best-effort |
| `PENDING` | `EXPIRED` | Scheduler at `expiresAt` | Provider queried first and confirmed unpaid |

PaymentTransaction:

| From | To | Triggered by | Condition |
|---|---|---|---|
| `CREATED` | `PENDING` | Core, when the gateway accepts | |
| `CREATED` | `FAILED` | Core, when the gateway rejects synchronously | |
| `CREATED` or `PENDING` | `SUCCEEDED` | Webhook/IPN or query | Amount equals `Payment.amount` |
| `CREATED` or `PENDING` | `FAILED` | Webhook/IPN or query | Clear failure |
| `CREATED` or `PENDING` | `REQUIRES_REVIEW` | Webhook/IPN or query | Non-binary code, or amount differs |
| `PENDING` | `EXPIRED` | Scheduler at `expiresAt` | Provider queried first and confirmed unpaid |
| `CREATED` | `CANCELLED` | Core (gateway switch) | Best-effort cancel at the provider |
| `PENDING` | `CANCELLED` | Core (gateway switch or merchant cancel) | Best-effort cancel at the provider |
| `FAILED`, `EXPIRED` or `CANCELLED` | `SUCCEEDED` | Late success | Payment is `PENDING`, no attempt is `SUCCEEDED`, and the amount equals `Payment.amount` |
| `FAILED`, `EXPIRED` or `CANCELLED` | `REQUIRES_REVIEW` | Late success | Payment is `EXPIRED` or `CANCELLED`, another attempt is already `SUCCEEDED`, or the amount differs from `Payment.amount` |
| `REQUIRES_REVIEW` | (see Exit below) | Scheduled re-query, then operators | |

The webhook can arrive before Core records `PENDING`, so `CREATED` also accepts results.

### Gateway switch

- Core marks the current attempt `CANCELLED` at once, with a best-effort cancel at the provider, and then creates a new attempt. VNPay has no cancel API, so the old attempt may still be paid. If it is, the late-success rule applies.
- Invariant 6a still holds, because the old attempt is no longer `CREATED` or `PENDING` in Core.

### Merchant cancel

- Allowed while an attempt is in flight. Core cancels the attempts best-effort and sets the Payment to `CANCELLED`.
- A success that arrives later goes to `REQUIRES_REVIEW`. It is never promoted.
- Phase 1 records only the state. The refund flow is handled later.

### Late success

- A success reported for an attempt in `FAILED`, `EXPIRED` or `CANCELLED` is never dropped.
- If the Payment is still `PENDING` and no attempt is `SUCCEEDED`, the attempt moves to `SUCCEEDED` as a late success, and the Payment moves to `SUCCEEDED`. Other non-terminal attempts are cancelled best-effort. If one of them later also succeeds, it goes to `REQUIRES_REVIEW`.
- Otherwise (Payment `EXPIRED` or `CANCELLED`, another attempt already `SUCCEEDED`, or the amount differs from `Payment.amount`), the attempt goes to `REQUIRES_REVIEW`.

### Amount mismatch

- A success whose amount differs from `Payment.amount` moves the attempt to `REQUIRES_REVIEW`. The Payment stays `PENDING` and is not promoted.
- Because `REQUIRES_REVIEW` blocks new attempts, the customer cannot pay again while the review is open.

### Exit from REQUIRES_REVIEW

- Each attempt records a `review_reason`: `AMBIGUOUS_PROVIDER_STATUS`, `AMOUNT_MISMATCH`, `LATE_SUCCESS_ON_CLOSED_PAYMENT` or `DUPLICATE_SUCCESS`, plus `review_opened_at`.
- **Automatic**: `AMBIGUOUS_PROVIDER_STATUS` and `AMOUNT_MISMATCH` are re-queried on schedule. A clear answer (success or failure) is applied with the same rules as any other result.
- **Operator, after 72 hours** from `review_opened_at` with no clear answer. The operator may only set `SUCCEEDED` (if the amount equals `Payment.amount` and the Payment is `PENDING`) or `FAILED`. For `AMOUNT_MISMATCH` this means only `FAILED` is possible. A note is mandatory, and every action is recorded with its actor in the audit trail.
- **Refund flag**: whenever money was collected but the attempt is not `SUCCEEDED`, `refund_required` is set to `true`.
- `LATE_SUCCESS_ON_CLOSED_PAYMENT` and `DUPLICATE_SUCCESS` stay `REQUIRES_REVIEW` with `refund_required = true` until the RefundService effort exists. Operators may only add notes to them.

### Idempotency and concurrency

- Transitions are idempotent. Reaching a state that is already the target is a no-op.
- Conflicting results from the webhook and the query are resolved by the rules above.
- Row locking that serialises concurrent updates is decided in [PaymentService and Repository boundaries](08-payment-service-repository.md).

### Deferred

- The mechanism of the expiry job (BullMQ delayed job or periodic sweep) and its recovery when Redis loses the job: [Async reliability boundary](06-async-reliability-boundary.md).
- Refund for money collected on a `REQUIRES_REVIEW` attempt: the RefundService flow, out of scope for Phase 1 (only the data hook is in scope).
- Per-provider cancel support and the operations on the port: [PaymentGateway port](05-gateway-plugin-contract.md).
