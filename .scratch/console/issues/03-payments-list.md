# 03: Payments list

**What to build:** An Operator opens Payments and sees a table of Payments (Upstream Reference, Amount, status, PaymentGateway and status of the latest PaymentTransaction, created time, Payment Expiry). They can search by Payment id or Upstream Reference, filter by status, PaymentGateway and created date range, sort by created time or Amount, and load more with cursor pagination. Every filter, sort and search lives in the URL, so the view can be shared and survives a reload. Clicking a row opens the Payment detail page. This ticket also delivers the shared data table and URL state modules that every later list reuses.

See [spec](../spec.md): Payments (stories 23–36); Implementation Decisions › API contract (Payments list), Modules (Data table, URL state).

**Blocked by:** 02: Payment detail through the BFF and mock mode.

**Status:** ready-for-agent

- [ ] The mock serves the Payments list endpoint with `status`, `gatewayId`, `q`, `createdFrom`, `createdTo`, sort, `cursor` and `limit`, returning `{ items, nextCursor }` from the fixture store.
- [ ] One shared TanStack Table setup provides server-side sorting, filtering and cursor pagination, a toolbar with filter controls, the density from Settings, and the loading, empty and error states.
- [ ] One URL state module maps search params to and from table state; changing a filter resets the cursor.
- [ ] The empty state for "no match" offers to clear the filters; the error state offers retry.
- [ ] Rows are keyboard-reachable and open the Payment detail page.
- [ ] At phone width the table stays usable (horizontal scroll inside the table only, or a reduced column set).
- [ ] Screen tests: filtering by status and gateway, search, sort, loading the next page, empty and error states.
- [ ] Unit tests cover the URL state mapping.
- [ ] A Playwright test filters Payments, reloads, sees the same view, and opens a Payment.
