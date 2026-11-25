# 08: Gateways list and detail

**What to build:** An Operator opens Gateways and sees the PaymentGateways the API reports for this deployment, each with registered and configured state, test or live mode, and its Callback URL with copy. The detail page shows Callback counts by status in the last 24 hours, the time of the last Callback, and recent gateway error counts by error category, with links to that gateway's Payments and Callbacks already filtered. Everything is read-only: there is no way to enter credentials or enable or disable a gateway.

See [spec](../spec.md): Gateways (stories 63–69); Implementation Decisions › API contract (Gateways list and detail).

**Blocked by:** 03: Payments list; 07: Callbacks list and detail.

**Status:** resolved

- [x] The mock serves the Gateways list and detail for `stripe` and `fake` only, with values derived from the fixture store's Callbacks and PaymentTransactions.
- [x] Mode, registration and Callback URL come from the API response, never from Console configuration.
- [x] Live mode is visually distinct from test mode.
- [x] Links open the Payments list and the Callbacks list with the gateway filter set in the URL.
- [x] Loading, empty, not-found and error states.
- [x] Screen tests: list, detail health figures, links carry the right filter, unknown gateway id.

## Answer

`/gateways` is a card per PaymentGateway and `/gateways/[id]` its detail. Tests: handler and seed test (`src/mocks/gateways.test.ts`), screen tests (`src/components/gateways/gateways-screen.test.tsx`: list, live vs test, no credential or enable controls, empty, error and retry, detail health figures, filtered links, no data yet, unknown id) and Playwright `e2e/gateways.spec.ts`.

Decisions to know about:

- **Endpoints** (mocked): `GET /internal/gateways` returns `{ items }` (no cursor; sorted by id), each `id`, `registered`, `configured`, `mode` (`test` or `live`), `callbackUrl`. `GET /internal/gateways/:id` adds `callbackCounts` (all four inbox statuses, last 24 hours before `store.now`), `lastCallbackAt` (all time, nullable) and `recentErrors` (`{ category, count }`, most frequent first, last 24 hours). Unknown id is 404 `GATEWAY_NOT_FOUND`.
- **Error category** is derived in the mock from a FAILED Callback's last error (`SIGNATURE_INVALID`, `PROVIDER_UNAVAILABLE`, `TIMEOUT`, else `UNKNOWN`); the real API is expected to send the category. The Console shows `humanizeCode(category)`.
- **Store**: `MockStore.gateways` is a public field with defaults for `stripe` and `fake` (both registered, configured, test mode), not a constructor parameter, so tests replace its contents to model live or unconfigured gateways. The Console has no gateway configuration of its own.
- **Live mode** is a solid red badge with a bolt; test is a neutral badge with a flask (`GatewayModeBadge`, `data-mode` attribute).
- **Read-only**: no inputs, switches or credential fields exist; a screen test asserts it.
- Links: View Payments `/payments?gatewayId=<id>`, View Callbacks `/callbacks?gatewayId=<id>`, View failed Callbacks adds `&status=FAILED`.
- Shared files touched additively: `handlers.ts` spreads `gatewaysHandlers`; `store.ts` got `MockGateway` and `gateways`.
- E2E note: Playwright runs a cold dev server, and the first run after a fresh install can time out on first-compile; rerunning passes.
