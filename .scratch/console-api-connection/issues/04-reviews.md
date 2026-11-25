# 04: Reviews list and summary

**What to build:** `GET /internal/reviews` and `GET /internal/reviews/summary`, so the Console's Exceptions page and the sidebar badge work on real data. A Review is a PaymentTransaction with a review reason; "Exceptions" is a UI label only.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] The list filters by review reason, gateway, state (`open` or `closed`, default `open`) and search, sorts by the time the Review opened (default oldest first), and pages by cursor
- [ ] `open` means the PaymentTransaction is still `REQUIRES_REVIEW`; `closed` means it had a review reason and has since been resolved
- [ ] Each item has the Payment summary, refund-required flag, `resolvableAt` (opened time plus 72 hours) and the provider-reported amount only where one exists
- [ ] The summary returns open count, total (open and closed) and open counts by reason
- [ ] Integration tests cover every review reason, open and closed state, a Review younger and older than 72 hours, and the filters, and validate responses against the copied Console schemas
- [ ] The Console's Exceptions page and badge, with mocks turned off, show seeded Reviews
- [ ] Resolving a seeded Review from the Console through the existing review-resolution route succeeds and the list, badge and Payment detail reflect it
