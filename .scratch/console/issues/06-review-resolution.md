# 06: Review resolution

**What to build:** An Operator resolves a Review from the Exceptions sheet or from the Payment detail page. The form offers only what Core allows: `AMBIGUOUS_PROVIDER_STATUS` may resolve to `SUCCEEDED` (only when the Payment is `PENDING`, with the collected amount equal to the Payment Amount) or `FAILED`; `AMOUNT_MISMATCH` may resolve only to `FAILED`; `LATE_SUCCESS_ON_CLOSED_PAYMENT` and `DUPLICATE_SUCCESS` allow only "add note"; nothing is resolvable before the Review has been open for 72 hours. A note is mandatory. A status change asks for confirmation. The Operator's identity is added by the BFF, never typed. After success the Operator sees a toast, and the list, badge, Overview and Payment detail are updated. When Core refuses, the API's message appears in the form and the note is kept.

See [spec](../spec.md): Exceptions (stories 53–62), Payment detail story 42, Navigation story 8, Platform story 89; Implementation Decisions › Auth seam, Data path (actor), API contract (`POST /internal/payments/:id/review-resolution`), Mock mode (resolution handler), Modules (Review resolution rules, Query layer).

**Blocked by:** 05: Exceptions list and Review sheet (read-only).

**Status:** resolved

- [x] One module provides the current Operator (id and display name) from configuration; the sidebar footer shows it, and the BFF sets `actor` from it on the resolution call, ignoring any `actor` from the browser.
- [x] A pure rules module returns, for a Review, its Payment and the current time, which actions are allowed and why the others are not.
- [x] The form uses React Hook Form with Zod: note required, trimmed, at most 2000 characters with a counter; amount required for `SUCCEEDED` and compared as a decimal string.
- [x] A confirmation dialog appears before a status change; "add note" does not need one.
- [x] The mock resolution handler applies Core's rules, mutates the fixture store, writes a status transition (`operator_resolution` or `operator_note`) with actor and note, writes a Payment Event when the Payment status changes, and rejects invalid requests with the API's error shape and status code.
- [x] On success: Sonner toast; the Reviews list, Reviews summary, Payment detail and Overview queries are invalidated.
- [x] On rejection: the API message shows in the form and the note is kept.
- [x] The same Review panel with its actions appears in the PaymentTransaction timeline on the Payment detail page.
- [x] Unit tests cover every branch of the rules module.
- [x] Screen tests: each review reason offers the right actions, the 72-hour lock, amount validation, required note, and a rejected resolution.
- [x] A Playwright test resolves an `AMBIGUOUS_PROVIDER_STATUS` Review to `FAILED` with a note and sees the badge, list and Payment detail update.

## Answer

An Operator resolves a Review, or adds a note, from the Exceptions sheet and from the Payment detail timeline. Both render the same `ReviewPanel`, which now takes a `payment` prop (`TransactionTimeline` has one too; `ReviewSheet` and `PaymentDetailScreen` pass the `OperatorPayment`) and holds the form while the Review is open.

Decisions to know about:

- **Auth seam**: `src/server/current-operator.ts` (`getCurrentOperator()`, from `CONSOLE_OPERATOR_ID` and `CONSOLE_OPERATOR_NAME`; default id `operator`, name `Operator`, which is also the seed's actor) is the one module that knows the identity. The root layout gives it to the UI through `OperatorProvider`, and `useCurrentOperator()` (`src/lib/operator.tsx`) reads it; the sidebar footer shows name and id. Real authentication replaces only `current-operator.ts` and adds a Next middleware check; no middleware exists yet.
- **BFF**: `src/server/bff-proxy.ts` sets `actor` on `POST /internal/payments/:id/review-resolution` bodies from the seam and overwrites any `actor` the browser sent. A body that is not a JSON object goes through unchanged, so the API rejects it. Other writes are untouched.
- **Rules module** `src/lib/review-resolution-rules.ts`: `reviewActions(facts, now)` returns `{ open, locked, succeed, fail, note }`, each `{ allowed: true }` or `{ allowed: false, reason }`. Not open: nothing. Under 72 hours (or no opened time): nothing, notes included. Then `AMBIGUOUS_PROVIDER_STATUS`: SUCCEEDED (only when the Payment is `PENDING`) and FAILED; `AMOUNT_MISMATCH`: FAILED; late success and duplicate: note only. A note alone is not offered for the two status-resolvable reasons (Core says they take a status). The form lists all three options and disables the ones not allowed with the reason shown.
- **Form** (`resolution-form.tsx`, schema in `src/lib/review-resolution-form.ts`): React Hook Form with `zodResolver`; note trimmed, required, at most 2000 characters with a `n / 2000` counter; for SUCCEEDED an amount that is a decimal string and equals the Payment Amount, compared with `compareDecimal`, never as a float. A status change opens an alert dialog (`ui/alert-dialog.tsx`, Base UI); a note does not. The form never has an actor field.
- **Mutation** (`useResolveReview`): the success toast is raised in the hook-level `onSuccess`, because the refetch closes the Review and unmounts the form before per-call callbacks run. It invalidates `reviewKeys.all`, `paymentKeys.all` (detail and Payments list) and `overviewKeys.all`. `Toaster` is now mounted in the root layout. On rejection `mutation.error.message` (the API's message) shows in a `role="alert"` and the form, note included, is left as it was.
- **Mock handler** `src/mocks/review-resolution.ts` (`resolveReview(store, paymentId, body)` plus the MSW handler). Errors use the API envelope: 400 `VALIDATION_FAILED` (actor, attempt id, note 1 to 2000 trimmed, status, amount decimal and required for SUCCEEDED); 404 `PAYMENT_NOT_FOUND`, `PAYMENT_TRANSACTION_NOT_FOUND`; 409 `REVIEW_NOT_OPEN`, `REVIEW_NOT_RESOLVABLE_YET`, `PAYMENT_NOT_PENDING`; 422 `AMOUNT_DOES_NOT_MATCH`, `RESOLUTION_NOT_ALLOWED`. Success answers `{ paymentId, attemptId, attemptStatus, paymentStatus }`. Effects: resolution sets the attempt to SUCCEEDED or FAILED (the review reason stays, so it is a closed Review) and clears `refundRequired`, with an `operator_resolution` transition; SUCCEEDED also succeeds the Payment with its own transition and an unpublished `PaymentSucceeded` event (FAILED leaves the Payment `PENDING` and writes no event); a note writes an `operator_note` transition (`REQUIRES_REVIEW` to itself) and leaves the Review open.
- **Mock clock**: `MockStore.clock` (default the real clock) decides "now" for the 72-hour rule and transition times, since the UI compares against the browser clock while `store.now` is the fixed seed time. Tests set it.
- **Testing the actor**: screen tests have no BFF, so `review-panel.test.tsx` puts a handler first that adds `actor` and calls `resolveReview`, and asserts what the browser sent has none.
- **Playwright**: `e2e/review-resolution.spec.ts` changes the shared mock store, so `playwright.config.ts` has a second project, `mutations`, that depends on `chromium` (which ignores that spec). The spec picks its Review from the live mock API, so a reused dev server still works.
- New dependencies: `react-hook-form`, `@hookform/resolvers`.
