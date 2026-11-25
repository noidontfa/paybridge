# 03: Payment detail for Operators

**What to build:** `GET /internal/payments/:id`: a Payment with every PaymentTransaction (oldest first, with Provider Reference and NextAction), each PaymentTransaction's status history, and the Payment's Payment Events, so the Console's Payment detail page works on real data.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] The response matches the Console's operator Payment detail contract
- [ ] Each PaymentTransaction carries its Provider Reference (when present), NextAction, review fields and its status transitions with from status, to status, trigger, actor, note and time
- [ ] The Payment's Payment Events are listed
- [ ] The gateway-switch Payment in the seed shows both attempts in order
- [ ] An unknown or non-UUID id returns 404 with the API's standard error response
- [ ] Integration tests over HTTP validate the response against the copied Console schema
- [ ] The Console's Payment detail page, with mocks turned off, renders a seeded Payment including a Review
