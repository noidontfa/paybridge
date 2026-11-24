# 24: Expiry worker queries before closing

Status: resolved

**What to build:** A Payment with open attempts is expired only after the provider has confirmed that each attempt is unpaid. If the provider shows a payment made just before the deadline, that payment is applied as a success, not as an expiry.

**Blocked by:** 20: Browser return and status query; 23: Expiry sweep and no-attempt expiry

- [x] Transaction 1 locks the Payment, checks it is `PENDING` with a passed deadline, and reads its open attempts. Then it releases the lock.
- [x] No database transaction is open while the provider is queried.
- [x] Transaction 2 locks the Payment again, re-checks the state, applies the results, and writes `PaymentExpired` when the Payment expires.
- [x] The Payment moves to `EXPIRED` only when every open attempt was queried and the provider confirmed it unpaid. Any unclear answer leaves the Payment `PENDING` for the next sweep.
- [x] A provider result showing payment just before the deadline is applied as success under the rules in tickets 19 and 21.
- [x] If the Payment changed while the queries ran, the result follows the rules for its new state and nothing is overwritten.
- [x] Attempts that are closed by expiry are cancelled best-effort after commit, and their transitions are recorded.
- [x] Provider queries are rate limited, so a burst of expiries stays under the configured rate. A test checks this.
- [x] Tests use a fake clock and cover the case of a confirmed payment just before the deadline.
