Status: ready-for-agent

# Spec: Connect the Console to the real API

Source: [Map: Connect the Console to the real API](map.md), settled by grilling on 2026-11-25. Vocabulary follows [GLOSSARY.md](../../GLOSSARY.md). Architecture decisions: [ADR 0001](../../docs/adr/0001-shared-public-schema-with-table-prefix-ownership.md), [ADR 0004](../../docs/adr/0004-console-reaches-api-only-through-its-bff.md) and [ADR 0005](../../docs/adr/0005-operator-read-models-live-in-payment-core.md). The screens and response shapes are defined by the [Console spec](../console/spec.md).

## Problem Statement

The Operator Console is finished, but it only shows fake data. Every screen reads from an in-process mock, so an Operator cannot see a single real Payment, Review, Callback or Payment Event. The API cannot serve the Console: it exposes one operator route (resolving a Review) and none of the twelve read routes the Console calls. There is also no way to put realistic, varied data into a local database, so a developer who runs the API cannot check that any screen works against real storage, real queries and real pagination. Until this is closed, nobody knows whether the Console's contract can actually be produced from the database, and the mock and the API can silently drift apart.

## Solution

Make the Console run against the real API and a real, seeded PostgreSQL database.

- The API gains the operator read endpoints the Console already calls. They return exactly the shapes the Console's schemas define, and they are built inside Payment Core as read-only use-cases over read-model repositories (ADR 0005).
- A seed script fills a local database with a small, deterministic data set (about 22 Payments) that covers every Payment status, PaymentTransaction status, review reason, NextAction type, Callback status, Payment Event type and status-transition trigger the Console can display.
- A contract test validates every endpoint's response against a hand-copied version of the Console's Zod schemas, so a mismatch fails a test instead of a screen.
- The Console's development default switches from mocks to the real API. Mock mode remains available for Playwright and for demos without a backend.

## User Stories

### Operator: real data on every screen

1. As an Operator, I want the Overview to show the volume, Payment count, success rate and open Reviews computed from real Payments, so that the figures reflect what PayBridge actually collected.
2. As an Operator, I want the Overview range selector (24 hours, 7 days, 30 days) to change real aggregates, so that I can compare short and long trends on real data.
3. As an Operator, I want the Overview volume chart to use rolling buckets counted back from the current moment, so that the chart does not depend on a time zone or on where a calendar day starts.
4. As an Operator, I want the Payments-by-status chart to count real Payments in the range, so that I see the true proportion of succeeded, pending, cancelled and expired Payments.
5. As an Operator, I want the per-PaymentGateway breakdown to attribute each Payment to the gateway of its latest PaymentTransaction, so that a Payment that switched gateways is counted once and under the gateway that handled it last.
6. As an Operator, I want the recent Payments list on the Overview to show the newest real Payments, so that I can jump to what just happened.
7. As an Operator, I want the Payments list to page through real Payments with a cursor, so that long lists load quickly and do not skip or repeat rows when new Payments arrive.
8. As an Operator, I want to search Payments by Payment id or Upstream Reference, so that I can find the Payment a merchant's support agent asks about.
9. As an Operator, I want to filter Payments by status, PaymentGateway and created date range, so that I can narrow to an incident window.
10. As an Operator, I want to sort Payments by created time and Amount, so that I can find the newest or the largest.
11. As an Operator, I want the Payments list to show the gateway and status of each Payment's latest PaymentTransaction, so that I can scan the current state without opening each Payment.
12. As an Operator, I want the Payment detail page to show every PaymentTransaction of a real Payment, oldest first, with its Provider Reference, NextAction type and status history, so that I can match it against the gateway's own dashboard.
13. As an Operator, I want the Payment detail page to show the Payment's Payment Events, so that I know what Core told other systems.
14. As an Operator, I want an unknown Payment id to give a clear not-found state, so that a wrong link is obvious.
15. As an Operator, I want the Exceptions page to list real open Reviews, oldest first by default, so that the longest-waiting cases come first.
16. As an Operator, I want to filter Reviews by review reason, PaymentGateway and state (open or closed), so that I can work through one kind at a time and check earlier decisions.
17. As an Operator, I want each Review to show when it becomes resolvable (opened time plus 72 hours), so that I know whether I may resolve it yet.
18. As an Operator, I want an `AMOUNT_MISMATCH` Review to show the amount the provider reported, so that I can decide with the real figures in front of me.
19. As an Operator, I want the sidebar badge and the Overview figure to show the real count of open Reviews, so that I know whether work is waiting.
20. As an Operator, I want to resolve a Review from the Console against the real API and see the Payment, the Review list, the badge and the audit log change, so that my decision takes effect and is recorded with my identity.
21. As an Operator, I want the real API's rejection message shown when Core refuses my resolution, so that I understand why.
22. As an Operator, I want the Gateways page to list the PaymentGateways actually registered in this deployment, so that I know which gateways it serves.
23. As an Operator, I want each PaymentGateway to show whether it is registered and configured, so that I see configuration problems.
24. As an Operator, I want each PaymentGateway to show test or live mode, so that I never confuse test traffic with real money.
25. As an Operator, I want each PaymentGateway to show its real Callback URL, so that I can configure the gateway's dashboard with the right address.
26. As an Operator, I want the Gateway detail page to show Callback counts by status for the last 24 hours and the time of the last Callback, so that I can tell whether the gateway is healthy.
27. As an Operator, I want the Gateway detail page to show recent gateway errors by category, or an empty list when none are recorded, so that the page works today and gains content once errors are persisted.
28. As an Operator, I want to follow a link from a PaymentGateway to its Payments and its Callbacks already filtered, so that I can investigate quickly.

### Developer: inspecting what happened

29. As a developer, I want the Callbacks page to list real Callbacks with their PaymentGateway, provider event id, Attempt Key, status, delivery attempts, received time and processed time, so that I can see what each PaymentGateway sent.
30. As a developer, I want to filter Callbacks by PaymentGateway and status, so that I can find failed ones.
31. As a developer, I want the Callback detail to show the allow-listed headers, query, raw body as text and last error, so that I can debug a gateway integration.
32. As a developer, I want a Callback that names a known Attempt Key to link to its Payment, and a Callback whose Attempt Key matches nothing to show no link, so that I can follow the effect or see that it had none.
33. As a developer, I want the Callbacks page subtitle to say "Webhook inbox", so that I can map the page to the table in the code while the page keeps the glossary name Callbacks.
34. As a developer, I want the Events page to list real Payment Events with type, Payment, created time and published time, so that I can see what Core emitted.
35. As a developer, I want to filter Payment Events by type and by published or unpublished, so that I can spot a stuck relay.
36. As a developer, I want to open a Payment Event and see its payload, so that I can check what downstream systems receive.
37. As a developer, I want the Events page subtitle to say "Outbox", so that I can map the page to the table in the code while the page keeps the glossary name Payment Events.
38. As a developer, I want the audit log to list real status transitions with entity type, entity id, from status, to status, trigger, actor, note and time, so that I can explain any change.
39. As a developer, I want to filter the audit log by entity type, entity id, trigger and actor, so that I can see, for example, every Operator resolution.
40. As a developer, I want each audit row for a PaymentTransaction to carry the id of its Payment, so that the Console can link to it without a second lookup.

### Developer: seeding and local setup

41. As a developer, I want one command that fills my local database with a small deterministic data set, so that I can run the API and the Console and see every screen with real data.
42. As a developer, I want the seeded data to include every Payment status, PaymentTransaction status, review reason, NextAction type, Callback status, Payment Event type and status-transition trigger, so that no Console state is missing from local development.
43. As a developer, I want the seed to include a Review open for more than 72 hours and another open for less than 72 hours, so that I can see both the resolvable and the not-yet-resolvable state.
44. As a developer, I want the seed to include a Payment that switched gateway, so that the timeline and the per-gateway breakdown show a switch.
45. As a developer, I want the seed to include a Callback whose Attempt Key matches no PaymentTransaction and a Callback with no provider event id, so that the edge cases of the Callbacks pages are visible.
46. As a developer, I want the seed to include unpublished Payment Events, so that the "stuck relay" filter has something to find.
47. As a developer, I want the seed's timestamps to be relative to the moment it runs, so that the 24-hour, 7-day and 30-day Overview ranges and the 72-hour Review window stay meaningful on any day.
48. As a developer, I want the seed to produce the same ids and the same relative offsets on every run, so that screenshots, tests and bug reports are reproducible.
49. As a developer, I want running the seed again to delete and recreate only the rows the seed created, so that any other data in my database is untouched.
50. As a developer, I want the seed to refuse to run when `NODE_ENV` is `production`, and to require an explicit force flag when `DATABASE_URL` points at a host other than my own machine, so that I cannot wipe or pollute a shared or production database by accident.
51. As a developer, I want an optional bulk flag that adds many more Payments, off by default, so that I can exercise pagination and query performance without making the default data set large.
52. As a developer, I want the seed to use only the `stripe` and `fake` PaymentGateways, so that the data matches the gateways that actually exist.
53. As a developer, I want a documented environment variable for the API's public base URL, so that the Callback URLs the Gateways page shows are correct for my deployment.
54. As a developer, I want Console development to default to the real API, and a documented switch to mock mode, so that the normal workflow uses real data and I can still work without a backend.

### Developer: contract and quality

55. As a developer, I want every endpoint's response validated against the Console's Zod schemas in an automated test, so that a mismatch between API and Console fails a test instead of breaking a screen.
56. As a developer, I want the copied schemas to carry a header naming the Console file they came from, so that drift is visible in code review.
57. As a developer, I want list endpoints to use an opaque cursor and return `{ items, nextCursor }` with `nextCursor` null on the last page, so that the Console's pagination works unchanged.
58. As a developer, I want a malformed cursor, an unknown filter value or an out-of-range limit to be rejected with the API's standard error response, so that bad input never produces a silent wrong answer.
59. As a developer, I want money to cross the wire as a decimal string in the currency's major unit, so that the Console never handles floating-point amounts.
60. As a developer, I want the new read endpoints to run outside any database transaction and to write nothing, so that the Operator's reading cannot affect payment processing.
61. As a developer, I want the read endpoints to obey Core's existing boundary checks (only the Prisma adapter imports the database client, only the transaction runner opens a transaction), so that the new code does not weaken them.
62. As a developer, I want the queries behind search, filters and sorting to be backed by the indexes they need, so that lists stay fast as data grows.
63. As a developer, I want the `/internal` routes to stay outside the public `/api` prefix, so that keeping them off the public ingress remains a deployment concern.
64. As a developer, I want the existing continuous-integration run to execute the new endpoint tests with its Postgres and Redis services, and to start no real API server, so that CI stays as fast and as simple as it is today.
65. As a developer, I want a local-only command that runs the Console's Playwright smoke tests against the real API and a seeded database, so that I can check the full path before a release without adding it to CI.
66. As a future module author, I want a written rule that the module owning a table prefix owns both its reads and its writes, so that a product catalog can be added as its own module without touching Payment Core.

## Implementation Decisions

- **Contract direction.** The Console's response schemas are the contract. The API conforms to them. The Console changes only when a field cannot be computed from the database. There is no shared contract package, consistent with ADR 0004's decision to copy types.
- **Location.** All new read endpoints live inside Payment Core (ADR 0005), as read-only use-cases in the application layer, read-model repositories in the Prisma adapter, and controllers in the HTTP layer, all registered in the Payment Core module. No separate Console module is created. The existing review-resolution route stays where it is. Core's boundary checks continue to apply: outside the Prisma adapter nothing imports the database client, and read use-cases open no transaction.
- **Routes.** Twelve read routes under the `/internal` prefix, outside the public `/api` prefix, with no authentication (the BFF stamps `actor` on writes as today): Overview; Payments list and operator Payment detail; Reviews list and Reviews summary; Gateways list and detail; Callbacks list and detail; Payment Events list and detail; status transitions (audit log) list. Route names follow the glossary (`callbacks`, `payment-events`). The `WebhookInbox` and `OutboxEvent` models and the public `/webhooks/:gatewayId` route are not renamed.
- **Naming in the UI.** The primary names stay Callbacks and Events. The Developers section adds the subtitles "Webhook inbox" and "Outbox". `GLOSSARY.md` does not change.
- **List endpoints.** All return `{ items, nextCursor }`. The cursor is an opaque, keyset cursor (an encoding of the created time and id of the last row), stable under concurrent inserts. Search is a case-insensitive substring match. A migration adds only the indexes the queries need.
- **Latest PaymentTransaction.** The PaymentTransaction with the greatest creation time, with ties broken by id. It decides the gateway shown in the Payments list and the gateway a Payment is attributed to in Overview.
- **Overview.** Payments are counted and bucketed by creation time. Buckets are rolling and counted back from the end of the range: 24 hourly buckets for `24h`, 24-hour buckets for `7d` and `30d`. Volume is the sum of Amounts of the range's succeeded Payments. Success rate is succeeded over closed (succeeded, cancelled, expired) Payments, or null when none is closed. The other definitions are those in the Console's schema headers.
- **Reviews.** A Review is a PaymentTransaction with a review reason. `open` means the PaymentTransaction is still `REQUIRES_REVIEW`; `closed` means it had a review reason and has since been resolved. `resolvableAt` is the opened time plus 72 hours. The provider-reported amount is present only where the data holds one (`AMOUNT_MISMATCH`).
- **Gateways.** `registered` and `configured` come from the Gateway Manager. `mode` is derived from the Stripe key prefix (`sk_test_` is test, `sk_live_` is live), and the `fake` gateway is always test. `callbackUrl` is the public base URL (new environment variable) plus the public webhook path of the gateway. Callback counts and last Callback time come from the Callbacks stored in the last 24 hours. Recent gateway errors return an empty list until gateway errors are persisted; no new table is added now. An unknown gateway id is a 404.
- **Callbacks.** The list and detail come from the stored inbound notifications. The raw body is returned as text and the allow-listed headers and query as stored. The Payment id is resolved from the Attempt Key when it matches a PaymentTransaction, and is null otherwise.
- **Payment Events.** The list omits the payload and the detail includes it. Filters are event type and published or unpublished.
- **Audit log.** One row per status transition. A transition of a PaymentTransaction carries the id of its Payment; a Payment transition carries its own id; a Refund transition carries none in Phase 1.
- **Money.** Decimal strings in the currency's major unit; no floating point anywhere in the read path.
- **Seed.** A database seed command writes directly to the database through a deterministic generator. Times are relative to the moment it runs, with fixed offsets and fixed ids. It deletes and recreates only its own rows, identified by deterministic ids and an Upstream Reference prefix. It refuses to run under `NODE_ENV=production`, and requires a force flag when the database host is not local. An optional bulk flag, off by default, adds many more Payments. The seed is outside Payment Core, so it may use the database client directly.
- **Seed contents (about 22 Payments).** Pending Payments with no attempt, an attempt in `CREATED`, and an attempt in `PENDING` for each NextAction type (redirect, QR code, client SDK, voucher). A succeeded Payment on Stripe, and one that switched gateway (the Stripe attempt cancelled by a gateway switch, then a `fake` attempt succeeded). A cancelled Payment (merchant cancel), an expired Payment (expiry), and a `FAILED` attempt (gateway rejection) with the Payment still pending. Open Reviews: ambiguous provider status open more than 72 hours and one open less than 72 hours, an amount mismatch with a provider-reported amount, a late success on a closed Payment with refund required, and a duplicate success. Closed Reviews: resolved to succeeded, resolved to failed, and one with an Operator note. Payments spread across 30 days. Six Callbacks (processed, received, processing, failed with a last error, one with no provider event id, one naming an Attempt Key that matches no PaymentTransaction). Six Payment Events covering all five types with at least one unpublished. Status transitions covering every trigger. No Refunds. Only the `stripe` and `fake` gateways.
- **Configuration.** A new `PUBLIC_BASE_URL` environment variable, documented in the example env files. The Console's development default switches `CONSOLE_API_MOCKS` to false; the README documents the switch back.
- **Mocks.** Kept for Playwright and for demos without a backend. They are not extended in this work.
- **Console.** No screen changes except the two Developers-section subtitles and the development default. The Console's schemas change only if a field proves impossible to compute.
- **Future work shaped by this spec.** A new domain such as a product catalog with an embeddable storefront widget is its own module with its own table prefix and its own `/internal` controllers; its public embed routes are public API, not BFF routes; and the BFF's allowed methods are extended when the first non-`POST` write arrives (ADR 0005).

## Testing Decisions

- **One seam.** HTTP requests to the in-process Nest application over real PostgreSQL. This is the highest seam and the only one: the seed script populates the database, each endpoint is called over HTTP, and the response body is validated against the copied Console schemas. A good test asserts external behaviour (status codes, response shape, filter, sort and pagination results, the content of seeded cases) and never reaches into repositories, query builders or cursor internals.
- **What is tested.** Every one of the twelve routes: success shape, each filter, each sort, search, cursor paging across several pages (first, middle, last page, no duplicate or missing row), a malformed cursor, an invalid filter value, not-found for unknown ids, and the empty-result case. Seed coverage is asserted through the same seam: the endpoints, called against the seeded database, must return at least one row of every Payment status, PaymentTransaction status, review reason, NextAction type, Callback status, Payment Event type and trigger. The Overview is tested for rolling buckets, volume, success rate (including null), the per-gateway attribution of a Payment that switched gateway, and each range. Reviews are tested for open and closed state and `resolvableAt`. Gateways are tested for mode derivation, registration and the Callback URL. The seed's safety checks (refuses under production, requires the force flag for a non-local host, deletes only its own rows) are tested through the seed command's observable behaviour.
- **Contract test.** The Console's schemas are copied by hand into the API's test code, each with a header naming its source file. Every response in the endpoint tests is parsed with the matching copied schema.
- **Prior art.** The existing HTTP integration tests that boot the Nest app over real PostgreSQL (the attempts, create-payment and browser-return tests), the shared test-database setup and reset helpers, and the existing contract-test style for gateway plugins. Core's boundary specs continue to run unchanged and must pass.
- **CI.** The new tests run inside the existing integration test command with the Postgres and Redis services CI already provides. No job starts a real API server. A Playwright run against the real API and a seeded database is a local-only command.
- **Not tested separately.** Pure helpers (cursor encoding, bucket arithmetic) are not unit-tested in isolation; they are exercised through the endpoints.

## Out of Scope

- Authentication and authorization for `/internal` routes.
- Persisting gateway errors, and therefore real data for the Gateway detail's recent errors (it returns an empty list).
- Refunds, including any write path and any Refund rows in the seed.
- Any new operator write endpoint. The review-resolution route is unchanged.
- The product catalog, the embeddable storefront widget, layout settings, and the changes to the BFF they will need.
- Renaming the `WebhookInbox` and `OutboxEvent` models, their tables, or the public `/webhooks/:gatewayId` route.
- Changing the glossary: Callback and Payment Event keep their meanings and names.
- A shared contract package between the API and the Console.
- Running the real API in GitHub Actions.
- Extending or changing the Console's mock data.
- Multi-merchant behaviour.

## Further Notes

- The twelve routes, their filters and their definitions are already written in the headers of the Console's API client files; implementers should treat those as the source of truth, and this spec as the plan for providing them.
- Hand-copied schemas will drift if the Console changes a response shape and nobody updates the copy. The header on each copy and the contract test failing on mismatch are the only safeguards; reviewers should check the copies whenever a Console schema file changes.
- The Overview aggregates are the most query-heavy part of this work. If they prove slow on the bulk data set, the fix belongs in the read-model repository (an index or a narrower query), not in a change to the contract.
- Suggested delivery order, as vertical slices: foundation (read-model structure, cursor helper, contract-test harness, seed); Payments; Reviews; Overview; Gateways; Callbacks; Payment Events; Audit log; then switching the Console default and documentation. See the [map](map.md).
