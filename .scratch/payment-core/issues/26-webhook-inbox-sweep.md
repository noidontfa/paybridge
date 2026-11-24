# 26: Webhook inbox sweep

Status: resolved

**What to build:** A callback that was stored but not finished processing is picked up again. A worker that crashed mid-processing does not block the callback. A permanent error is kept visible and raises an alert.

**Blocked by:** 19: Process webhook

- [x] A row in `PROCESSING` whose lock time is more than 5 minutes old is reset to `RECEIVED`. A row locked more recently is not touched.
- [x] `RECEIVED` rows are dispatched for processing.
- [x] `FAILED` rows are retried. The attempt count increases on each try, and the last error is recorded.
- [x] After 5 failed retries, the row stays `FAILED` and an alert is raised. A test checks the alert.
- [x] The sweep is one repeatable schedule across instances.
- [x] Processing the same row twice does not apply its change twice.
