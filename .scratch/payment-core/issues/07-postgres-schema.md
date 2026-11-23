Labels: wayfinder:grilling
Type: grilling
Status: open
Blocked by: 02, 03, 04, 06

# PostgreSQL schema (Prisma draft)

## Question

Produce the Phase 1 PostgreSQL schema as a Prisma draft in `spec.md`. The draft is not applied as a migration in this effort. Decide:

1. The concrete tables and their columns, following the ownership convention from ticket 02.
2. Column types and the amount representation from ticket 03.
3. Constraints: primary keys, foreign keys, unique constraints on the upstream reference, on the provider transaction reference, and on the idempotency key.
4. Indexes for the lookups the state machine and the Webhook Inbox need.
5. Tables required by the async boundary from ticket 06 (Outbox, Webhook Inbox, Idempotency).
6. The migration strategy for Phase 2 (for example, one initial migration versus incremental migrations).

## Answer

<!-- filled in on resolution -->
