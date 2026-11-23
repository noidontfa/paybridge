# 10: Transaction runner, repositories and queue connection

Status: ready-for-agent

**What to build:** The internal plumbing that every later use case uses. There is one place that opens database transactions, a Payment repository that can lock a Payment row, the per-table repositories, and the BullMQ connection with job-id conventions. No endpoint is added in this ticket.

**Blocked by:** 09: Schema foundation

- [ ] The transaction runner is the only component that opens a database transaction; a check fails the build if any other module does.
- [ ] `findForUpdate` takes a `SELECT ... FOR UPDATE` lock on the Payment row; a second locker waits until the first commits (verified against real PostgreSQL).
- [ ] Repositories return domain objects and never expose database client types.
- [ ] A status-transition write records entity type, entity id, from-status, to-status, trigger, actor and reason, and commits or rolls back with the change it records.
- [ ] An outbox write commits or rolls back with the state change; a rolled-back change leaves no outbox row.
- [ ] Repositories exist for outbox, webhook inbox, idempotency keys and gateway raw responses.
- [ ] The BullMQ connection is configured once, and the job-id convention (outbox row id, payment id) is defined in one place.
- [ ] Covered by integration tests only; no endpoint is added.
