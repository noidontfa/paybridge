# 02: Payment detail through the BFF and mock mode

**What to build:** The first data path, end to end. An Operator opens a Payment by id and sees its full story: the summary (Amount in VND, status, Upstream Reference, Payment Expiry, times), every PaymentTransaction as a timeline oldest first (PaymentGateway, status, Attempt Key, Provider Reference, NextAction type, review reason and how long the Review has been open, refund required), each PaymentTransaction's status history from the audit trail (from, to, trigger, actor, note, time), and the Payment Events emitted for the Payment. The data comes from the browser through the Console's own path-preserving BFF to the API, which in mock mode is served by MSW in Node over a seeded fixture store. A banner shows when mock mode is on.

See [spec](../spec.md): Payment detail (stories 37–41, 43–45), Platform and quality; Implementation Decisions › Data path, API contract (operator Payment detail), Mock mode, Modules (API client, Formatting, Status badges); [ADR 0004](../../../docs/adr/0004-console-reaches-api-only-through-its-bff.md).

**Blocked by:** 01: Console skeleton.

**Status:** resolved

- [x] The BFF forwards a request to the API base URL with the same path, method, query and body; the browser never calls the API directly and no CORS is needed.
- [x] Mock mode is switched on by a server environment flag, is off by default and refuses to start in a production build; a visible banner shows when it is on.
- [x] The fixture store is seeded deterministically (fixed seed and fixed "now") with several hundred Payments covering every Payment status, PaymentTransaction status and review reason, gateway switches and late successes, using only the `stripe` and `fake` gateways, with matching status transitions and Payment Events.
- [x] The mock serves the operator Payment detail endpoint defined in the spec (the `GET /payments/:id` shape plus Provider Reference, status transitions per PaymentTransaction, and the Payment's Payment Events), and returns the API's error response shape for an unknown id.
- [x] Response types are copied into the Console as Zod schemas using the API's current wire names; the API client parses every response and turns failures into one typed error with the API's code and message.
- [x] Amounts are formatted as VND with `vi-VN` grouping from the decimal string, never via floating point; times show local absolute time and a relative hint.
- [x] One status badge mapping covers Payment status, PaymentTransaction status and review reason, with consistent label, tone and icon.
- [x] Payment id, Upstream Reference and Attempt Key can be copied with one click.
- [x] The page shows skeletons while loading, a not-found state for an unknown id, and an error state with retry; there is no cancel action.
- [x] Screen tests render the page with a real QueryClient and the shared MSW handlers (mapped to the BFF prefix): a Payment with a gateway switch, a PaymentTransaction in Review, not-found, and an API error.
- [x] Unit tests cover VND and date formatting, the badge mapping and the Zod schemas against sample responses.

## Answer

`/payments/[id]` shows the operator Payment detail end to end: browser, TanStack Query, `GET /api/bff/internal/payments/:id`, the BFF, then MSW over the seeded store in mock mode. Tests: unit (formatting, badges, schemas, seed, mock-mode flag, proxy), a screen test with a real QueryClient and the shared handlers mapped to `*/api/bff`, and Playwright (`e2e/payment-detail.spec.ts`).

Decisions to know about:

- **Endpoint**: the operator Payment detail is `GET /internal/payments/:id` (the internal prefix, as the spec says new admin read endpoints use). Its wire shape is the public `GET /payments/:id` plus per attempt `providerRef` and `transitions`, and a top-level `events`. A status transition keeps the API's column names (`fromStatus`, `toStatus`, `trigger`, `actor`, `reason`; the UI calls `reason` the "note"). Entity types are `PAYMENT`, `PAYMENT_TRANSACTION`, `REFUND`.
- **BFF prefix** is `/api/bff` (`src/lib/bff.ts`); the Route Handler is `src/app/api/bff/[...path]/route.ts` and delegates to `src/server/bff-proxy.ts`. An unreachable API gives a 502 with the API error shape and code `API_UNREACHABLE`.
- **Mock mode** (`src/mocks/mode.ts`): `CONSOLE_API_MOCKS=true` is read at server start in `src/instrumentation.ts`; it throws when `NODE_ENV=production`. Consequence: Playwright now runs `next dev`, not `next start` (a production build refuses mock mode). The layout is `force-dynamic` so the banner reads the runtime environment.
- **Not done here**: Review actions (the `ReviewNotice` component is read-only), the sidebar open-Review badge, the auth seam.

Extension points for tickets 03 to 09:

- **Schemas** (`src/lib/api/schemas.ts`): vocabularies (`PAYMENT_STATUSES`, `ATTEMPT_STATUSES`, `REVIEW_REASONS`, `PAYMENT_EVENT_TYPES`, entity types), `paymentEventSchema` and `statusTransitionSchema` are reusable by the Events and Audit log lists. Add one schema per endpoint. List endpoints still need a shared `{ items, nextCursor }` schema (ticket 03).
- **API client** (`src/lib/api/client.ts`): add a function per endpoint that calls `request(path, schema, { method, query, body })`. Failures are always `ApiError` (`status`, `code`, `message`; client codes `NETWORK_ERROR`, `INVALID_RESPONSE`). The path to use for operator routes starts with `/internal`.
- **Query layer** (`src/lib/queries/payments.ts`): key factory plus hook per resource. `Providers` (`src/components/providers.tsx`) holds the QueryClient and does not retry 4xx.
- **Store** (`src/mocks/store.ts`): `MockStore` holds flat arrays (`payments`, `attempts`, `transitions`, `events`) with accessors. Add a collection as another array and accessor, and mutate the arrays from handlers (ticket 06).
- **Seed** (`src/mocks/seed.ts`): `SCENARIOS` is a weighted table of stories, dealt round-robin so coverage never depends on the dice. Add a scenario to add a case; seed new collections in `createSeededStore`. `SEED_NOW` is the fixed "now". Randomness comes from `src/mocks/random.ts`.
- **Handlers** (`src/mocks/handlers.ts`): `createHandlers({ baseUrl, store })` returns the handler array; use `apiError(request, {...}, store.now)` for the API error envelope. Screen tests do `setupServer(...createHandlers({ baseUrl: '*/api/bff', store }))` over a small hand-built `MockStore`.
- **Formatting** (`src/lib/format.ts`): `formatMoney` (decimal string, BigInt grouping, `vi-VN`), `formatAbsoluteTime`, `formatRelativeTime`, `formatOpenFor`, `humanizeCode`. `TimeText` shows absolute plus relative.
- **Badges** (`src/lib/status-badges.ts`): `REGISTRY` maps `kind` (`payment`, `transaction`, `review`) and value to label, tone and icon; add a kind (callback status, event type) there and render with `<StatusBadge kind value />`. Unknown values fall back to a neutral humanised badge.
- **Shared UI**: `CopyButton`, `ErrorState` (with retry) and `NotFoundState` in `src/components/data-states.tsx`, `MockBanner`. `PageHeader` takes `current` for detail-page breadcrumbs (`breadcrumbFor(pathname, current)`).
