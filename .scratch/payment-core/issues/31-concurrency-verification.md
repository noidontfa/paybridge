# 31: Concurrency verification

Status: resolved

**What to build:** The locking and transaction rules are proven against real PostgreSQL with competing operations, not just by reading the code. Webhooks, expiry, merchant cancel and new attempts cannot interleave in a way that breaks the invariants.

**Blocked by:** 17: Merchant cancel; 21: Late success handling; 24: Expiry worker queries before closing

- [x] Two competing transitions on the same Payment serialise: the second waits for the first to commit (two real connections).
- [x] A webhook success racing with expiry ends in one consistent outcome. The Payment is never both `SUCCEEDED` and `EXPIRED`.
- [x] A merchant cancel racing with a start-attempt call leaves at most one open attempt, and no attempt is created on a cancelled Payment.
- [x] Concurrent attempts that would create a second open attempt are rejected by the database partial index.
- [x] No database transaction is open during any gateway call in these races. A test checks this with a blocking fake gateway.
- [x] The tests run in CI against a real PostgreSQL 18 instance.
