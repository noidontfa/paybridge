Status: ready-for-agent

# Spec: Test Mode

Source: grilling session on 2026-11-28. Vocabulary follows [GLOSSARY.md](../../GLOSSARY.md) (new terms: **Mode**, **Test Gateway**). Architecture decisions: [ADR 0011](../../docs/adr/0011-mode-is-a-second-scope-inside-an-organization.md) and [ADR 0012](../../docs/adr/0012-gateway-connections-per-mode-and-a-built-in-test-gateway.md), building on [ADR 0002](../../docs/adr/0002-postgresql-source-of-truth-bullmq-dispatch.md), [ADR 0004](../../docs/adr/0004-console-reaches-api-only-through-its-bff.md), [ADR 0006](../../docs/adr/0006-organization-isolation-enforced-in-the-application.md), [ADR 0007](../../docs/adr/0007-organizations-bring-their-own-gateway-accounts.md) and [ADR 0009](../../docs/adr/0009-browser-starts-payments-with-a-publishable-key.md).
## Problem Statement

An Organization can only try PayBridge with real money:

- **No safe place to integrate.** Every API Key, Publishable Key, Gateway Connection, Payment and Webhook is live. A developer wiring up their backend or an Embedded Checkout creates real Payments, real Webhooks to production endpoints and real Reviews for Operators.
- **No way to use a gateway's sandbox cleanly.** An Organization has at most one Gateway Connection per PaymentGateway, so it must choose between its sandbox and its production credentials. Stripe's test keys, and VNPay's or ZaloPay's sandbox hosts, cannot sit next to the live ones.
- **No way to rehearse the hard cases.** Declines, pending attempts, wrong Amounts and Late Success are exactly what Core is built to handle, but no gateway sandbox produces them on demand, so an Organization cannot see what its system receives when they happen.

## Solution

Give every Organization two **Modes**, Live and Test, in the style of Stripe (ADR 0011), and a PaymentGateway of PayBridge's own for Test (ADR 0012).

- **Two worlds per Organization.** Payments, PaymentTransactions, Refunds, Reviews, Payment Events, Webhooks, Webhook Endpoints, API Keys, Publishable Keys, Gateway Connections, Pricing Plans and Pricing Tables each belong to one Mode, and nothing in one Mode sees or affects the other. Users, Roles and Permissions are the same in both.
- **The key decides.** Every API Key and Publishable Key is created in one Mode and says so in its prefix. A request runs in its key's Mode; nothing in the request can change it. In the Console, a Mode toggle chooses which Mode a User is looking at.
- **Gateway Connections per Mode.** An Organization connects a PaymentGateway once per Mode: sandbox credentials in Test, production credentials in Live. The Gateway Plugin chooses the gateway's sandbox or production environment from the Mode.
- **Test Gateway.** Every Organization has a Gateway Connection to PayBridge's own Test Gateway in Test Mode from the start. Paying through it opens a PayBridge page where whoever is testing chooses how the attempt ends; the result arrives as a real Callback.
- **Separate catalogues.** Pricing Plans and Pricing Tables are per Mode. A Test one can be copied into Live when it is ready.
- **Webhooks say their Mode.** Every Webhook and Payment read carries `mode`, and a Webhook Endpoint receives only its own Mode's Webhooks.
- **Live from day one.** There is no activation step. Everything that exists today becomes Live.

## User Stories

### Modes and keys

1. As an Organization Admin, I want to create API Keys in Test Mode, so that my developers can integrate without moving real money.
2. As a developer, I want to tell a Test API Key from a Live one by its prefix, so that I never ship the wrong one by accident.
3. As a developer, I want a request made with a Test API Key to see and create only Test data, so that tests can never touch real Payments.
4. As a developer, I want my existing API Keys to keep working as Live keys, so that adding Test Mode breaks nothing.
5. As an Organization Admin, I want to create Publishable Keys in Test Mode, so that I can try an Embedded Checkout on a page before going live.
6. As a developer, I want a Test Publishable Key to allow `http://localhost` origins, so that I can try the Embedded Checkout on my own machine; and I want Live keys to allow only `https` origins.
7. As a developer, I want to reuse my own order ids in Test Mode without them blocking the same ids in Live, so that test runs never collide with real orders.

### Console

8. As a User, I want a Mode toggle in the Console header that remembers my choice, so that I can switch between Test and Live data.
9. As a User, I want a clear "Test data" banner on every screen in Test Mode, so that I never mistake test Payments for real ones.
10. As a User of an Organization that has no Live Payments yet, I want the Console to open in Test Mode, so that I start where I can do no harm.
11. As an Operator, I want to resolve Test Reviews and resend Test Webhooks exactly as I do in Live, so that I can rehearse my work.
12. As a Super Admin, I want the platform screens to open in Live and switch Modes like anyone else, so that I can help an Organization debug its tests.

### Gateways

13. As an Organization Admin, I want to connect a PaymentGateway separately in Test and in Live, so that I can keep its sandbox credentials next to its production ones.
14. As an Organization Admin, I want PayBridge to refuse credentials that clearly belong to the other Mode (a Stripe `sk_test_` key on a Live connection, or the reverse), so that I cannot take real money in Test or fake money in Live.
15. As an Organization Admin, I want to see a different Callback URL for each Mode's Gateway Connection, so that I can register each in the gateway's matching dashboard.
16. As an Organization Admin, I want a PaymentGateway that has no sandbox to be unavailable in Test Mode, so that I am never sent to its production servers by mistake.

### Test Gateway

17. As an Organization Admin, I want a Test Gateway connected from the day my Organization exists, so that I can try PayBridge before signing up with any PaymentGateway.
18. As a developer, I want paying through the Test Gateway to send me to a PayBridge page where I choose: paid, declined, left pending, paid a different Amount, or paid late, so that I can see how my system handles each case.
19. As a developer, I want the outcome I choose to reach PayBridge as a signed Callback through the normal path, so that Reviews, Late Success and Webhooks behave exactly as in Live.
20. As a developer, I want to choose a Test Gateway outcome through the API with a Test API Key, so that my automated tests can settle Payments without a browser.
21. As a developer, I want Refunds and re-queries through the Test Gateway to answer from what I chose, so that the whole lifecycle can be tested.
22. As an Organization Admin, I want to disable the Test Gateway like any other Gateway Connection, so that my Test Mode can use only the real gateways' sandboxes if I prefer.

### Webhooks and the API

23. As a developer, I want every Webhook and every Payment read to carry `mode`, so that my Live handler can reject a Test event that reaches it.
24. As an Organization Admin, I want to register Webhook Endpoints in Test Mode with their own signing secrets, so that Test Webhooks go to my staging system and never to production.

### Pricing Plans and Pricing Tables

25. As an Organization Admin, I want Test and Live to have separate Pricing Plans and Pricing Tables, so that experiments never change what Customers see.
26. As an Organization Admin, I want to copy a Test Pricing Plan or Pricing Table into Live, so that I do not rebuild what I already tested; and I want later changes to either never to reach the other.
27. As an Organization Admin, I want a Pricing Plan copied into Live to leave out PaymentGateways that cannot run in Live (such as the Test Gateway), so that Customers are never offered them.
28. As an Organization Admin, I want an Embedded Checkout whose Publishable Key and Pricing Table are in different Modes to show the table as unavailable, with a clear message in the browser console, so that a half-finished go-live fails safely instead of mixing Modes.

### Test data

29. As an Organization Admin, I want to delete all of my Organization's Test data at once, so that I can start my tests afresh. (Deferred: ticket 10.)

## Implementation Decisions

### Mode in the scope

- `OrganizationScope` (`apps/api/src/common/organization-scope.ts`) gains a Mode. A scope for one Organization always names one Mode; `ALL_ORGANIZATIONS` (sweeps, Super Admin lists) is unchanged and code that loads a row builds the next scope from the row's Organization **and** Mode, as it already does for the Organization.
- The `Principal` carries a Mode: from the API Key or Publishable Key, or for a User from the Console's Mode header (below). The Mode is never taken from a body or query parameter.
- The isolation test (`apps/api/src/payment-core/isolation.spec.ts`) today only checks that each repository method's first parameter is `scope`, which would stay green without any Mode filter. It is extended to check that queries on Mode-owned tables filter by Mode as well as Organization, and it covers repositories it currently misses (API Keys).

### Schema

- A `mode` column (enum `LIVE` / `TEST`, not null) on every Mode-owned table: Payments, PaymentTransactions, Refunds, the raw responses, idempotency keys, outbox events, webhook inbox, status transitions, Gateway Connections, Pricing Plans, Pricing Tables, checkout sessions, Webhook Endpoints, Webhook deliveries and their attempts, API Keys, Publishable Keys. Child rows copy their parent's Mode, and the repository refuses a child whose Mode differs from its parent's.
- Unique constraints that include `organization_id` also include `mode`: the Upstream Reference (`core_payments_org_merchant_order_id_uq`), Gateway Connections (`core_gateway_connections_org_gateway_uq`), the webhook inbox dedupe key, and idempotency keys.
- One migration backfills every existing row as `LIVE`, following the precedent of `20261125100000_organizations`.

### Keys

- API Keys: `pb_test_…` and `pb_live_…`. The hard-coded `pb_live_` prefix in `apps/api/src/identity/application/api-key-secret.ts` becomes per Mode; existing `pb_live_` keys keep working as Live.
- Publishable Keys: `pb_pk_test_…` and `pb_pk_live_…`; existing `pb_pk_` keys are Live.
- `AuthenticateApiKey` and the Publishable Key resolver return the Mode with the Organization.
- Allowed origins: a Test Publishable Key accepts `http://localhost` and `http://127.0.0.1` origins (any port) in every environment; a Live one accepts only `https` origins, except `localhost` outside production as today.

### Console and BFF

- The Mode toggle follows the Organization switcher's pattern (`apps/console/src/components/layout/organization-switcher.tsx`): a cookie, forwarded by the BFF as a header, then a page reload. The API honours the Mode header for every User, not only Super Admins (unlike `x-organization-id`), because the Mode is not a privilege. A missing header means Live, except that the Console itself defaults a User to Test when their Organization has no Live Payments.
- A "Test data" banner shows on every screen in Test Mode. Test-only screens (Test Gateway outcome, delete Test data) appear only in Test Mode.
- Every existing Console page reads and writes the selected Mode's data; no page needs a Mode selector of its own.

### Gateways

- `GatewayPluginFactory.create` receives the Mode alongside the credentials. `GatewayMode = 'test' | 'live'` already exists in `payment-gateway.port.ts`; it becomes required input. A factory declares the Modes it supports, and connecting a PaymentGateway in a Mode it does not support is refused.
- The Stripe plugin today infers its Mode from the `sk_live_`/`rk_live_` prefix. Instead, its credential schema refuses keys whose prefix belongs to the other Mode. Stripe uses one host for both Modes, so nothing else changes. Future plugins with sandbox hosts (VNPay, ZaloPay) choose the host from the Mode inside the plugin.
- Plugin lookup (`ConnectionPlugins`) finds a Gateway Connection by Organization, PaymentGateway **and** Mode.
- Callback intake (`POST /api/webhooks/:gatewayId/:connectionId`, `WebhookIntake`) already resolves the Gateway Connection by id; the Callback, and everything Core does with it, takes the Gateway Connection's Mode.

### Test Gateway

- The existing fake plugin (`apps/api/src/gateways/fake/fake-gateway.plugin.ts`) stays as the scripted plugin for tests. The Test Gateway is a new production plugin (gateway id `test`) beside it, reusing its HMAC Callback signing. It supports Test Mode only and is registered in every environment, including production (the fake plugin's "outside production only" registration in `gateways.module.ts` does not apply to it).
- Its secret is per Gateway Connection, generated by PayBridge; the Organization never enters credentials.
- `initiate` returns a redirect NextAction to a simulator page in `apps/checkout`. The page shows the Amount and the outcome buttons. Choosing one calls the API, which records the outcome for the attempt and sends PayBridge's own callback URL for that Gateway Connection a signed Callback. "Paid late" is accepted after the attempt is closed and produces a Late Success.
- `query` and Refunds answer from the recorded outcome. A Refund through the Test Gateway always succeeds.
- An API endpoint, accepted only with a Test API Key, sets an attempt's outcome exactly as the page does.
- Every Organization gets a Test Gateway Connection when it is created, and the migration creates one for every existing Organization.

### Webhooks

- `mode` is added to `WebhookEnvelope` / `envelopeOf` (`apps/api/src/webhooks/domain/entities/webhook-delivery.ts`). The signature covers the whole body, so it covers `mode` with no change to signing.
- Fan-out (`listSubscribed(scope, kind)`) returns only Webhook Endpoints of the Payment Event's Mode.
- Payment reads in the public API include `mode`.

### Pricing Plans, Pricing Tables and Embedded Checkout

- A "Copy to Live" action on a Test Pricing Plan or Pricing Table creates new Live records. Copying a Pricing Table also copies each of its Pricing Plans that has no Live copy yet; the copies keep no link to the originals. Allowed PaymentGateways that do not support Live are dropped from the copy. There is no Live → Test copy.
- The checkout endpoints look up the Pricing Table in the Publishable Key's Mode. A table in the other Mode is "unavailable", exactly like a deleted one; the snippet logs a message naming the Mode mismatch to the browser console.

### Background work

- Re-query, Payment Expiry, Review re-query, inbox sweeps and Webhook dispatch and retries run the same for both Modes on the same queues. Each loads rows across Organizations and builds the scope from the row, so the row's Mode carries through.

### Permissions and suspension

- No new Permissions. Every existing Permission applies in both Modes. Suspending an Organization stops both Modes.

## Testing Decisions

- Test behaviour through the public API and the Console BFF, not internals, as the existing integration tests do (`pnpm test:int` in `apps/api`, needs `pnpm docker:up`).
- Test fixtures gain Mode: `test/setup/organizations.ts` (`defaultScope`), `api-keys.ts`, `checkout.ts` and `reset-db.ts` (`connectFakeGateway`) take a Mode and default to Live, so existing tests keep their meaning.
- Every ticket that adds a Mode-owned read or write includes a cross-Mode test: the same Organization's Test key cannot see or change the Live record, and the reverse.
- The extended isolation test fails if a query on a Mode-owned table forgets the Mode.
- The Test Gateway has a contract test like the Stripe and fake plugins, plus an end-to-end test from Embedded Checkout through the simulator page to a Webhook.

## Out of Scope

- An activation step before Live can be used.
- Live → Test copies, or keeping Test and Live catalogues in sync.
- Separate queues or workers for Test Mode.
- Plugins for VNPay or ZaloPay; this spec only makes the contract able to carry their sandbox hosts.
- Mode-specific Permissions.

## Further Notes

- Deleting all Test data (story 29) was agreed as a later ticket and is filed as ticket 10 with `Status: needs-triage`.
