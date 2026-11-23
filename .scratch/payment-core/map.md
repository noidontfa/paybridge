Labels: wayfinder:map

# Map: Payment Core (Phase 1)

## Destination

A complete, English design spec for Phase 1 Payment Core, written to `.scratch/payment-core/spec.md`, plus the root `GLOSSARY.md` and any `docs/adr/` records the decisions require. It covers: the domain model and invariants of `Payment` and `PaymentTransaction`; their state machines; the `PaymentGateway` port that Core owns; the PostgreSQL schema (Prisma) on the shared `public` schema with a table-ownership convention; the async reliability boundary (Idempotency, Transactional Outbox, Webhook Inbox on BullMQ over Redis); and the `PaymentService` and `Repository` boundaries. No application code is written on this map.

## Notes

- **Domain**: PayBridge, a Single-Merchant Payment Hub. Multi-Merchant Platform is a future effort, not this one.
- **Context**: single context. Glossary at `GLOSSARY.md` (root). ADRs go in `docs/adr/`, created lazily.
- **Language**: every artifact saved in the repo is written in English. Discussion in chat is in Vietnamese.
- **Stack**: NestJS 12, Prisma 7, PostgreSQL 17, Redis 7. Queue is **BullMQ on Redis, mandatory**.
- **Database**: one shared PostgreSQL `public` schema. Ownership is expressed by a table-ownership convention (how it is expressed is decided in ticket 02).
- **Dependency rule**: Payment Core never depends on VNPay, ZaloPay or Stripe. Gateway plugins depend on the `PaymentGateway` port that Core defines. Core never imports a plugin.
- **Skills**: `grilling` and `domain-modeling` for grilling tickets; `research` for research tickets.
- **Settled at charting** (recorded here, no ticket): Phase 1 includes the Refund data hook but not the RefundService flow; Admin UI, Reconciliation/Settlement, Double-entry Ledger and Subscription/Tokenization are out of scope; Multi-Merchant is the next step after this effort.

## Decisions so far

<!-- one line per closed ticket: gist plus link -->

- [Research: gateway divergences from VNPay, ZaloPay and Stripe](issues/01-research-gateway-divergences.md): the providers disagree on initiation shape, reference timing, VND scaling, failure visibility, authoritative channel and refund idempotency; the port needs a `NextAction` union and Core needs its own `attemptId` separate from `providerRef`. Full sources in [research/gateway-divergences.md](research/gateway-divergences.md).

## Not yet specified

<!-- in-scope fog; graduates to a ticket once the question is sharp -->

- **Provider behaviours the research could not verify**: whether VNPay sends a late `00` IPN after `vnp_ExpireDate`; whether ZaloPay allows multiple sequential partial refunds on one `zp_trans_id`; how ZaloPay `/v2/refund` responds to a repeated `m_refund_id`; the ZaloPay callback retry interval. Hangs on vendor confirmation or sandbox testing, not on another ticket.
- **Refund data hook**: how a `Refund` attaches to `Payment` and `PaymentTransaction` (full vs partial, one vs many per payment) without designing the RefundService flow. Hangs on the state machine (ticket 04) and the gateway port (ticket 05).
- **Expiry of unpaid attempts**: how a `PaymentTransaction` that a customer abandons (for example, an unpaid VNPay redirect) is timed out, and which component performs the transition. Hangs on the state machine (ticket 04) and the async boundary (ticket 06).

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
