# 06: Review resolution

**What to build:** An Operator resolves a Review from the Exceptions sheet or from the Payment detail page. The form offers only what Core allows: `AMBIGUOUS_PROVIDER_STATUS` may resolve to `SUCCEEDED` (only when the Payment is `PENDING`, with the collected amount equal to the Payment Amount) or `FAILED`; `AMOUNT_MISMATCH` may resolve only to `FAILED`; `LATE_SUCCESS_ON_CLOSED_PAYMENT` and `DUPLICATE_SUCCESS` allow only "add note"; nothing is resolvable before the Review has been open for 72 hours. A note is mandatory. A status change asks for confirmation. The Operator's identity is added by the BFF, never typed. After success the Operator sees a toast, and the list, badge, Overview and Payment detail are updated. When Core refuses, the API's message appears in the form and the note is kept.

See [spec](../spec.md): Exceptions (stories 53–62), Payment detail story 42, Navigation story 8, Platform story 89; Implementation Decisions › Auth seam, Data path (actor), API contract (`POST /internal/payments/:id/review-resolution`), Mock mode (resolution handler), Modules (Review resolution rules, Query layer).

**Blocked by:** 05: Exceptions list and Review sheet (read-only).

**Status:** ready-for-agent

- [ ] One module provides the current Operator (id and display name) from configuration; the sidebar footer shows it, and the BFF sets `actor` from it on the resolution call, ignoring any `actor` from the browser.
- [ ] A pure rules module returns, for a Review, its Payment and the current time, which actions are allowed and why the others are not.
- [ ] The form uses React Hook Form with Zod: note required, trimmed, at most 2000 characters with a counter; amount required for `SUCCEEDED` and compared as a decimal string.
- [ ] A confirmation dialog appears before a status change; "add note" does not need one.
- [ ] The mock resolution handler applies Core's rules, mutates the fixture store, writes a status transition (`operator_resolution` or `operator_note`) with actor and note, writes a Payment Event when the Payment status changes, and rejects invalid requests with the API's error shape and status code.
- [ ] On success: Sonner toast; the Reviews list, Reviews summary, Payment detail and Overview queries are invalidated.
- [ ] On rejection: the API message shows in the form and the note is kept.
- [ ] The same Review panel with its actions appears in the PaymentTransaction timeline on the Payment detail page.
- [ ] Unit tests cover every branch of the rules module.
- [ ] Screen tests: each review reason offers the right actions, the 72-hour lock, amount validation, required note, and a rejected resolution.
- [ ] A Playwright test resolves an `AMBIGUOUS_PROVIDER_STATUS` Review to `FAILED` with a note and sees the badge, list and Payment detail update.
