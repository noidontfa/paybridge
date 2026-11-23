# 13: Idempotency-Key on create

Status: ready-for-agent

**What to build:** A network retry of `POST /payments` cannot create a second Payment. The merchant sends an `Idempotency-Key` header; the first response is stored and replayed for the same key and body.

**Blocked by:** 12: Create Payment

- [ ] Same key and same request body returns the stored response; no second Payment is created.
- [ ] Same key with a different body returns `422`.
- [ ] A new key whose upstream reference already exists returns `409` with the id of the existing Payment.
- [ ] The idempotency record stores the request hash, response status, response body, Payment id (when created), creation time and expiry time (24 hours).
- [ ] The idempotency record commits in the same transaction as the Payment and its outbox row.
- [ ] Two concurrent requests with the same key create exactly one Payment.
- [ ] Gateway retries are not covered by this key; they use the attempt key (ticket 15).
- [ ] A request without the header is accepted as an ordinary create. The spec does not say this; confirm before implementation.
