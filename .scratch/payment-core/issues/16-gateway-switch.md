# 16: Gateway switch

Status: resolved

**What to build:** A customer who wants another gateway starts a new attempt on the same Payment. The old open attempt is cancelled in the same locked step, and the provider is asked to cancel it on a best-effort basis.

**Blocked by:** 15: Start attempt

- [x] Starting a new attempt when an attempt is `CREATED` or `PENDING` cancels that attempt in the same locked transaction that creates the new one. At most one attempt is open afterwards.
- [x] The provider cancel runs after commit and is best-effort. A provider failure does not undo the local cancel.
- [x] The provider cancel is called only when the plugin declares `supportsCancel`. Otherwise it is skipped and logged as a defensive error.
- [x] Status transitions are recorded for both the cancelled attempt and the new attempt.
- [x] The switch uses the same endpoint as ticket 15; no separate endpoint is added.
- [x] An old attempt that the provider later reports as paid follows the late-success rule (ticket 21).
