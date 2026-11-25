Status: ready-for-agent

# Spec: Operator Console

Source: [Map: Operator Console](map.md), settled by grilling on 2026-11-25. Vocabulary follows [GLOSSARY.md](../../GLOSSARY.md). Architecture decisions: [ADR 0004](../../docs/adr/0004-console-reaches-api-only-through-its-bff.md) (the Console reaches the API only through its own BFF). Payment rules follow the [Payment Core spec](../payment-core/spec.md).

## Problem Statement

PayBridge holds the state of every Payment across PaymentGateways, but the only way to see that state is to call the API one Payment at a time. An Operator cannot see how many Payments succeeded today, which PaymentTransactions are stuck in Review, whether Callbacks from a PaymentGateway are arriving, or who changed a status and why. To resolve a Review, the Operator must hand-craft a request to an internal endpoint, typing their own identity and the amount, with nothing to show them whether the resolution is allowed. When something goes wrong, nobody notices until the merchant's order system complains.

## Solution

The PayBridge Console: a web application for the Operator of a single-merchant PayBridge. It gives the Operator:

- an Overview of Payment volume, counts, success rate and open Reviews over a selectable time range;
- a searchable, filterable list of Payments and a Payment detail page with its PaymentTransactions as a timeline;
- an **Exceptions** work queue that lists open Reviews and lets the Operator resolve them, or add notes to them, under the rules Core enforces;
- a read-only view of the PaymentGateways registered in this deployment and the health of their Callbacks;
- developer views of Callbacks, Payment Events and the audit log;
- light, dark and system themes, and a layout that works from phone to wide desktop.

The Console is built first against a mocked API that stands in for the NestJS server. The mocks define the admin read endpoints the backend must later provide. Switching from mocks to the real API is a configuration change.

## User Stories

### Navigation and layout

1. As an Operator, I want a sidebar with Overview, Payments, Exceptions, Refunds, Gateways, Callbacks, Events, Audit log, Settings and Docs, so that I can reach every area of the Console in one click.
2. As an Operator, I want the sidebar grouped into Payments, Gateways and Developers sections, so that I find operational and technical views in predictable places.
3. As an Operator, I want the Exceptions item to show the number of open Reviews, so that I know at a glance whether work is waiting for me.
4. As an Operator, I want the Refunds item visible but disabled and marked "Soon", so that I know refunds are planned and not missing by mistake.
5. As an Operator, I want to collapse the sidebar, so that tables have more room on a small screen.
6. As an Operator on a phone, I want the sidebar to open as a drawer, so that the Console is usable away from my desk.
7. As an Operator, I want a breadcrumb in the page header, so that I know where I am and can go back one level.
8. As an Operator, I want the sidebar footer to show who I am signed in as, so that I know which identity my resolutions will record.
9. As an Operator, I want to switch between light, dark and system themes from the user menu, so that the Console suits my environment.
10. As an Operator, I want a visible banner when the Console runs on mock data, so that I never mistake fake data for real Payments.

### Overview

11. As an Operator, I want to see the volume collected in VND for the selected range, so that I know how much money PayBridge collected.
12. As an Operator, I want to see the number of Payments created in the selected range, so that I know how busy the system is.
13. As an Operator, I want to see the success rate (succeeded Payments over closed Payments), so that I notice when collection gets worse.
14. As an Operator, I want to see the number of open Reviews, with a link to Exceptions, so that I can start working on them.
15. As an Operator, I want to choose 24 hours, 7 days or 30 days as the range, so that I can compare short and long trends.
16. As an Operator, I want the range I chose kept in the URL, so that I can share or reload the same view.
17. As an Operator, I want a chart of volume over time, so that I see dips and spikes.
18. As an Operator, I want a chart of Payments by status, so that I see the proportion of succeeded, pending, cancelled and expired Payments.
19. As an Operator, I want a breakdown per PaymentGateway (count, volume, success rate), so that I can see which gateway performs worse.
20. As an Operator, I want a short list of the most recent Payments with a link to each, so that I can jump to what just happened.
21. As an Operator, I want skeletons while the Overview loads, so that the layout does not jump.
22. As an Operator, I want a clear empty state when the range has no Payments, so that I do not think the page is broken.

### Payments

23. As an Operator, I want a table of Payments showing Upstream Reference, Amount, status, PaymentGateway of the latest PaymentTransaction, created time and Payment Expiry, so that I can scan Payments quickly.
24. As an Operator, I want to search by Payment id or Upstream Reference, so that I can find the Payment a merchant support agent asks about.
25. As an Operator, I want to filter Payments by status, so that I can look only at pending or expired ones.
26. As an Operator, I want to filter Payments by PaymentGateway, so that I can investigate one gateway.
27. As an Operator, I want to filter Payments by created date range, so that I can narrow to an incident window.
28. As an Operator, I want to sort Payments by created time and by Amount, so that I can find the newest or the largest.
29. As an Operator, I want filters, sort and search kept in the URL, so that I can share an exact view with a colleague.
30. As an Operator, I want to load the next page of Payments without losing my filters, so that I can work through long lists.
31. As an Operator, I want amounts shown as VND with Vietnamese digit grouping, so that I read them correctly.
32. As an Operator, I want times shown in my local time with a relative hint ("3 minutes ago"), so that I understand recency.
33. As an Operator, I want to copy a Payment id or Upstream Reference with one click, so that I can paste it into other tools.
34. As an Operator, I want to click a row to open the Payment detail page, so that I can see everything about it.
35. As an Operator, I want a helpful empty state when no Payment matches my filters, with a way to clear them, so that I can recover quickly.
36. As an Operator, I want an error state with a retry button when the list fails to load, so that a transient error does not block me.

### Payment detail

37. As an Operator, I want to see the Payment's Amount, status, Upstream Reference, Payment Expiry, created and updated times, so that I have the full summary.
38. As an Operator, I want to see every PaymentTransaction of the Payment as a timeline, oldest first, so that I understand each attempt and each gateway switch.
39. As an Operator, I want each PaymentTransaction to show its PaymentGateway, status, Attempt Key, Provider Reference (when present), NextAction type, and times, so that I can match it with the gateway's own dashboard.
40. As an Operator, I want each PaymentTransaction to show its status history from the audit log (from status, to status, trigger, actor, note, time), so that I see how it reached its current status.
41. As an Operator, I want a PaymentTransaction in Review to show its review reason, how long the Review has been open, and whether a refund is required, so that I know what to do.
42. As an Operator, I want to resolve or add a note to a Review from the Payment detail page, so that I do not need to switch to the Exceptions page.
43. As an Operator, I want the Payment's Payment Events listed, so that I know what Core told other systems about this Payment.
44. As an Operator, I want a not-found state when the Payment id does not exist, so that a wrong link is obvious.
45. As an Operator, I want the Console to offer no cancel action, so that cancellation stays with the merchant's system and the merchant's order state cannot drift from PayBridge.

### Exceptions (Reviews)

46. As an Operator, I want an Exceptions page that lists open Reviews, so that I have one work queue.
47. As an Operator, I want each row to show the review reason, PaymentGateway, Payment Amount, provider-reported amount when known, how long the Review has been open, and whether a refund is required, so that I can prioritise.
48. As an Operator, I want to filter Reviews by review reason and PaymentGateway, so that I can work through one kind at a time.
49. As an Operator, I want Reviews sorted oldest first by default, so that the longest-waiting cases come first.
50. As an Operator, I want to see closed Reviews too, through a filter, so that I can check what was decided earlier.
51. As an Operator, I want to click a Review to open a side sheet with the Payment summary, the PaymentTransaction, its status history and the resolution form, so that I can triage without leaving the list.
52. As an Operator, I want a Review that has been open for less than 72 hours to show when it becomes resolvable, and the resolve action disabled until then, so that automatic re-query has its chance first.
53. As an Operator, I want to resolve an `AMBIGUOUS_PROVIDER_STATUS` Review to `SUCCEEDED` or `FAILED`, so that every stuck case gets a decision.
54. As an Operator, I want `SUCCEEDED` offered only when the Payment is `PENDING`, and to enter the amount the PaymentGateway collected, which must equal the Payment Amount, so that I cannot mark a Payment paid for the wrong amount.
55. As an Operator, I want an `AMOUNT_MISMATCH` Review to offer only `FAILED`, so that the form matches Core's rule.
56. As an Operator, I want `LATE_SUCCESS_ON_CLOSED_PAYMENT` and `DUPLICATE_SUCCESS` Reviews to offer only "add note", so that I record what I know until refunds exist.
57. As an Operator, I want the note to be mandatory and limited to 2000 characters, with a visible counter, so that every decision is explained.
58. As an Operator, I want a confirmation step before a resolution that changes a status, so that I do not resolve the wrong Review by mistake.
59. As an Operator, I want my identity sent with the resolution automatically, so that I do not type it and the audit log is correct.
60. As an Operator, I want a success toast and the list, badge and Payment detail updated after I resolve a Review, so that I see the result immediately.
61. As an Operator, I want the API's rejection message shown in the form when Core refuses my resolution, so that I understand why (for example, the Payment is no longer pending).
62. As an Operator, I want the form to keep my note when a resolution fails, so that I do not lose my writing.

### Gateways

63. As an Operator, I want a list of the PaymentGateways the API reports, so that I know which gateways this deployment serves.
64. As an Operator, I want each PaymentGateway to show whether it is registered and configured, so that I see configuration problems.
65. As an Operator, I want each PaymentGateway to show test or live mode, so that I never confuse test traffic with real money.
66. As an Operator, I want each PaymentGateway to show its Callback URL with a copy button, so that I can configure the gateway's dashboard.
67. As an Operator, I want a PaymentGateway detail page with Callback counts by status, the time of the last Callback, and recent gateway errors by category, so that I can tell whether the gateway is healthy.
68. As an Operator, I want links from a PaymentGateway to its Payments and its Callbacks, already filtered, so that I can investigate quickly.
69. As an Operator, I want the Console to offer no way to enter or change gateway credentials, so that secrets stay outside the UI.

### Callbacks

70. As a developer, I want a table of Callbacks showing PaymentGateway, provider event id, Attempt Key, status, delivery attempts, received time and processed time, so that I can see what each PaymentGateway sent.
71. As a developer, I want to filter Callbacks by PaymentGateway and status, so that I can find failed ones.
72. As a developer, I want to open a Callback and see its allow-listed headers, query, raw body (formatted when it is JSON) and last error, so that I can debug a gateway integration.
73. As a developer, I want a link from a Callback to the PaymentTransaction's Payment when the Attempt Key is known, so that I can follow the effect.
74. As a developer, I want Callbacks clearly separated from Payment Events, so that I do not confuse what a gateway sent with what Core emitted.

### Events

75. As a developer, I want a table of Payment Events showing type, Payment, created time and published time, so that I can see what Core emitted.
76. As a developer, I want to filter Payment Events by type and by published or unpublished, so that I can spot a stuck relay.
77. As a developer, I want to open a Payment Event and see its payload, so that I can check what downstream systems receive.

### Audit log

78. As an Operator, I want a table of every status transition showing entity type, entity id, from status, to status, trigger, actor, note and time, so that I can explain any change.
79. As an Operator, I want to filter the audit log by entity type, trigger and actor, so that I can see, for example, all operator resolutions.
80. As an Operator, I want each audit row to link to its Payment, so that I can see the context.

### Settings

81. As an Operator, I want to choose a theme and a table density in Settings, so that the Console suits me.
82. As an Operator, I want my Settings remembered in this browser, so that I do not set them every time.
83. As a developer, I want Settings to show the API base URL, whether mock mode is on, and the build version, so that I can tell which environment I am looking at.

### Platform and quality

84. As a developer, I want the Console to run in mock mode with seeded data covering every Payment status, PaymentTransaction status and review reason, so that I can build and demo every screen without a backend.
85. As a developer, I want the seeded data to use only the `stripe` and `fake` PaymentGateways, so that the Console reflects the gateways that actually exist.
86. As a developer, I want the browser to talk only to the Console's own server, never directly to the API, so that internal routes stay off the public network.
87. As a developer, I want API responses validated at runtime, so that a contract change fails loudly instead of rendering wrong data.
88. As a developer, I want the Console wired into the monorepo's build, lint, typecheck and test tasks and into CI, so that it is held to the same standard as the API.
89. As a developer, I want a single place where the operator identity is obtained, so that adding real authentication later changes one module.
90. As an Operator using a keyboard or screen reader, I want every control reachable and labelled, so that I can use the Console without a mouse.

## Implementation Decisions

### Application

- A new Next.js App Router application, `@paybridge/console`, in the apps folder of the Turborepo monorepo. TypeScript strict mode, extending the shared TypeScript config package. Product label "PayBridge Console".
- UI: Tailwind CSS and shadcn/ui installed with the **Base UI** flavour. The layout starts from the official shadcn **sidebar-08** block (inset sidebar with a secondary nav and a user footer) and is adapted, not replaced. Existing shadcn components are reused (Badge, Button, Card, Chart, Dialog, Sheet, Skeleton, Table, Tabs, Form, Select, Input, Textarea, Breadcrumb, Dropdown Menu, Tooltip, Sonner). New primitives are only created when shadcn has none.
- Libraries: TanStack Query for server state, TanStack Table for tables, React Hook Form with Zod for forms, Recharts through the shadcn Chart wrapper, Lucide icons, Sonner toasts, date-fns for dates, and next-themes for theming. pnpm only.
- Design: neutral background, subtle borders, one accent colour, no decorative gradients or heavy shadows. Every data region has a skeleton, an empty state and an error state with retry.
- English UI. Strings are kept out of component logic so i18n can be added later; no i18n library now.

### Sidebar

- Header: PayBridge Console.
- Main nav: **Overview**; **Payments** group (Payments, Exceptions with open-Review badge); **Refunds** (disabled, "Soon"); **Gateways**; **Developers** group (Callbacks, Events, Audit log).
- Secondary nav: Settings, Docs.
- Footer: Operator user menu with the theme switch.
- "Exceptions" is a UI label only. The domain term, the API wire names (`REQUIRES_REVIEW`, review reasons, `reviewOpenedAt`) and the operator endpoint keep the word "review". No backend rename.

### Data path (ADR 0004)

- Browser → TanStack Query → the Console's own Route Handlers (BFF) → NestJS API.
- The BFF is a thin, path-preserving proxy: a request to the BFF's API prefix plus a path goes to the API base URL plus the same path, with method, query and body unchanged. The API base URL is server-side configuration and never reaches the browser.
- The BFF adds the operator identity to operator write calls: the `actor` field of the review resolution body comes from the auth seam, not from the browser form.
- CORS is not needed on the API.

### Auth seam

- No authentication in v1; the Console is reached on the internal network only.
- One module provides the current Operator (id and display name), used by the BFF for `actor` and by the UI for the sidebar footer. In v1 it returns a configured identity. Real authentication later replaces only this module and adds a middleware check.

### API contract (current and mocked)

The Console's types are **copied** into the Console (no shared package), as Zod schemas with inferred types, matching the API's current wire names. Responses are parsed with these schemas in the data layer.

Existing endpoints the Console uses:

- `GET /payments/:id`: Payment detail with its PaymentTransactions (id is the Attempt Key, `gatewayId`, `status`, `nextAction`, `reviewReason`, `reviewOpenedAt`, `refundRequired`, times).
- `POST /internal/payments/:id/review-resolution`: body `{ attemptId, actor, note, status?, amount? }`. `status` absent means "add a note only". `amount` is required for `SUCCEEDED`.

New admin read endpoints, defined first by the mocks and later built in the API (all under the internal prefix, all list endpoints cursor-paginated with `cursor` and `limit` and returning `{ items, nextCursor }`):

- **Payments list**: filters `status`, `gatewayId` (of any PaymentTransaction), `q` (Payment id or Upstream Reference), `createdFrom`, `createdTo`; sort `createdAt` or `amount`, ascending or descending. Each item adds the latest PaymentTransaction's gateway and status.
- **Payment detail for operators**: the Payment detail plus each PaymentTransaction's Provider Reference and its status transitions, and the Payment's Payment Events.
- **Reviews list**: PaymentTransactions with a review reason; filters `reason`, `gatewayId`, `state` (open or closed); default sort `reviewOpenedAt` ascending. Each item includes the Payment summary, the provider-reported amount when known, and `resolvableAt` (opened time plus 72 hours).
- **Reviews summary**: count of open Reviews, total and by reason (drives the sidebar badge and the Overview figure).
- **Overview**: for `range` of `24h`, `7d` or `30d`: volume collected, Payment count, success rate, open Review count, a volume time series, counts by Payment status, and a per-PaymentGateway breakdown.
- **Gateways list and detail**: per gateway id: registered, configured, mode (`test` or `live`), Callback URL, Callback counts by status in the last 24 hours, last Callback time, recent gateway error counts by error category.
- **Callbacks list and detail**: filters `gatewayId`, `status`; detail adds allow-listed headers, query, raw body as text, delivery attempts and last error.
- **Payment Events list and detail**: filters `type` (`PaymentCreated`, `PaymentSucceeded`, `PaymentCancelled`, `PaymentExpired`, `PaymentRequiresReview`), `published` (true or false); detail adds the payload.
- **Status transitions list**: filters `entityType` (Payment, PaymentTransaction, Refund), `entityId`, `trigger`, `actor`.

Money crosses the wire as a decimal string in the currency's major unit; the Console never converts it to a floating-point number for display or comparison.

### Mock mode

- MSW running in Node inside the BFF intercepts the BFF's outgoing calls to the API base URL. Enabled by a server environment flag; off by default and refused in production builds.
- One handler set over one in-memory fixture store. The store is seeded deterministically (fixed seed and fixed "now") with several hundred Payments across every Payment status, PaymentTransaction status and review reason, gateway switches, late successes, Callbacks in every inbox status, published and unpublished Payment Events, and status transitions. Only the `stripe` and `fake` gateways appear.
- The review-resolution handler applies Core's rules (72 hours, Payment `PENDING` and amount equal for `SUCCEEDED`, `FAILED` only for `AMOUNT_MISMATCH`, note only for late-success and duplicate-success) and mutates the store, writing a status transition and, when the Payment status changes, a Payment Event. Rejections use the API's error response shape and status codes.
- A visible banner shows when mock mode is on.

### Modules

- **API client**: one typed function per endpoint, which calls the BFF and parses the response with the copied Zod schema. Errors become one typed error with the API's error code and message.
- **Query layer**: query keys and hooks per resource; the review-resolution mutation invalidates the Reviews list, Reviews summary, the Payment detail and the Overview.
- **Data table**: one shared TanStack Table setup (column definitions per resource, server-side cursor pagination, sorting and filtering) with toolbar, filter controls, density, and the loading, empty and error states.
- **URL state**: one module maps URL search params to and from table state (filters, sort, search, cursor) and the Overview range.
- **Formatting**: VND amounts with the `vi-VN` locale; absolute and relative times with date-fns; durations ("open for 3 days").
- **Status badges**: one mapping from each Payment status, PaymentTransaction status, review reason, Callback status and Payment Event type to a label, tone and icon, used everywhere.
- **Review resolution rules**: a pure module that, given a Review, its Payment and the current time, returns which actions are allowed (resolve `SUCCEEDED`, resolve `FAILED`, add note) and why the others are not. It shapes the form; the API stays authoritative.
- **Review panel**: one component (summary, PaymentTransaction, status history, resolution form) used both in the Exceptions sheet and in the Payment detail timeline.
- **Feature screens**: Overview, Payments list, Payment detail, Exceptions, Gateways list and detail, Callbacks list and detail, Events list and detail, Audit log, Settings.
- **Settings store**: theme and density in browser storage, read defensively; Environment panel reads server-provided values.

### Routing

- Overview at the root; Payments list and Payment detail by id; Exceptions with the sheet state in the URL (selected attempt id); Gateways list and detail by gateway id; Callbacks list and detail; Events list and detail; Audit log; Settings. Refunds has no route.

## Testing Decisions

- **What makes a good test**: it exercises behaviour an Operator or a developer can observe (what is shown, what is sent to the API, what happens after a click), not component internals, hook calls or state shapes. Tests do not mock the Console's own modules; they replace only the API.
- **One seam: the PayBridge API.** The MSW handler set and seeded fixture store stand in for NestJS. Because the BFF preserves paths, the same handlers serve every test level.
- **End-to-end (Playwright)** against the whole Console in mock mode (browser, BFF, MSW): the Overview loads with figures and charts; filtering and searching Payments updates the URL and the table; opening a Payment shows its timeline; resolving an `AMBIGUOUS_PROVIDER_STATUS` Review to `FAILED` with a note updates the badge, the list and the Payment detail; a rejected resolution shows the API message; theme switch works.
- **Screen tests (Vitest with Testing Library, jsdom)**: render a whole screen with a real QueryClient; MSW intercepts its fetches with the same handlers mapped to the BFF prefix. Cover the Payments list (filters, empty and error states), the Exceptions list and Review sheet (each review reason offers the right actions, the 72-hour lock, amount validation, note required), Payment detail (not-found state), Gateways detail, Callbacks detail and Settings.
- **Unit tests (Vitest)** for pure modules: VND and date formatting, URL state mapping, status badge mapping, the review resolution rules, and the copied Zod schemas against sample API responses.
- **Not tested directly**: the BFF proxy, hooks and layout; end-to-end tests cover them.
- **Prior art**: the API's Vitest configuration with separate unit, integration and end-to-end configs; recorded fixtures as the source of truth for an external system (the Stripe plugin fixtures and contract suite). The mock fixture store follows the same idea for the API.
- The Console's `test` and `test:e2e` tasks run in turbo and in CI.

## Out of Scope

- Building the admin read endpoints in the NestJS API (a separate backend effort; the mocks define their shape).
- Real Operator authentication and authorisation.
- Multi-merchant or tenant views.
- Refund flows; Refunds appears only as a disabled sidebar item.
- Cancelling Payments, creating Payments, or starting PaymentTransactions from the Console.
- Enabling or disabling PaymentGateways at runtime; entering or rotating credentials; installing plugins.
- VNPay, ZaloPay or other PaymentGateways in the data until their plugins exist.
- Renaming "review" in the domain or the code.
- Merchant Webhook delivery and its management.
- Raw gateway responses for PaymentTransactions.
- i18n and a Vietnamese UI.
- Server-side settings.

## Further Notes

- The mocked admin API is effectively the spec for the backend admin-API effort. When that effort starts, it should take its endpoint shapes from the Console's copied schemas and mock handlers, and the Console then turns mock mode off.
- Because types are copied rather than shared, a change to an API response must be made in both places. Runtime validation in the Console makes a mismatch fail visibly.
- The Callback URL and test or live mode shown for a PaymentGateway come from the API, never from the Console's own configuration.
- Phase 1 protects internal routes only by keeping them off the public ingress. The Console's server must therefore run inside the same network boundary as the API; it must not be exposed publicly without authentication.
