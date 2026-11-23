# 26: Webhook inbox sweep

Status: ready-for-agent

**What to build:** A callback that was stored but not finished processing is picked up again. A worker that crashed mid-processing does not block the callback. A permanent error is kept visible and raises an alert.

**Blocked by:** 19: Process webhook

- [ ] A row in `PROCESSING` whose lock time is more than 5 minutes old is reset to `RECEIVED`. A row locked more recently is not touched.
- [ ] `RECEIVED` rows are dispatched for processing.
- [ ] `FAILED` rows are retried. The attempt count increases on each try, and the last error is recorded.
- [ ] After 5 failed retries, the row stays `FAILED` and an alert is raised. A test checks the alert.
- [ ] The sweep is one repeatable schedule across instances.
- [ ] Processing the same row twice does not apply its change twice.
