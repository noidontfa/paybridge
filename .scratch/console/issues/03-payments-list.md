# 03: Payments list

**What to build:** An Operator opens Payments and sees a table of Payments (Upstream Reference, Amount, status, PaymentGateway and status of the latest PaymentTransaction, created time, Payment Expiry). They can search by Payment id or Upstream Reference, filter by status, PaymentGateway and created date range, sort by created time or Amount, and load more with cursor pagination. Every filter, sort and search lives in the URL, so the view can be shared and survives a reload. Clicking a row opens the Payment detail page. This ticket also delivers the shared data table and URL state modules that every later list reuses.

See [spec](../spec.md): Payments (stories 23–36); Implementation Decisions › API contract (Payments list), Modules (Data table, URL state).

**Blocked by:** 02: Payment detail through the BFF and mock mode.

**Status:** resolved

- [x] The mock serves the Payments list endpoint with `status`, `gatewayId`, `q`, `createdFrom`, `createdTo`, sort, `cursor` and `limit`, returning `{ items, nextCursor }` from the fixture store.
- [x] One shared TanStack Table setup provides server-side sorting, filtering and cursor pagination, a toolbar with filter controls, the density from Settings, and the loading, empty and error states.
- [x] One URL state module maps search params to and from table state; changing a filter resets the cursor.
- [x] The empty state for "no match" offers to clear the filters; the error state offers retry.
- [x] Rows are keyboard-reachable and open the Payment detail page.
- [x] At phone width the table stays usable (horizontal scroll inside the table only, or a reduced column set).
- [x] Screen tests: filtering by status and gateway, search, sort, loading the next page, empty and error states.
- [x] Unit tests cover the URL state mapping.
- [x] A Playwright test filters Payments, reloads, sees the same view, and opens a Payment.

## Answer

`/payments` is the Payments list: a toolbar (search, Status, Gateway, Created from and to, Clear filters), a sortable table (Upstream Reference, Amount, Status, Gateway with the latest PaymentTransaction status, Created, Expires), and a "Load more" button. Search, filters and sort live in the URL. Tests: URL state unit tests, a handler test for the mocked endpoint, a screen test (filters, search, sort, load more, empty, error and retry, URL start state, row open), and Playwright `e2e/payments-list.spec.ts` (filter, reload, open; search and clear; load more; phone width; density).

Decisions to know about:

- **Endpoint**: `GET /internal/payments` with `status`, `gatewayId` (any PaymentTransaction), `q` (case-insensitive substring of the Payment id or Upstream Reference), `createdFrom` and `createdTo` (`YYYY-MM-DD`, UTC, both ends inclusive of the day), `sort` (`createdAt` or `amount`), `order` (`asc` or `desc`, default `desc`), `cursor`, `limit` (1 to 100, default 20). It returns `{ items, nextCursor }`; each item is the Payment plus `latestTransaction: { gatewayId, status } | null`. A bad `limit`, `cursor`, `sort` or date answers 400 `VALIDATION_FAILED` in the API error shape. Amount sorts as a decimal, not text; ties break on id so page boundaries are stable.
- **The cursor in the URL is the page the view starts at** (normally absent). "Load more" appends pages in memory (`useInfiniteQuery`), so a reload returns to the first page of the same view. Changing search, filter or sort resets the cursor.
- **Native `select` and `date` inputs** in the toolbar (keyboard and phone friendly, easy to test); Base UI selects are not used here.
- **Rows**: the Upstream Reference cell is a real `Link` (the keyboard path); a click elsewhere on the row calls `router.push`.
- **Density** follows Settings through the `data-density` attribute on the root element (Tailwind `in-data-[density=compact]:` on `TableCell`).
- **Phone width**: the table sits in a container that scrolls horizontally; the page does not.
- **Fix found by Playwright**: two URL changes in a row (status, then gateway) must build on each other, because the router applies `replace` later. `useTableUrlState` keeps the last written state until the URL catches up.
- `@tanstack/react-table` is v9 (`useTable`, `tableFeatures`, `createColumnHelper<features, Row>()`), not v8.

Reusable for tickets 05, 07, 08 and 09:

- **Data table** (`src/components/data-table/data-table.tsx`): `DataTable` takes `label`, `columns`, `rows`, `getRowId`, `getRowHref`, `sort` and `onSortChange`, `isLoading`, `isRefreshing`, `error` and `onRetry`, `emptyState`, `hasMore`, `isLoadingMore`, `onLoadMore`, `toolbar`. Build columns with `createDataTableColumnHelper<Row>()` and type them `DataTableColumns<Row>`; `meta: { align: 'right' }` right-aligns a column and `enableSorting: false` gives a plain header. The first failed load shows `ErrorState` with retry; a failed "load more" shows an inline alert with Retry.
- **Toolbar** (`src/components/data-table/toolbar.tsx`): `DataTableToolbar`, `SearchInput` (debounced 300 ms, follows the URL when it changes), `FilterSelect`, `DateFilter`, `ClearFiltersButton`. Hide `ClearFiltersButton` when there are no rows and render the "no match" empty state with its own Clear filters button, as `PaymentsScreen` does.
- **URL state**: pure `src/lib/url-state/table-url-state.ts` (`TableUrlConfig` with `filters`, `sortable`, `defaultSort`; `parseTableUrlState`, `tableUrlStateToSearchParams`, `changeTableUrlState`) and the hook `useTableUrlState(config)` returning `{ state, change, clear }`. Params are `q`, one per filter, `sort` and `order`, `cursor`; defaults are left out. The config must be a module-level constant.
- **List endpoint plumbing**: `listPageSchema(itemSchema)` and `ListQuery` in `src/lib/api/pagination.ts`; schema plus client function for a list in one file (`src/lib/api/payments-list.ts` is the template); an infinite query hook per list (`src/lib/queries/payments-list.ts` is the template: `useInfiniteQuery` with `keepPreviousData`, the cursor as the page param).
- **Mock side** (`src/mocks/payments-list.ts`): `readListWindow(params)`, `pageOf(rows, window)` and `BadQueryError` give every list the same cursor envelope and 400s; add an `xxxListHandlers(base, store, badRequest)` and spread it in `createHandlers`. `src/lib/decimal.ts` has `compareDecimal` for money.
- **Screen tests**: `src/test/fake-navigation.ts` is an in-memory `next/navigation`; use `vi.mock('next/navigation', async () => await import('@/test/fake-navigation'))` and `resetNavigation('/path?query')`; it also exports `currentLocation()` and `navigations`.
- `ui/table.tsx` holds the table primitives (shadcn style).
