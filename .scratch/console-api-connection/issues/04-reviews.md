# 04: Reviews list and summary

**What to build:** `GET /internal/reviews` and `GET /internal/reviews/summary`, so the Console's Exceptions page and the sidebar badge work on real data. A Review is a PaymentTransaction with a review reason; "Exceptions" is a UI label only.

**Blocked by:** 02

**Status:** resolved

- [ ] The list filters by review reason, gateway, state (`open` or `closed`, default `open`) and search, sorts by the time the Review opened (default oldest first), and pages by cursor
- [ ] `open` means the PaymentTransaction is still `REQUIRES_REVIEW`; `closed` means it had a review reason and has since been resolved
- [ ] Each item has the Payment summary, refund-required flag, `resolvableAt` (opened time plus 72 hours) and the provider-reported amount only where one exists
- [ ] The summary returns open count, total (open and closed) and open counts by reason
- [ ] Integration tests cover every review reason, open and closed state, a Review younger and older than 72 hours, and the filters, and validate responses against the copied Console schemas
- [ ] The Console's Exceptions page and badge, with mocks turned off, show seeded Reviews
- [ ] Resolving a seeded Review from the Console through the existing review-resolution route succeeds and the list, badge and Payment detail reflect it

## Answer

`GET /internal/reviews` and `GET /internal/reviews/summary` work on real PostgreSQL with the shapes of the Console's `reviewListSchema` and `reviewSummarySchema`. The Console browser criteria (Exceptions page and badge with mocks off) were not exercised in a browser; every response is parsed with the copied schemas in `apps/api/test/payment-core/console/reviews.int-spec.ts`, which also resolves a seeded Review through the existing review-resolution route and checks the list and summary change.

- Code: `console/reviews.module.ts`, `http/console/reviews.controller.ts` + `reviews-list.query.ts`, `application/use-cases/console/{list-reviews,get-review-summary}.ts`, `infrastructure/prisma/console-read/reviews-read.repository.ts`. Registered in `console-read.module.ts` (ticket 04 placeholders replaced). Contract copy: `test/contract/console/reviews.ts`.
- Definitions: a Review is a PaymentTransaction with `reviewReason` and `reviewOpenedAt`. `open` = status `REQUIRES_REVIEW`; `closed` = has a reason and status is anything else (Core keeps the reason after resolution). `resolvableAt` = opened + 72 h (`REVIEW_RESOLVABLE_AFTER_HOURS` in `list-reviews.ts`).
- Query: `reason`, `gatewayId`, `state` (default `open`), `q`, `order` (default `asc`), `sort` (only `reviewOpenedAt`), `limit`, `cursor`. Cursor tag is `reviewOpenedAt:<order>`; the id is the tiebreaker.
- Search `q`: Payment id or Attempt Key match exactly (UUID, any case); otherwise a case-insensitive substring of the Upstream Reference. The Console's comment says Attempt Key substring; partial UUIDs do not match (same as tickets 02).
- `providerReportedAmount` is read from `providerMetadata.providerReportedAmount` on the attempt (string or number, decimal-shaped), else null.
- Summary: `byReason` always has all four reasons (zero filled), counting open Reviews only.
- Migration `20261125040000_operator_reviews_list_index` adds index `core_payment_transactions_review_opened_idx` on `(review_opened_at, id)`.
