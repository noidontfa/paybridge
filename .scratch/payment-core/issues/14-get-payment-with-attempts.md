# 14: Get Payment with attempts

Status: ready-for-agent

**What to build:** A merchant or support team can read a Payment with all its attempts to see its current state. `GET /payments/:id` is read only.

**Blocked by:** 12: Create Payment

- [ ] The response includes Payment id, upstream reference, amount, currency, status, expiry time and timestamps.
- [ ] The response includes every attempt with its id, gateway identifier, status, next action (when present), review reason and review opened time (when present), and refund-required flag.
- [ ] Raw gateway responses and provider metadata are not returned.
- [ ] An unknown Payment id returns `404`.
- [ ] The read writes no rows and takes no row lock.
