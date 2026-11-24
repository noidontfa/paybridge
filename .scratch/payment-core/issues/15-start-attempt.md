# 15: Start attempt

Status: resolved

**What to build:** A customer chooses a gateway for a Payment and gets the next step for it. The attempt is stored before the gateway is called, then moves to `PENDING` with the next action, or to `FAILED` on a synchronous rejection. This is the first real use of the gateway port, exercised through the fake plugin.

**Blocked by:** 10: Transaction runner, repositories and queue connection; 11: Gateway port and Gateway Manager; 12: Create Payment

- [x] A new attempt is stored as `CREATED` with its attempt key (UUID v7) before the gateway is called. A test confirms the row exists when the gateway is called.
- [x] No database transaction is open during the gateway call.
- [x] When the gateway accepts, the attempt moves to `PENDING` and stores the provider reference (when given), next action, provider metadata, and the raw response, all in the final short transaction.
- [x] When the gateway returns `GatewayRejected`, the attempt moves to `FAILED`. The Payment stays `PENDING`, and the customer can start another attempt.
- [x] The gateway receives the attempt key, the amount as whole dong, the currency, the Payment expiry, the return URL and the description.
- [x] Starting an attempt on a Payment that is not `PENDING` is rejected.
- [x] Starting an attempt while another attempt is open is rejected until ticket 16 adds the switch.
- [x] The final write re-checks the Payment state. If the Payment became `CANCELLED` or `EXPIRED` during the call, the Payment is not changed, and the attempt result is handled by the late-success rules (ticket 21).
- [x] Other error categories (`GatewayUnavailable`, `OutcomeUnknown`) are handled in ticket 22.
