# 20: Browser return and status query

Status: ready-for-agent

**What to build:** When the customer returns from the gateway, the page shows the current stored state, even if the server notification has not arrived. The return itself never marks anything paid. It queues a status query, and the query applies the provider's answer by the same rules as webhooks.

**Blocked by:** 15: Start attempt; 19: Process webhook

- [ ] The browser return writes nothing to the database. A test confirms this.
- [ ] The browser return never sets an attempt to `SUCCEEDED` or `FAILED`.
- [ ] The browser return queues a status query for the attempt. The job can be rebuilt from the attempt row.
- [ ] The status query applies the provider result through the rules in ticket 19: success with matching amount, clear failure, pending (no change), or review.
- [ ] The return page shows the stored state, which may still be `PENDING`, and does not assume success.
- [ ] Repeating a status query for the same state does nothing.
- [ ] The queue connection comes from ticket 10.
