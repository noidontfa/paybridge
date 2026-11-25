# 07: Callbacks list and detail

**What to build:** A developer opens Callbacks and sees what each PaymentGateway sent: PaymentGateway, provider event id, Attempt Key, status, delivery attempts, received time and processed time. They filter by PaymentGateway and status, and open a Callback to see its allow-listed headers, query, raw body (formatted when it is JSON) and last error, with a link to the Payment when the Attempt Key is known.

See [spec](../spec.md): Callbacks (stories 70–74); Implementation Decisions › API contract (Callbacks list and detail).

**Blocked by:** 03: Payments list.

**Status:** resolved

- [x] The fixture store includes Callbacks in every inbox status (`RECEIVED`, `PROCESSING`, `PROCESSED`, `FAILED`), some with an unknown Attempt Key.
- [x] The mock serves the Callbacks list (`gatewayId`, `status`, cursor pagination) and detail.
- [x] The list reuses the shared data table, URL state and status badges (Callback status added to the badge mapping).
- [x] The detail shows the raw body as text, pretty-printed when it parses as JSON, with copy; it never executes or renders it as HTML.
- [x] The Payment link appears only when the Attempt Key matches a PaymentTransaction.
- [x] Loading, empty, not-found and error states.
- [x] Screen tests: filters, JSON and non-JSON bodies, a failed Callback with last error, unknown Attempt Key.

## Answer

`/callbacks` is the Callbacks list (filters Gateway and Status, newest first, "Load more") and `/callbacks/[id]` the detail. Tests: handler and seed test (`src/mocks/callbacks.test.ts`), a badge mapping case, a screen test for list and detail (`src/components/callbacks/callbacks-screen.test.tsx`: filters, URL start state, clear, empty, error and retry, JSON body, non-JSON body, markup shown as text, failed Callback with last error, unknown and absent Attempt Key, loading, not found), and Playwright `e2e/callbacks.spec.ts`.

Decisions to know about:

- **Endpoints** (mocked): `GET /internal/callbacks` with `gatewayId`, `status` (`RECEIVED`, `PROCESSING`, `PROCESSED`, `FAILED`), `cursor`, `limit`; newest `receivedAt` first, ties on id. Items: `id`, `gatewayId`, `providerEventId` (nullable), `attemptKey` (nullable), `status`, `attempts`, `receivedAt`, `processedAt` (nullable). A bad status answers 400 `VALIDATION_FAILED`. `GET /internal/callbacks/:id` adds `headers`, `query` (string maps), `rawBody` (text), `lastError` and `paymentId`; unknown id is 404 `CALLBACK_NOT_FOUND`. **`paymentId` is resolved by the server** from the Attempt Key (null when it matches no PaymentTransaction); the Console shows "View Payment" only when it is set.
- **No sort and no search** on this list; `CALLBACK_LIST_URL_CONFIG` has `sortable: []`, and every column has `enableSorting: false`.
- **Body**: `formatBody` pretty-prints JSON objects and arrays and leaves anything else untouched; it is rendered as text inside `<pre>`, never as HTML. The Copy button copies the original body, not the pretty-printed one.
- **Seed** (`src/mocks/seed-callbacks.ts`, own `Random`, so Payments did not change): Callbacks for about half the PaymentTransactions that reached a gateway, plus every inbox status, FAILED with a last error, unknown Attempt Keys, one with none, one without an event id, and one non-JSON markup-looking body.
- Shared files touched additively: `MockStore` got a `callbacks` array (last constructor parameter) and `getCallback`; `createHandlers` spreads `callbacksHandlers`; `createSeededStore` calls `seedCallbacks`; `status-badges` got the `callback` kind.

Reuse notes for ticket 08 (Gateways):

- **Link to a filtered Callbacks list** with `/callbacks?gatewayId=<id>` (and `&status=FAILED`); the list reads those params. Likewise `/payments?gatewayId=<id>`.
- **Counts by status and last Callback time** can be computed from `store.callbacks` (`status`, `gatewayId`, `receivedAt`); "last 24 hours" is relative to `store.now`.
- `StatusBadge kind="callback"` renders inbox statuses; `CALLBACK_STATUSES` is exported from `src/lib/api/callbacks.ts`.
- Detail pattern to copy: `CallbackDetailScreen` (skeleton with `role="status"`, `NotFoundState` for `isApiError(error) && error.isNotFound`, `ErrorState` with retry), `Field`-style `dl` summary, and `CopyButton`. Detail pages pass `current={id}` to `PageHeader` for the breadcrumb.
- The mock 404 helper pattern: a handler factory takes `badRequest` and `notFound` response builders from `createHandlers` (see `callbacksHandlers`).
