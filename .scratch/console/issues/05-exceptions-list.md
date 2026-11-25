# 05: Exceptions list and Review sheet (read-only)

**What to build:** An Operator sees the number of open Reviews as a badge on the Exceptions item in the sidebar, opens Exceptions, and gets a work queue of open Reviews, oldest first. Each row shows the review reason, PaymentGateway, Payment Amount, provider-reported amount when known, how long the Review has been open, and whether a refund is required. They can filter by review reason and PaymentGateway, and switch to closed Reviews. Clicking a row opens a side sheet with the Review panel: the Payment summary, the PaymentTransaction and its status history. The sheet state is in the URL. "Exceptions" is a UI label only; the domain term and wire names stay "review".

See [spec](../spec.md): Exceptions (stories 46–52), Navigation story 3; Implementation Decisions › Sidebar, API contract (Reviews list, Reviews summary), Modules (Review panel).

**Blocked by:** 02: Payment detail through the BFF and mock mode; 03: Payments list.

**Status:** resolved

- [x] The mock serves the Reviews list (`reason`, `gatewayId`, `state`, default sort `reviewOpenedAt` ascending, cursor pagination, with Payment summary, provider-reported amount and `resolvableAt`) and the Reviews summary (open count, total and by reason).
- [x] The sidebar badge shows the open Review count and hides at zero.
- [x] The Exceptions page reuses the shared data table and URL state.
- [x] The Review panel is one component, reused later on the Payment detail page; in this ticket it shows no actions, but shows when the Review becomes resolvable if it has been open for less than 72 hours.
- [x] The sheet opens from a row, closes with Escape, and its selected PaymentTransaction is kept in the URL.
- [x] Empty state when there are no open Reviews; error state with retry.
- [x] Screen tests: filters, open and closed, the sheet content for each review reason, the 72-hour hint, the badge count.

## Answer

`/exceptions` is the Exceptions work queue: open Reviews, oldest first, with a side sheet per Review, and an open-Review count badge on the sidebar item. "Exceptions" is a UI label only; paths, types and wire names say `review`. Tests: a handler test for the mocked endpoints, screen tests (filters, open and closed, the sheet for each review reason, the 72-hour hint, empty and error states, URL start state), a sidebar badge test, seed tests, and Playwright `e2e/exceptions.spec.ts` (badge, list, filter, sheet open, reload, Escape, closed).

Decisions to know about:

- **A Review is a PaymentTransaction with a review reason**; its id is the Attempt Key. `state=open` means the PaymentTransaction is still `REQUIRES_REVIEW`; `closed` means it has a review reason and a later status (it was resolved). The seed now holds closed Reviews (`REQUIRES_REVIEW` then `FAILED`, trigger `operator_resolution`, actor `operator`) and a `providerReportedAmount` on every `AMOUNT_MISMATCH` Review (90% of the Payment Amount).
- **`GET /internal/reviews`**: `reason`, `gatewayId`, `state` (default `open`), `sort` (`reviewOpenedAt` only), `order` (default `asc`), `cursor`, `limit`. Items: `id`, `reason`, `state`, `gatewayId`, `transactionStatus`, `refundRequired`, `reviewOpenedAt`, `resolvableAt` (opened plus 72 hours), `providerReportedAmount` (or null) and a `payment` summary (`id`, `upstreamReference`, `amount`, `currency`, `status`). Bad values answer 400 `VALIDATION_FAILED`.
- **`GET /internal/reviews/summary`**: `{ open, total, byReason }`; `total` counts open and closed, `byReason` counts open Reviews. Schemas and client functions are in `src/lib/api/reviews.ts`; handlers in `src/mocks/reviews.ts` (`queryReviews`, `summarizeReviews`).
- **The operator Payment detail attempt gained an optional `providerReportedAmount`**, so the Review panel can show it without a second call.
- **Sheet state in the URL**: `?payment=<Payment id>&transaction=<Attempt Key>`, next to the table's own params. The sheet loads the Payment detail (`usePayment`), so it opens on reload even when the Review is not on the loaded page. Changing a filter drops the sheet params; opening and closing the sheet keeps the filters. Escape or the close button removes them (`router.replace`).
- **Open state** is the "Open" and "Closed" buttons in the toolbar (`state=closed` in the URL; open is the default and left out). Clear filters clears reason and gateway, not the state.
- **Row opening**: `DataTable` gained an optional `onRowOpen` (and `getRowHref` became optional). The reason badge is a button, which is the keyboard path; a click elsewhere on the row opens the sheet too.
- **Sidebar badge**: `NavItem.liveBadge: 'openReviews'` renders `OpenReviewsBadge` (a query, `useReviewSummary`), hidden at zero and while unknown, with an accessible label such as "7 open Reviews". `Providers` (the QueryClient) now wraps the whole shell in `layout.tsx`, because the sidebar is a query consumer now.
- **72-hour hint** compares `reviewOpenedAt` plus 72 hours with the browser clock; it shows "Resolvable from <time>" while the Review is open and younger than 72 hours. In mock mode the seed clock is fixed (`SEED_NOW`), so seeded Reviews age as the real clock moves.
- `PLAYWRIGHT_PORT` overrides the e2e port (default 3100), so parallel worktrees do not reuse each other's dev server.

How ticket 06 plugs in resolution:

- **The Review panel is `ReviewPanel`** (`src/components/review/review-panel.tsx`, renamed from `ReviewNotice`). It takes the `OperatorAttempt`, and is already rendered both in the sheet and in the Payment detail timeline (`TransactionTimeline`). Add the resolution actions and form inside it. It needs the Payment too (status, amount) for the rules module, so add a `payment` prop and pass it from `TransactionTimeline` (add a `payment` prop there; `ReviewSheet` and `PaymentDetailScreen` both have the `OperatorPayment`). `resolvableFrom(openedAt, now)` is exported for the 72-hour lock.
- **Invalidate** `reviewKeys.all` (list and summary; `src/lib/queries/reviews.ts`), `paymentKeys.detail(id)` and `overviewKeys.all` after a resolution.
- **Mock side**: mutate `store.attempts` (set status; `reviewReason` stays, which is what makes the Review "closed"), push a status transition and a Payment Event; add the handler next to `reviewHandlers` or in `handlers.ts`. The list and summary are computed from the store on each request, so they update by themselves.
- **Not done here**: any action, the form, the confirmation, the Operator identity.
