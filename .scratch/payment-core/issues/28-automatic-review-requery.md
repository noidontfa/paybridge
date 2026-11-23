# 28: Automatic review re-query

Status: ready-for-agent

**What to build:** Reviews that are caused by an unclear provider answer or an amount mismatch are re-checked on a schedule. Most close without an operator. Those still unclear after 72 hours are left for an operator.

**Blocked by:** 20: Browser return and status query

- [ ] A scheduled job re-queries only attempts in `REQUIRES_REVIEW` with reason `AMBIGUOUS_PROVIDER_STATUS` or `AMOUNT_MISMATCH`.
- [ ] A clear success with a matching amount promotes the Payment, following the rules in tickets 19 and 21.
- [ ] A clear failure moves the attempt to `FAILED`.
- [ ] A still-mismatched amount or an unclear answer leaves the attempt in review. It is queried again on the next run.
- [ ] Attempts with reason `LATE_SUCCESS_ON_CLOSED_PAYMENT` or `DUPLICATE_SUCCESS` are never re-queried for resolution.
- [ ] At 72 hours after the review opened, without a clear answer, the attempt is left for an operator. A fake-clock test checks this.
- [ ] Provider queries run with no transaction open. The state is re-checked under the Payment lock before writing.
