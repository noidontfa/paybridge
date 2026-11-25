# Map: Operator Console

## Destination

A Next.js App Router application at `apps/console` (`@paybridge/console`, product label "PayBridge Console") that the **Operator** uses to monitor Payments, resolve Reviews, and inspect Gateways, Callbacks, Payment Events and the audit trail. It is built frontend-first against a mocked API, and it is ready to point at the NestJS API once the admin read endpoints exist. The spec is [spec.md](spec.md); the implementation tickets are in [issues/](issues/).

## Notes

- **Context**: single context. Vocabulary follows [GLOSSARY.md](../../GLOSSARY.md). This effort added **Operator**, **Review**, **Callback**, **Payment Event** and **Webhook**.
- **Product name**: PayBridge. "PayForge" in the original brief was a slip.
- **Single merchant**: there are no multi-tenant views until multi-merchant exists.
- **Depends on**: Payment Core Phase 1 and the Stripe plugin (both on `main`). The API today has no list, search or metrics endpoints and no authentication, so the Console runs on mocks first.
- **Language**: English UI. Money is VND formatted with `vi-VN`; dates use date-fns. Text is structured so i18n can be added later, but i18n is not built.

## Decisions so far

Settled by grilling on 2026-11-25:

- **Stack**: Next.js App Router, strict TypeScript, Tailwind, shadcn/ui (Base UI flavour), the **sidebar-08** block as the layout (not replaced by a custom sidebar), TanStack Query and Table, React Hook Form and Zod, Recharts, Lucide, Sonner, date-fns, and pnpm. Wired into turbo and CI (`dev`, `build`, `lint`, `typecheck`, `test`, `test:e2e`).
- **Design**: minimal fintech SaaS look (comparable to Stripe, Linear or Vercel), light, dark and system themes, responsive. Consistent status badges, plus skeleton, empty and error states everywhere.
- **Data path**: browser → TanStack Query → Next.js Route Handler BFF → NestJS ([ADR 0004](../../docs/adr/0004-console-reaches-api-only-through-its-bff.md)).
- **Mocks**: an MSW Node server inside the BFF, enabled by `CONSOLE_API_MOCKS=true` and off by default in production. Seeded data includes several hundred Payments across every status and review reason, using **only the `stripe` and `fake` gateways**.
- **Types**: DTO and enum types are **copied into `apps/console`** (no shared contract package). We accept the risk of drift. They use the API's current wire names (`REQUIRES_REVIEW`, `ReviewReason`, …).
- **Reviews**: the domain term stays **Review**, and the code is **not renamed**. The sidebar item and page title are labelled **"Exceptions"** in the UI only.
- **Review handling**: a Sheet opens from the Exceptions list, and the same Review component appears in the PaymentTransaction timeline on the Payment detail page. Operator actions: resolve to `SUCCEEDED` or `FAILED` with a required note (following the spec's rules), and add notes to `LATE_SUCCESS_ON_CLOSED_PAYMENT` and `DUPLICATE_SUCCESS` Reviews.
- **The Operator makes no other changes**: the Console cannot cancel Payments, because cancelling stays a merchant API action. Everything else is read-only.
- **PaymentTransactions**: there is no top-level page. They appear as a timeline on the Payment detail page, and the Payments list can be filtered by gateway.
- **Gateways**: read-only. A list and a detail page show registration state, configured or not, test or live mode, the Callback URL, and recent Callback and error health. Runtime enable/disable is a later step. Credentials never go through the UI.
- **Labels**: inbound gateway notifications are labelled **Callbacks**. "Webhooks" is reserved for future delivery of Payment Events to the merchant.
- **Events**: there is an Events page for Payment Events (the outbox), plus an **Audit log** built on the status-transition trail.
- **Overview**: four figures (volume collected in VND, Payment count, success rate, open Reviews), a volume-over-time chart, a Payments-by-status chart, a per-gateway breakdown, recent Payments, and a 24-hour / 7-day / 30-day range. No revenue or fee figures.
- **Tables**: server-side, cursor-based pagination. Filters, sort and search live in URL search params. All tables use one shared TanStack Table setup.
- **Auth**: none in v1, with access through the internal network only. There is a no-op auth seam (middleware plus `useCurrentOperator()`) that supplies the actor identity for Review resolutions.
- **Settings**: client-side preferences only (theme, table density) and a read-only Environment panel (API base URL, mock-mode flag, build version).
- **Tests**: Vitest and Testing Library for formatters, schemas and components with logic. Playwright smoke tests against mock mode (Overview loads, filtering Payments, resolving a Review).
- **Skeleton built** ([01](issues/01-console-skeleton.md)): `apps/console` with the adapted sidebar-08 shell, themes, Settings and CI. Navigation is data in `src/lib/navigation.ts`; server-only configuration is `CONSOLE_API_BASE_URL` and `CONSOLE_API_MOCKS`.
- **Payment detail built** ([02](issues/02-payment-detail.md)): `/payments/[id]` through the BFF (`/api/bff`, path-preserving) and MSW mock mode over a seeded store; operator detail is `GET /internal/payments/:id`; mock mode refuses production builds, so Playwright runs `next dev`. Extension points for the mock store, handlers, API client, formatters and badges are in the ticket's Answer.
- **Payments list built** ([03](issues/03-payments-list.md)): `GET /internal/payments` (filters, sort, cursor) mocked; shared `DataTable` (TanStack Table v9), toolbar and URL-state module (`useTableUrlState`) for every later list; the URL cursor is the start page and "Load more" accumulates in memory. Reuse notes are in the ticket's Answer.
- **Overview built** ([04](issues/04-overview.md)): `/` with `GET /internal/overview?range=` (computed from the store in `src/mocks/overview.ts`), range in the URL, Recharts through the shadcn Chart wrapper; definitions (success rate, volume, buckets) are in the ticket's Answer.
- **Events and Audit log built** ([09](issues/09-events-and-audit-log.md)): `/events`, `/events/[id]`, `/audit-log` over `GET /internal/payment-events[/:id]` and `GET /internal/status-transitions` (audit rows carry a server-resolved `paymentId`); badge kind `event`; seed now has every trigger and unpublished events of every type.
- **Exceptions built** ([05](issues/05-exceptions-list.md)): `/exceptions` over `GET /internal/reviews` and `/internal/reviews/summary` (a Review is a PaymentTransaction with a review reason; open or closed), sidebar open-Review badge, sheet state in the URL (`payment` and `transaction`); `ReviewPanel` is the shared Review component where ticket 06 adds the actions.
- **Callbacks built** ([07](issues/07-callbacks.md)): `/callbacks` and `/callbacks/[id]` over `GET /internal/callbacks[/:id]` (filters `gatewayId`, `status`; the server resolves `paymentId` from the Attempt Key); body shown as text, JSON pretty-printed; reuse notes for Gateways are in the ticket's Answer.
- **Gateways built** ([08](issues/08-gateways.md)): `/gateways` and `/gateways/[id]` over `GET /internal/gateways[/:id]` (read-only; mode, registration and Callback URL from the API, health derived from the store's Callbacks over 24 hours; unknown id is 404 `GATEWAY_NOT_FOUND`); links open `/payments?gatewayId=` and `/callbacks?gatewayId=`.

## Sidebar (sidebar-08)

- **Header**: PayBridge Console
- **Overview**
- **Payments**: Payments, Exceptions (open-count badge)
- **Refunds**: disabled, "Soon"
- **Gateways**
- **Developers**: Callbacks, Events, Audit log
- **Secondary nav**: Settings, Docs
- **Footer**: Operator user menu (theme toggle)

## Tickets

- [01: Console skeleton: sidebar, themes, Settings and CI](issues/01-console-skeleton.md)
- [02: Payment detail through the BFF and mock mode](issues/02-payment-detail.md) (blocked by 01)
- [03: Payments list](issues/03-payments-list.md) (blocked by 02)
- [04: Overview](issues/04-overview.md) (blocked by 02)
- [05: Exceptions list and Review sheet (read-only)](issues/05-exceptions-list.md) (blocked by 02, 03)
- [06: Review resolution](issues/06-review-resolution.md) (blocked by 05)
- [07: Callbacks list and detail](issues/07-callbacks.md) (blocked by 03)
- [08: Gateways list and detail](issues/08-gateways.md) (blocked by 03, 07)
- [09: Events and Audit log](issues/09-events-and-audit-log.md) (blocked by 03)

## Fog

- The backend admin read API (list and filter Payments, Reviews, Callbacks, Payment Events, status transitions, overview metrics, gateway status) is a separate backend effort. The Console's mocks describe the shape it needs.
- Real Operator authentication.
- Runtime gateway enable/disable.

## Out of scope

- Multi-merchant or tenant views.
- Refund flows (beyond the disabled sidebar entry).
- Cancelling Payments from the Console.
- Entering or rotating gateway credentials in the UI.
- Installing plugins or a plugin marketplace.
- VNPay and ZaloPay data (until those plugins exist).
- i18n.
