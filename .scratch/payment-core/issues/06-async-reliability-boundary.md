Labels: wayfinder:grilling
Type: grilling
Status: open
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

<!-- filled in on resolution -->
