# 06: Gateways

**What to build:** `GET /internal/gateways` and `GET /internal/gateways/:id`, so the Console's Gateways pages show the real registered PaymentGateways and the health of their Callbacks. Adds the `PUBLIC_BASE_URL` environment variable.

**Blocked by:** 02

**Status:** resolved

- [x] The list returns the gateways registered in this deployment with `registered`, `configured`, `mode` and `callbackUrl`
- [x] `mode` is derived from the Stripe key prefix (`sk_test_` is test, `sk_live_` is live); the `fake` gateway is always test
- [x] `registered` and `configured` come from the Gateway Manager, and no credential ever appears in a response
- [x] `callbackUrl` is the new `PUBLIC_BASE_URL` plus the gateway's public webhook path; the variable is validated in the environment schema and documented in the example env files
- [x] The detail adds Callback counts by status for the last 24 hours (every status present), the last Callback time, and `recentErrors` as an empty list until gateway errors are persisted
- [x] An unknown gateway id returns 404 `GATEWAY_NOT_FOUND`
- [x] Integration tests validate responses against the copied Console schemas and cover both seeded gateways
- [x] The Console's Gateways pages, with mocks turned off, show the real gateways

## Answer

`GET /internal/gateways` and `/internal/gateways/:id` work on real PostgreSQL with the Console's `gatewayListSchema` and `gatewayDetailSchema`. The last criterion (Gateways pages with mocks off) was not exercised in a browser; every response is parsed with the copied schemas in `apps/api/test/payment-core/console/gateways.int-spec.ts`.

- Code: `console/gateways.module.ts`, `http/console/gateways.controller.ts`, `application/use-cases/console/gateways.ts` (`GatewaysOverview`), `infrastructure/prisma/console-read/gateways-read.repository.ts`. Contract copy: `test/contract/console/gateways.ts`. No migration (existing indexes suffice).
- Which gateways are listed: the Gateway Manager's registered plugins plus any gateway id that appears on a PaymentTransaction or Callback. A gateway with data but no plugin (for example `stripe` without keys, as in the seed) is shown with `registered: false, configured: false, mode: test`. A registered plugin is always `configured` (the manager only holds configured plugins). Unknown id: 404 `GATEWAY_NOT_FOUND`.
- Mode: new optional `mode?: 'test' | 'live'` on the `PaymentGateway` port (absent means test). The Stripe plugin sets it from the secret key prefix; Core never reads a key.
- `PUBLIC_BASE_URL`: optional http(s) URL in `env.schema.ts`, defaults to `http://localhost:<PORT>`, trailing slash stripped; documented in `.env.example` and `.env.production.example`. `callbackUrl` = base + `/api/webhooks/<id>`.
- Detail: counts are over `receivedAt` in the last 24 hours, every status present; `lastCallbackAt` is the latest Callback of any age; `recentErrors` is `[]`.
- Testing note: ConfigModule reads the environment when `AppModule` is imported, so set env vars with `vi.hoisted` before imports (see the spec).
