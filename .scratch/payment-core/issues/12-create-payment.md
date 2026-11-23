# 12: Create Payment

Status: ready-for-agent

**What to build:** A merchant can create a Payment for an order. `POST /payments` takes an amount in VND, an upstream reference and an optional expiry, and returns the Payment id and status `PENDING`. No attempt is created in this ticket.

**Blocked by:** 10: Transaction runner, repositories and queue connection

- [ ] A valid request returns the Payment id, status `PENDING` and the expiry time.
- [ ] Omitted expiry defaults to 30 minutes after creation.
- [ ] Expiry below 30 minutes or above 24 hours after creation is rejected with a validation error.
- [ ] Only VND is accepted; other currencies are rejected.
- [ ] Zero or negative amounts are rejected, and amounts with more fraction digits than the currency allows are rejected.
- [ ] An empty upstream reference is rejected.
- [ ] A duplicate upstream reference is rejected by the database constraint. The 409 response with the existing Payment id is completed in ticket 13.
- [ ] The Payment row and the `PaymentCreated` outbox row are written in one transaction. If either fails, neither is stored.
- [ ] No attempt is created.
- [ ] No later code path changes the amount or the upstream reference.
