# 05: Exceptions list and Review sheet (read-only)

**What to build:** An Operator sees the number of open Reviews as a badge on the Exceptions item in the sidebar, opens Exceptions, and gets a work queue of open Reviews, oldest first. Each row shows the review reason, PaymentGateway, Payment Amount, provider-reported amount when known, how long the Review has been open, and whether a refund is required. They can filter by review reason and PaymentGateway, and switch to closed Reviews. Clicking a row opens a side sheet with the Review panel: the Payment summary, the PaymentTransaction and its status history. The sheet state is in the URL. "Exceptions" is a UI label only; the domain term and wire names stay "review".

See [spec](../spec.md): Exceptions (stories 46–52), Navigation story 3; Implementation Decisions › Sidebar, API contract (Reviews list, Reviews summary), Modules (Review panel).

**Blocked by:** 02: Payment detail through the BFF and mock mode; 03: Payments list.

**Status:** ready-for-agent

- [ ] The mock serves the Reviews list (`reason`, `gatewayId`, `state`, default sort `reviewOpenedAt` ascending, cursor pagination, with Payment summary, provider-reported amount and `resolvableAt`) and the Reviews summary (open count, total and by reason).
- [ ] The sidebar badge shows the open Review count and hides at zero.
- [ ] The Exceptions page reuses the shared data table and URL state.
- [ ] The Review panel is one component, reused later on the Payment detail page; in this ticket it shows no actions, but shows when the Review becomes resolvable if it has been open for less than 72 hours.
- [ ] The sheet opens from a row, closes with Escape, and its selected PaymentTransaction is kept in the URL.
- [ ] Empty state when there are no open Reviews; error state with retry.
- [ ] Screen tests: filters, open and closed, the sheet content for each review reason, the 72-hour hint, the badge count.
